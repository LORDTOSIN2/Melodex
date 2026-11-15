/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkletSynthesizer, Sequencer } from 'spessasynth_lib';
import {
  BasicMIDI,
  MIDIMessage,
  MIDIMessageTypes,
  MIDITrack,
  SoundBankLoader,
  type MIDIMessageType
} from 'spessasynth_core';
import {
  ChannelState,
  TrackInfo,
  SoundFontMeta,
  BenchmarkMetrics,
  SequencerNote,
  MidiSongSummary,
  SolfegeBankMeta
} from '../types/midi';
import { GM_INSTRUMENTS } from './gmInstruments';
import { soundFontStorage } from './soundFontStorage';
import { downloadMidiBuffer, summarizeMidiForAi } from './midiCompiler';
import { getMajorDoRootFromKeyName, SOLFA_DEGREE_NAMES } from './solfaService';

const SOLFEGE_BANK_ID = 'solfege_vocal';
const SOLFEGE_STORAGE_KEY = 'solfege_vocal_sf2';
const SOLFEGE_BANK_OFFSET = 100;
const BUNDLED_SOLFEGE_URL = '/soundfonts/QDSolfege-movable.sf3';
const BUNDLED_SOLFEGE_NAME = 'QDSolfege V3.1 (Bundled Movable-Do, 1.2MB)';
const SOLFEGE_REMOVED_PREF_KEY = 'melodex_solfege_removed';

interface SolfegePatchTarget {
  bankMSB: number;
  bankLSB: number;
  program: number;
  name: string;
}

const CHROMATIC_FALLBACK_DEGREE: Record<number, number[]> = {
  0: [0],
  1: [0, 2],
  2: [2, 0],
  3: [4, 2],
  4: [4, 2],
  5: [5, 4],
  6: [5, 7],
  7: [7, 5],
  8: [7, 9],
  9: [9, 7],
  10: [11, 9],
  11: [11, 9]
};

function degreeToSolfaSubChannel(degree: number): number {
  // Skip sub-channel 9 so SpessaSynth never treats degree 9 ("La") as a drum channel
  return degree >= 9 ? degree + 1 : degree;
}

export type NoteEventCallback = (channel: number, midiNote: number, velocity: number, isNoteOn: boolean) => void;
export type TransportCallback = (currentTime: number, duration: number, isPlaying: boolean, tempoBpm: number) => void;
export type ChannelUpdateCallback = (channels: ChannelState[]) => void;
export type BenchmarkCallback = (metrics: BenchmarkMetrics) => void;

class AudioEngine {
  private audioContext: AudioContext | null = null;
  private synth: WorkletSynthesizer | null = null;
  private sequencer: Sequencer | null = null;
  private isInitialized = false;
  private isInitializing = false;
  private isSoundFontLoaded = false;
  private loadedSoundFonts: SoundFontMeta[] = [];
  private currentMidi: BasicMIDI | null = null;
  private rawMidiBuffer: ArrayBuffer | null = null;
  private currentMidiName: string = '';
  private aiUndoStack: { buffer: ArrayBuffer; name: string }[] = [];

  // Layered Solfege Vocal SoundFont (Bank Offset 100, 12 Movable-Do Syllable Presets)
  private solfegeBankMeta: SolfegeBankMeta | null = null;
  private solfegePresetMap: Record<number, SolfegePatchTarget> = {};
  private solfaRootKey: number = 0; // 0 = C Major / A Minor
  private solfegeBaseSynthChannel: number = 16;
  private interactiveSolfaNotes = new Map<string, number>(); // `${uiCh}:${midiNote}` -> synthCh
  private solfaActivePitchToUiChannel = new Map<number, number[]>(); // midiNote -> stack of uiCh
  private solfaKeyListeners = new Set<(rootKey: number) => void>();

  // Channel & Track State
  private channels: ChannelState[] = [];
  private tracks: TrackInfo[] = [];
  private parsedNotes: SequencerNote[] = [];

  // Playback settings
  private playbackRate: number = 1.0;
  private transposeSemitones: number = 0;
  private isLooping: boolean = false;

  // Visual & event listeners
  private noteEventListeners = new Set<NoteEventCallback>();
  private transportListeners = new Set<TransportCallback>();
  private channelUpdateListeners = new Set<ChannelUpdateCallback>();
  private benchmarkListeners = new Set<BenchmarkCallback>();

  // Diagnostic / Benchmark metrics
  private peakVoices = 0;
  private stressTestInterval: number | null = null;
  private monitorInterval: number | null = null;
  private isStressTesting = false;
  private stressVoicesGenerated = 0;

  constructor() {
    this.initDefaultChannels();
  }

  private initDefaultChannels() {
    const prevSolfaFlags = this.channels.map((c) => Boolean(c.isSolfaVocal));
    this.channels = Array.from({ length: 16 }, (_, i) => ({
      channelNumber: i,
      name: i === 9 ? 'Channel 10 (Drums)' : `Channel ${i + 1}`,
      program: i === 9 ? 0 : 0, // default piano (or standard drum)
      isDrum: i === 9,
      volume: 100,
      pan: 0,
      reverb: 40,
      isMuted: false,
      isSoloed: false,
      presetLocked: false,
      isSolfaVocal: i === 9 ? false : (prevSolfaFlags[i] ?? false),
      activityLevel: 0,
      activeNotes: new Set<number>()
    }));
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx({ sampleRate: 44100 });

      // Add SpessaSynth AudioWorklet processor module
      await this.audioContext.audioWorklet.addModule('/spessasynth_processor.min.js');

      // Instantiate WorkletSynthesizer
      this.synth = new WorkletSynthesizer(this.audioContext);
      await this.synth.isReady;

      // Connect synth to destination
      this.synth.connect(this.audioContext.destination);

      // Create sequencer attached to this synthesizer
      this.sequencer = new Sequencer(this.synth);

      // Attach synth event handlers
      this.setupSynthEventHandlers();

      // Start transport and benchmark pollers
      this.startPollingLoops();

      // Pre-allocate Port 1 channels (16..31) for zero-latency polyphonic Solfege voices
      this.ensureSolfegeSynthChannels();

      this.isInitialized = true;
    } finally {
      this.isInitializing = false;
    }
  }

  private setupSynthEventHandlers(): void {
    if (!this.synth) return;

    // Note On
    this.synth.eventHandler.addEvent('noteOn', 'melodex_note_on', (event) => {
      const ch = event.channel;
      if (ch < this.channels.length) {
        const channelObj = this.channels[ch];
        channelObj.activeNotes.add(event.midiNote);
        channelObj.activityLevel = Math.max(channelObj.activityLevel, event.velocity / 127);
        this.notifyNoteEvent(ch, event.midiNote, event.velocity, true);
        this.notifyChannelUpdate();
      } else if (ch >= this.solfegeBaseSynthChannel && ch < this.solfegeBaseSynthChannel + 16) {
        // Map hidden polyphonic Solfa port channel back to its source mixer channel for visualizers
        const visualCh = this.resolveSolfaVisualChannel(event.midiNote);
        if (visualCh !== null) {
          const channelObj = this.channels[visualCh];
          channelObj.activeNotes.add(event.midiNote);
          channelObj.activityLevel = Math.max(channelObj.activityLevel, event.velocity / 127);
          this.notifyNoteEvent(visualCh, event.midiNote, event.velocity, true);
          this.notifyChannelUpdate();
        }
      }
    });

    // Note Off
    this.synth.eventHandler.addEvent('noteOff', 'melodex_note_off', (event) => {
      const ch = event.channel;
      if (ch < this.channels.length) {
        this.channels[ch].activeNotes.delete(event.midiNote);
        this.notifyNoteEvent(ch, event.midiNote, 0, false);
        this.notifyChannelUpdate();
      } else if (ch >= this.solfegeBaseSynthChannel && ch < this.solfegeBaseSynthChannel + 16) {
        const visualCh = this.resolveSolfaVisualChannel(event.midiNote);
        if (visualCh !== null) {
          this.channels[visualCh].activeNotes.delete(event.midiNote);
          this.notifyNoteEvent(visualCh, event.midiNote, 0, false);
          this.notifyChannelUpdate();
        }
      }
    });

    // Program Change
    this.synth.eventHandler.addEvent('programChange', 'melodex_prog_change', (event) => {
      const ch = event.channel;
      if (ch < this.channels.length) {
        this.channels[ch].program = event.program;
        this.channels[ch].isDrum = event.isDrum;
        this.notifyChannelUpdate();
      }
    });

    // Controller Change
    this.synth.eventHandler.addEvent('controllerChange', 'melodex_cc_change', (event) => {
      const ch = event.channel;
      if (ch < this.channels.length) {
        if (event.controller === 7) {
          this.channels[ch].volume = event.value;
        } else if (event.controller === 10) {
          // Pan: 0 = -1 (left), 64 = 0 (center), 127 = 1 (right)
          this.channels[ch].pan = (event.value - 64) / 64;
        } else if (event.controller === 91) {
          this.channels[ch].reverb = event.value;
        }
        this.notifyChannelUpdate();
      }
    });

    // Stop All
    this.synth.eventHandler.addEvent('stopAll', 'melodex_stop_all', () => {
      this.channels.forEach((ch) => ch.activeNotes.clear());
      this.notifyChannelUpdate();
    });
  }

  private startPollingLoops(): void {
    // High-resolution visual decay & transport loop (60 fps)
    const updateTick = () => {
      // Decay channel VU meters
      let changed = false;
      for (const ch of this.channels) {
        if (ch.activityLevel > 0.02) {
          ch.activityLevel *= 0.88;
          changed = true;
        } else if (ch.activityLevel > 0) {
          ch.activityLevel = 0;
          changed = true;
        }
      }
      if (changed) {
        this.notifyChannelUpdate();
      }

      // Update transport status
      if (this.sequencer) {
        const currentTime = this.sequencer.currentTime || 0;
        const duration = this.sequencer.duration || (this.currentMidi ? this.currentMidi.duration : 0);
        const isPlaying = !this.sequencer.paused && duration > 0;
        const tempo = this.sequencer.currentTempo || 120;
        for (const listener of this.transportListeners) {
          listener(currentTime, duration, isPlaying, tempo);
        }
      }

      requestAnimationFrame(updateTick);
    };
    requestAnimationFrame(updateTick);

    // Benchmark poller (every 100ms)
    this.monitorInterval = window.setInterval(() => {
      if (!this.synth) return;
      const currentVoices = this.synth.voiceCount;
      if (currentVoices > this.peakVoices) {
        this.peakVoices = currentVoices;
      }
      const metrics: BenchmarkMetrics = {
        activeVoices: currentVoices,
        peakVoices: this.peakVoices,
        audioTimeMs: this.audioContext ? Math.round(this.audioContext.currentTime * 1000) : 0,
        stressTestRunning: this.isStressTesting,
        stressVoicesGenerated: this.stressVoicesGenerated
      };
      for (const listener of this.benchmarkListeners) {
        listener(metrics);
      }
    }, 100);
  }

  public async resumeAudioContext(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  public async loadSoundFont(
    type: 'compact' | 'full' = 'compact',
    onProgress?: (pct: number, msg: string) => void
  ): Promise<void> {
    await this.initialize();
    await this.resumeAudioContext();

    if (!this.synth) throw new Error('Synth not initialized');

    const isCompact = type === 'compact';
    const soundFontUrl = isCompact
      ? '/soundfonts/GeneralUser-compact.sf3'
      : '/soundfonts/GeneralUser.sf2';
    const soundFontId = isCompact ? 'generaluser_compact_sf3' : 'generaluser_full_sf2';
    const soundFontName = isCompact
      ? 'GeneralUser GS (Compact SF3, 6.1MB)'
      : 'GeneralUser GS (Full SF2, 30MB)';
    const fallbackSize = isCompact ? 6378548 : 31457280;

    // 1. Check local persistent IndexedDB first!
    onProgress?.(5, 'Checking local browser cache (IndexedDB)...');
    const cachedBuffer = await soundFontStorage.getSoundFont(soundFontId);

    let finalBuffer: ArrayBuffer;
    let loadedFromCache = false;

    if (cachedBuffer) {
      onProgress?.(35, `Loading ${soundFontName} from persistent browser storage...`);
      finalBuffer = cachedBuffer;
      loadedFromCache = true;
    } else {
      // 2. Stream download from network
      onProgress?.(10, `Downloading ${soundFontName}...`);
      const response = await fetch(soundFontUrl);
      if (!response.ok) {
        throw new Error(`Failed to load SoundFont: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const contentLength = +(response.headers.get('Content-Length') || fallbackSize);
      let receivedLength = 0;
      const chunks: Uint8Array[] = [];

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          receivedLength += value.length;
          const pct = Math.min(85, Math.round(10 + (receivedLength / contentLength) * 75));
          onProgress?.(
            pct,
            `Downloading... ${(receivedLength / (1024 * 1024)).toFixed(1)}MB / ${(contentLength / (1024 * 1024)).toFixed(1)}MB`
          );
        }
      }

      const allChunks = new Uint8Array(receivedLength);
      let position = 0;
      for (const chunk of chunks) {
        allChunks.set(chunk, position);
        position += chunk.length;
      }
      finalBuffer = allChunks.buffer;

      // Save to persistent IndexedDB for all future visits
      onProgress?.(88, 'Saving SoundFont to browser persistent storage (IndexedDB)...');
      await soundFontStorage.saveSoundFont(soundFontId, soundFontName, finalBuffer);
    }

    onProgress?.(92, 'Registering SoundFont with AudioWorklet...');
    await this.synth.soundBankManager.addSoundBank(finalBuffer.slice(0), soundFontId);
    await this.synth.isReady;

    this.isSoundFontLoaded = true;
    this.loadedSoundFonts = [
      {
        id: soundFontId,
        name: soundFontName,
        sizeBytes: finalBuffer.byteLength,
        isDefault: true,
        presetCount: 128,
        isCachedLocally: true,
        format: isCompact ? 'sf3' : 'sf2'
      }
    ];

    // Also restore layered Solfege Vocal SoundFont if cached in IndexedDB
    await this.restoreCachedSolfegeSoundFont();

    onProgress?.(
      100,
      loadedFromCache
        ? 'Loaded from persistent browser storage (0 MB downloaded)!'
        : 'SoundFont ready & cached for future visits!'
    );
  }

  public async loadDefaultSoundFont(onProgress?: (pct: number, msg: string) => void): Promise<void> {
    return this.loadSoundFont('compact', onProgress);
  }

  public async loadCustomSoundFont(file: File, onProgress?: (pct: number, msg: string) => void): Promise<void> {
    await this.initialize();
    await this.resumeAudioContext();

    if (!this.synth) throw new Error('Synth not initialized');

    onProgress?.(20, `Reading ${file.name}...`);
    const buffer = await file.arrayBuffer();

    // Cache custom SoundFont in IndexedDB as well
    onProgress?.(50, 'Saving to browser persistent storage...');
    await soundFontStorage.saveSoundFont(`custom_${file.name}`, file.name, buffer);

    onProgress?.(70, 'Transferring SoundFont to synthesizer engine...');
    await this.synth.soundBankManager.addSoundBank(buffer, file.name);
    await this.synth.isReady;

    this.isSoundFontLoaded = true;
    this.loadedSoundFonts.unshift({
      id: file.name,
      name: file.name,
      sizeBytes: file.size,
      isDefault: false,
      presetCount: 128,
      isCachedLocally: true,
      format: 'custom'
    });

    onProgress?.(100, `Loaded & cached ${file.name}!`);
  }

  public async clearSoundFontCache(): Promise<void> {
    await soundFontStorage.deleteSoundFont('generaluser_compact_sf3');
    await soundFontStorage.deleteSoundFont('generaluser_full_sf2');
    await soundFontStorage.deleteSoundFont(SOLFEGE_STORAGE_KEY);
    try {
      localStorage.removeItem(SOLFEGE_REMOVED_PREF_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  // --- Layered Solfege Vocal SoundFont (Bank Offset 100, 12 Presets 0..11) ---

  private ensureSolfegeSynthChannels(): void {
    if (!this.synth) return;
    const targetCount = 32;
    const currentCount = this.synth.midiChannels.length;
    for (let i = currentCount; i < targetCount; i++) {
      this.synth.addNewChannel();
    }
  }

  private buildSolfegePresetMapFromBuffer(buffer: ArrayBuffer): {
    detectedDegrees: number[];
    presetNames: Record<number, string>;
    presetMap: Record<number, SolfegePatchTarget>;
  } {
    const bank = SoundBankLoader.fromArrayBuffer(buffer.slice(0));
    const availableByProg = new Map<number, SolfegePatchTarget>();

    for (const p of bank.presets) {
      if (p.isGMGSDrum) continue;
      const existing = availableByProg.get(p.program);
      // Prefer bank 0 presets for programs 0..11, or store any first match
      if (!existing || p.bankMSB < existing.bankMSB - SOLFEGE_BANK_OFFSET) {
        availableByProg.set(p.program, {
          bankMSB: Math.min(127, p.bankMSB + SOLFEGE_BANK_OFFSET),
          bankLSB: p.bankLSB || 0,
          program: p.program,
          name: p.name || SOLFA_DEGREE_NAMES[p.program] || `Preset ${p.program}`
        });
      }
    }

    // Also build smart syllable-name matches in case presets are at arbitrary program numbers
    const nameMatchByDegree = new Map<number, SolfegePatchTarget>();
    const degreePatterns: [number, RegExp][] = [
      [0, /\b(doh?|ut)\b/i],
      [1, /\b(di|ra)\b/i],
      [2, /\b(re|ray)\b/i],
      [3, /\b(ri|me|ma)\b/i],
      [4, /\bmi\b/i],
      [5, /\bfa\b/i],
      [6, /\b(fi|se)\b/i],
      [7, /\b(sol?|so)\b/i],
      [8, /\b(le|lo|sil)\b/i],
      [9, /\bla\b/i],
      [10, /\b(ta|li|te)\b/i],
      [11, /\b(ti|si)\b/i]
    ];
    for (const p of bank.presets) {
      if (p.isGMGSDrum) continue;
      const cleanName = p.name || '';
      for (const [deg, rx] of degreePatterns) {
        if (!nameMatchByDegree.has(deg) && rx.test(cleanName)) {
          nameMatchByDegree.set(deg, {
            bankMSB: Math.min(127, p.bankMSB + SOLFEGE_BANK_OFFSET),
            bankLSB: p.bankLSB || 0,
            program: p.program,
            name: cleanName || SOLFA_DEGREE_NAMES[deg]
          });
        }
      }
    }

    const detectedDegrees: number[] = [];
    const presetNames: Record<number, string> = {};
    const presetMap: Record<number, SolfegePatchTarget> = {};

    for (let deg = 0; deg < 12; deg++) {
      const exact = availableByProg.get(deg) ?? nameMatchByDegree.get(deg);
      if (exact) {
        detectedDegrees.push(deg);
        presetNames[deg] = exact.name;
        presetMap[deg] = exact;
      }
    }

    // Build smart fallbacks for any missing chromatic syllables (e.g. 7-note major-only SF2s)
    const anyAvailable = availableByProg.get(0) ?? Array.from(availableByProg.values())[0];
    for (let deg = 0; deg < 12; deg++) {
      if (!presetMap[deg]) {
        const candidates = CHROMATIC_FALLBACK_DEGREE[deg] || [0];
        let chosen: SolfegePatchTarget | undefined;
        for (const c of candidates) {
          if (availableByProg.has(c)) {
            chosen = availableByProg.get(c);
            break;
          }
        }
        presetMap[deg] = chosen ?? anyAvailable ?? {
          bankMSB: SOLFEGE_BANK_OFFSET,
          bankLSB: 0,
          program: deg,
          name: SOLFA_DEGREE_NAMES[deg]
        };
      }
    }

    return { detectedDegrees, presetNames, presetMap };
  }

  private async registerSolfegeBuffer(
    buffer: ArrayBuffer,
    fileName: string,
    saveToCache: boolean
  ): Promise<SolfegeBankMeta> {
    if (!this.synth) throw new Error('Synth not initialized');
    this.ensureSolfegeSynthChannels();

    const { detectedDegrees, presetNames, presetMap } = this.buildSolfegePresetMapFromBuffer(buffer);
    this.solfegePresetMap = presetMap;

    if (saveToCache) {
      await soundFontStorage.saveSoundFont(SOLFEGE_STORAGE_KEY, fileName, buffer.slice(0));
    }

    // Layer at Bank Offset 100 so GeneralUser GS on Bank 0 remains untouched
    await this.synth.soundBankManager.addSoundBank(
      buffer.slice(0),
      SOLFEGE_BANK_ID,
      SOLFEGE_BANK_OFFSET
    );
    await this.synth.isReady;

    const meta: SolfegeBankMeta = {
      id: SOLFEGE_BANK_ID,
      name: fileName,
      sizeBytes: buffer.byteLength,
      bankOffset: SOLFEGE_BANK_OFFSET,
      detectedDegrees,
      presetNames
    };
    this.solfegeBankMeta = meta;
    this.configureSolfegeSynthChannelsFromChannel(
      this.channels.findIndex((c) => c.isSolfaVocal) >= 0
        ? this.channels.findIndex((c) => c.isSolfaVocal)
        : 0
    );
    this.notifyChannelUpdate();
    return meta;
  }

  private async restoreCachedSolfegeSoundFont(): Promise<void> {
    try {
      const cached = await soundFontStorage.getSoundFontWithMeta(SOLFEGE_STORAGE_KEY);
      if (cached) {
        await this.registerSolfegeBuffer(cached.buffer, cached.name, false);
        return;
      }

      const wasExplicitlyRemoved =
        typeof localStorage !== 'undefined' &&
        localStorage.getItem(SOLFEGE_REMOVED_PREF_KEY) === '1';
      if (!wasExplicitlyRemoved) {
        await this.loadBundledSolfegeSoundFont();
      }
    } catch (err) {
      console.warn('Could not restore or load bundled Solfege SoundFont:', err);
    }
  }

  public async loadBundledSolfegeSoundFont(
    onProgress?: (pct: number, msg: string) => void
  ): Promise<SolfegeBankMeta> {
    await this.initialize();
    await this.resumeAudioContext();

    try {
      localStorage.removeItem(SOLFEGE_REMOVED_PREF_KEY);
    } catch {
      // Ignore storage errors
    }

    onProgress?.(20, 'Downloading bundled QDSolfege (1.2MB)...');
    const response = await fetch(BUNDLED_SOLFEGE_URL);
    if (!response.ok) {
      throw new Error(`Failed to load bundled QDSolfege: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();

    onProgress?.(65, `Layering ${BUNDLED_SOLFEGE_NAME} at Bank ${SOLFEGE_BANK_OFFSET}...`);
    const meta = await this.registerSolfegeBuffer(buffer, BUNDLED_SOLFEGE_NAME, true);

    onProgress?.(
      100,
      `Bundled QDSolfege ready (${meta.detectedDegrees.length}/12 vocal presets mapped)!`
    );

    if (this.channels.some((c) => c.isSolfaVocal)) {
      this.applyTrackFilter();
    }
    return meta;
  }

  public async loadSolfegeSoundFont(
    file: File,
    onProgress?: (pct: number, msg: string) => void
  ): Promise<SolfegeBankMeta> {
    await this.initialize();
    await this.resumeAudioContext();

    try {
      localStorage.removeItem(SOLFEGE_REMOVED_PREF_KEY);
    } catch {
      // Ignore storage errors
    }

    onProgress?.(20, `Reading ${file.name}...`);
    const buffer = await file.arrayBuffer();

    onProgress?.(60, `Layering Solfege SF2 at Bank ${SOLFEGE_BANK_OFFSET} (preserving GeneralUser GS)...`);
    const meta = await this.registerSolfegeBuffer(buffer, file.name, true);

    onProgress?.(
      100,
      `Layered ${file.name} (${meta.detectedDegrees.length}/12 syllable presets mapped)!`
    );

    if (this.channels.some((c) => c.isSolfaVocal)) {
      this.applyTrackFilter();
    }
    return meta;
  }

  public async removeSolfegeSoundFont(): Promise<void> {
    try {
      localStorage.setItem(SOLFEGE_REMOVED_PREF_KEY, '1');
    } catch {
      // Ignore storage errors
    }
    await soundFontStorage.deleteSoundFont(SOLFEGE_STORAGE_KEY);
    try {
      this.synth?.soundBankManager.deleteSoundBank(SOLFEGE_BANK_ID);
    } catch {
      // Ignore if not loaded
    }
    this.solfegeBankMeta = null;
    this.solfegePresetMap = {};
    let hadSolfa = false;
    this.channels.forEach((c) => {
      if (c.isSolfaVocal) {
        c.isSolfaVocal = false;
        hadSolfa = true;
      }
    });
    if (hadSolfa) {
      this.applyTrackFilter();
    }
    this.notifyChannelUpdate();
  }

  private configureSolfegeSynthChannelsFromChannel(sourceChannel: number): void {
    if (!this.synth || !this.solfegeBankMeta) return;
    const src = this.channels[sourceChannel] ?? this.channels[0];
    const panCC = Math.max(0, Math.min(127, Math.round((src.pan + 1) * 63.5)));

    for (let deg = 0; deg < 12; deg++) {
      const subCh = degreeToSolfaSubChannel(deg);
      const synthCh = this.solfegeBaseSynthChannel + subCh;
      const patch = this.solfegePresetMap[deg];
      if (!patch) continue;
      this.synth.controllerChange(synthCh, 0, patch.bankMSB);
      this.synth.controllerChange(synthCh, 32, patch.bankLSB);
      this.synth.programChange(synthCh, patch.program);
      this.synth.controllerChange(synthCh, 7, src.volume);
      this.synth.controllerChange(synthCh, 10, panCC);
      this.synth.controllerChange(synthCh, 91, src.reverb);
      this.synth.midiChannels[synthCh]?.setSystemParameter('keyShift', this.transposeSemitones);
    }
  }

  private resolveSolfaVisualChannel(midiNote: number): number | null {
    const stack = this.solfaActivePitchToUiChannel.get(midiNote);
    if (stack && stack.length > 0) {
      return stack[0];
    }
    const active = this.channels.find((c) => c.isSolfaVocal && !c.isMuted);
    if (active) return active.channelNumber;
    const anySolfa = this.channels.find((c) => c.isSolfaVocal);
    return anySolfa ? anySolfa.channelNumber : null;
  }

  public setSolfaRootKey(rootKey: number): void {
    const normalized = ((Math.round(rootKey) % 12) + 12) % 12;
    if (this.solfaRootKey === normalized) return;
    this.solfaRootKey = normalized;
    for (const listener of this.solfaKeyListeners) {
      listener(normalized);
    }
    if (this.solfegeBankMeta && this.channels.some((c) => c.isSolfaVocal)) {
      this.applyTrackFilter();
    }
    this.notifyChannelUpdate();
  }

  public getSolfaRootKey(): number {
    return this.solfaRootKey;
  }

  public getSolfegeBankMeta(): SolfegeBankMeta | null {
    return this.solfegeBankMeta;
  }

  public onSolfaKeyChange(cb: (rootKey: number) => void): () => void {
    this.solfaKeyListeners.add(cb);
    return () => this.solfaKeyListeners.delete(cb);
  }

  public toggleChannelSolfaVocal(channel: number): boolean {
    if (channel < 0 || channel >= 16 || channel === 9) return false;
    if (!this.solfegeBankMeta) return false;

    const next = !this.channels[channel].isSolfaVocal;
    this.channels[channel].isSolfaVocal = next;

    if (next) {
      this.ensureSolfegeSynthChannels();
      this.configureSolfegeSynthChannelsFromChannel(channel);
    }

    this.applyTrackFilter();
    this.applyMuteSoloRules();
    this.notifyChannelUpdate();
    return true;
  }

  public async loadMidi(buffer: ArrayBuffer, fileName: string): Promise<void> {
    await this.initialize();
    await this.resumeAudioContext();

    if (!this.sequencer || !this.synth) throw new Error('Sequencer not ready');

    this.rawMidiBuffer = buffer.slice(0);
    this.currentMidiName = fileName;

    // Parse with BasicMIDI from spessasynth_core
    this.currentMidi = BasicMIDI.fromArrayBuffer(buffer, fileName);

    // Auto-detect song key so Movable-Do labels & Solfa singing match immediately
    try {
      const summary = summarizeMidiForAi(buffer, fileName);
      const detectedDoRoot = getMajorDoRootFromKeyName(summary.estimatedKey);
      this.solfaRootKey = detectedDoRoot;
      for (const listener of this.solfaKeyListeners) {
        listener(detectedDoRoot);
      }
    } catch {
      // Keep current root key on fallback
    }

    // Extract Track Information
    this.tracks = this.currentMidi.tracks.map((track, idx) => {
      const channelArray = Array.from(track.channels);
      return {
        index: idx,
        name: track.name.trim() || `Track ${idx + 1}`,
        channels: channelArray,
        eventCount: track.events.length,
        noteCount: track.events.filter((e) => (e.statusByte & 240) === 144 && e.data[1] > 0).length,
        isMuted: false,
        isSoloed: false,
        velocityTrim: 1.0
      };
    });

    // Extract Note Times for Canvas Piano Roll
    try {
      const noteTimes = this.currentMidi.getNoteTimes();
      const extractedNotes: SequencerNote[] = [];
      noteTimes.forEach((chNotes, ch) => {
        if (chNotes && Array.isArray(chNotes)) {
          chNotes.forEach((n, idx) => {
            extractedNotes.push({
              id: `${ch}-${n.midiNote}-${idx}-${n.start.toFixed(3)}`,
              channel: ch,
              midiNote: n.midiNote,
              startTime: n.start,
              duration: Math.max(0.05, n.length),
              velocity: n.velocity
            });
          });
        }
      });
      extractedNotes.sort((a, b) => a.startTime - b.startTime);
      this.parsedNotes = extractedNotes;
    } catch {
      this.parsedNotes = [];
    }

    // Reset channel states (preserves user Solfa channel toggles)
    this.initDefaultChannels();

    // Load into sequencer (apply Solfa routing immediately if active)
    if (this.solfegeBankMeta && this.channels.some((c) => c.isSolfaVocal)) {
      this.applyTrackFilter();
    } else {
      this.sequencer.loadNewSongList([{ binary: buffer, fileName }]);
      this.sequencer.playbackRate = this.playbackRate;
    }

    // Apply transpose if set
    this.applyKeyShiftToChannels();

    this.notifyChannelUpdate();
  }

  // --- Transport Controls ---

  public play(): void {
    if (!this.sequencer) return;
    this.resumeAudioContext();
    this.sequencer.play();
  }

  public pause(): void {
    if (!this.sequencer) return;
    this.sequencer.pause();
  }

  public stop(): void {
    if (!this.sequencer) return;
    this.sequencer.pause();
    this.sequencer.currentTime = 0;
    this.synth?.stopAll(true);
  }

  public seek(seconds: number): void {
    if (!this.sequencer) return;
    this.sequencer.currentTime = Math.max(0, seconds);
  }

  public setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.25, Math.min(2.5, rate));
    if (this.sequencer) {
      this.sequencer.playbackRate = this.playbackRate;
    }
  }

  public setTranspose(semitones: number): void {
    this.transposeSemitones = Math.max(-12, Math.min(12, semitones));
    this.applyKeyShiftToChannels();
  }

  private applyKeyShiftToChannels(): void {
    if (!this.synth) return;
    for (let ch = 0; ch < 16; ch++) {
      // Channel 9 is percussion, do NOT transpose drum keys
      if (ch === 9) continue;
      this.synth.midiChannels[ch]?.setSystemParameter('keyShift', this.transposeSemitones);
    }
    // Also transpose hidden polyphonic Solfa channels (0..11 degrees)
    for (let deg = 0; deg < 12; deg++) {
      const synthCh = this.solfegeBaseSynthChannel + degreeToSolfaSubChannel(deg);
      this.synth.midiChannels[synthCh]?.setSystemParameter('keyShift', this.transposeSemitones);
    }
  }

  public toggleLoop(): boolean {
    this.isLooping = !this.isLooping;
    if (this.sequencer) {
      this.sequencer.loopCount = this.isLooping ? Infinity : 0;
    }
    return this.isLooping;
  }

  // --- Mixer & Channel Controls ---

  public setChannelVolume(channel: number, volume: number): void {
    if (channel < 0 || channel >= 16) return;
    const clamped = Math.max(0, Math.min(127, Math.round(volume)));
    this.channels[channel].volume = clamped;
    this.synth?.controllerChange(channel, 7, clamped);
    if (this.channels[channel].isSolfaVocal && this.synth) {
      for (let deg = 0; deg < 12; deg++) {
        const synthCh = this.solfegeBaseSynthChannel + degreeToSolfaSubChannel(deg);
        this.synth.controllerChange(synthCh, 7, clamped);
      }
    }
    this.notifyChannelUpdate();
  }

  public setChannelPan(channel: number, pan: number): void {
    if (channel < 0 || channel >= 16) return;
    // pan is -1 (left) to 1 (right)
    this.channels[channel].pan = pan;
    const ccVal = Math.max(0, Math.min(127, Math.round((pan + 1) * 63.5)));
    this.synth?.controllerChange(channel, 10, ccVal);
    if (this.channels[channel].isSolfaVocal && this.synth) {
      for (let deg = 0; deg < 12; deg++) {
        const synthCh = this.solfegeBaseSynthChannel + degreeToSolfaSubChannel(deg);
        this.synth.controllerChange(synthCh, 10, ccVal);
      }
    }
    this.notifyChannelUpdate();
  }

  public setChannelReverb(channel: number, reverb: number): void {
    if (channel < 0 || channel >= 16) return;
    const clamped = Math.max(0, Math.min(127, Math.round(reverb)));
    this.channels[channel].reverb = clamped;
    this.synth?.controllerChange(channel, 91, clamped);
    if (this.channels[channel].isSolfaVocal && this.synth) {
      for (let deg = 0; deg < 12; deg++) {
        const synthCh = this.solfegeBaseSynthChannel + degreeToSolfaSubChannel(deg);
        this.synth.controllerChange(synthCh, 91, clamped);
      }
    }
    this.notifyChannelUpdate();
  }

  public setChannelProgram(channel: number, program: number): void {
    if (channel < 0 || channel >= 16) return;
    this.channels[channel].program = program;
    this.synth?.programChange(channel, program);
    // Lock preset so MIDI sequence program changes won't overwrite user selection
    this.synth?.midiChannels[channel]?.setSystemParameter('presetLock', true);
    this.channels[channel].presetLocked = true;
    this.notifyChannelUpdate();
  }

  public toggleChannelPresetLock(channel: number): void {
    if (channel < 0 || channel >= 16) return;
    const next = !this.channels[channel].presetLocked;
    this.channels[channel].presetLocked = next;
    this.synth?.midiChannels[channel]?.setSystemParameter('presetLock', next);
    this.notifyChannelUpdate();
  }

  public toggleChannelMute(channel: number): void {
    if (channel < 0 || channel >= 16) return;
    this.channels[channel].isMuted = !this.channels[channel].isMuted;
    this.applyMuteSoloRules();
  }

  public toggleChannelSolo(channel: number): void {
    if (channel < 0 || channel >= 16) return;
    this.channels[channel].isSoloed = !this.channels[channel].isSoloed;
    this.applyMuteSoloRules();
  }

  private applyMuteSoloRules(): void {
    if (!this.synth) return;
    const hasAnySolo = this.channels.some((c) => c.isSoloed);
    let anySolfaAudible = false;

    for (let ch = 0; ch < 16; ch++) {
      const channelObj = this.channels[ch];
      let shouldMute = channelObj.isMuted;
      if (hasAnySolo) {
        shouldMute = !channelObj.isSoloed || channelObj.isMuted;
      }
      this.synth.midiChannels[ch]?.setSystemParameter('isMuted', shouldMute);
      if (channelObj.isSolfaVocal && !shouldMute) {
        anySolfaAudible = true;
      }
    }

    if (this.channels.some((c) => c.isSolfaVocal)) {
      for (let deg = 0; deg < 12; deg++) {
        const synthCh = this.solfegeBaseSynthChannel + degreeToSolfaSubChannel(deg);
        this.synth.midiChannels[synthCh]?.setSystemParameter('isMuted', !anySolfaAudible);
      }
    }

    this.notifyChannelUpdate();
  }

  // --- Track Controls (Refinement 3: Separation of Track & Channel) ---

  public toggleTrackMute(trackIndex: number): void {
    if (trackIndex < 0 || trackIndex >= this.tracks.length) return;
    this.tracks[trackIndex].isMuted = !this.tracks[trackIndex].isMuted;
    this.applyTrackFilter();
  }

  public toggleTrackSolo(trackIndex: number): void {
    if (trackIndex < 0 || trackIndex >= this.tracks.length) return;
    this.tracks[trackIndex].isSoloed = !this.tracks[trackIndex].isSoloed;
    this.applyTrackFilter();
  }

  public setTrackVelocityTrim(trackIndex: number, trim: number): void {
    if (trackIndex < 0 || trackIndex >= this.tracks.length) return;
    this.tracks[trackIndex].velocityTrim = Math.max(0, Math.min(2.0, trim));
    this.applyTrackFilter();
  }

  private applyTrackFilter(): void {
    if (!this.rawMidiBuffer || !this.sequencer) return;

    const hasAnySolo = this.tracks.some((t) => t.isSoloed);
    const hasAnySolfaChannel = Boolean(
      this.solfegeBankMeta && this.channels.some((c) => c.isSolfaVocal && c.channelNumber !== 9)
    );

    // If no tracks are muted/soloed, trims are default, and no Solfa vocal channels active, reload original
    const allDefault =
      !hasAnySolfaChannel &&
      this.tracks.every((t) => !t.isMuted && !t.isSoloed && t.velocityTrim === 1.0);
    if (allDefault) {
      const currentTime = this.sequencer.currentTime;
      const wasPlaying = !this.sequencer.paused;
      this.sequencer.loadNewSongList([{ binary: this.rawMidiBuffer, fileName: this.currentMidiName }]);
      this.sequencer.currentTime = currentTime;
      this.sequencer.playbackRate = this.playbackRate;
      this.applyKeyShiftToChannels();
      if (wasPlaying) this.sequencer.play();
      return;
    }

    // Non-destructively parse fresh copy of MIDI to manipulate track events & polyphonic Solfa routing
    const filteredMidi = BasicMIDI.fromArrayBuffer(this.rawMidiBuffer, this.currentMidiName);
    const solfaChannelSet = new Set(
      hasAnySolfaChannel
        ? this.channels.filter((c) => c.isSolfaVocal && c.channelNumber !== 9).map((c) => c.channelNumber)
        : []
    );

    const solfaPort = Math.max(1, ...filteredMidi.tracks.map((t) => (t.port || 0) + 1));
    const solfaNoteEvents: MIDIMessage[] = [];
    let maxSolfaTick = 0;

    filteredMidi.tracks.forEach((track, i) => {
      const trackMeta = this.tracks[i];
      if (!trackMeta) return;

      if (hasAnySolfaChannel && track.channels.size > 0) {
        const hasPortEvent = track.events.some((e) => e.statusByte === MIDIMessageTypes.midiPort);
        if (!hasPortEvent) {
          track.events = [
            new MIDIMessage(0, MIDIMessageTypes.midiPort, new Uint8Array([track.port || 0])),
            ...track.events
          ];
        }
      }

      const isAudible = (!hasAnySolo || trackMeta.isSoloed) && !trackMeta.isMuted;

      if (!isAudible) {
        // Strip NoteOn/NoteOff events from muted tracks while retaining CCs & program changes
        track.events = track.events.filter((e) => {
          const status = e.statusByte & 240;
          return status !== 144 && status !== 128;
        });
        return;
      }

      if (hasAnySolfaChannel) {
        const retained: MIDIMessage[] = [];
        for (const e of track.events) {
          const status = e.statusByte & 240;
          const srcCh = e.statusByte & 15;

          if ((status === 144 || status === 128) && solfaChannelSet.has(srcCh)) {
            const pitch = e.data[0] ?? 60;
            const degree = ((pitch % 12) - this.solfaRootKey + 12) % 12;
            const subCh = degreeToSolfaSubChannel(degree);
            const isNoteOn = status === 144 && (e.data[1] ?? 0) > 0;
            const chVolRatio = (this.channels[srcCh]?.volume ?? 100) / 100;
            const vel = isNoteOn
              ? Math.max(1, Math.min(127, Math.round((e.data[1] ?? 100) * trackMeta.velocityTrim * chVolRatio)))
              : 0;
            const msgStatus = ((isNoteOn ? MIDIMessageTypes.noteOn : MIDIMessageTypes.noteOff) |
              subCh) as MIDIMessageType;

            solfaNoteEvents.push(new MIDIMessage(e.ticks, msgStatus, new Uint8Array([pitch, vel])));
            if (e.ticks > maxSolfaTick) maxSolfaTick = e.ticks;
          } else {
            if (trackMeta.velocityTrim !== 1.0 && status === 144 && e.data[1] > 0) {
              e.data[1] = Math.max(1, Math.min(127, Math.round(e.data[1] * trackMeta.velocityTrim)));
            }
            retained.push(e);
          }
        }
        track.events = retained;
      } else if (trackMeta.velocityTrim !== 1.0) {
        track.events.forEach((e) => {
          if ((e.statusByte & 240) === 144 && e.data[1] > 0) {
            e.data[1] = Math.max(1, Math.min(127, Math.round(e.data[1] * trackMeta.velocityTrim)));
          }
        });
      }
    });

    if (hasAnySolfaChannel && solfaNoteEvents.length > 0) {
      const solfaTrack = new MIDITrack();
      solfaTrack.name = 'Solfege Vocal Choir';
      solfaTrack.port = solfaPort;

      const primarySolfaCh = this.channels.find((c) => c.isSolfaVocal);
      const vol = primarySolfaCh?.volume ?? 100;
      const panCC = primarySolfaCh
        ? Math.max(0, Math.min(127, Math.round((primarySolfaCh.pan + 1) * 63.5)))
        : 64;
      const rev = primarySolfaCh?.reverb ?? 40;

      const setupEvents: MIDIMessage[] = [
        new MIDIMessage(0, MIDIMessageTypes.midiPort, new Uint8Array([solfaPort]))
      ];

      for (let deg = 0; deg < 12; deg++) {
        const subCh = degreeToSolfaSubChannel(deg);
        const patch = this.solfegePresetMap[deg] ?? {
          bankMSB: SOLFEGE_BANK_OFFSET,
          bankLSB: 0,
          program: deg,
          name: SOLFA_DEGREE_NAMES[deg]
        };
        setupEvents.push(
          MIDIMessage.controllerChange(0, subCh, 0, patch.bankMSB),
          MIDIMessage.controllerChange(0, subCh, 32, patch.bankLSB),
          MIDIMessage.programChange(0, subCh, patch.program),
          MIDIMessage.controllerChange(0, subCh, 7, vol),
          MIDIMessage.controllerChange(0, subCh, 10, panCC),
          MIDIMessage.controllerChange(0, subCh, 91, rev)
        );
      }

      solfaNoteEvents.sort((a, b) => {
        if (a.ticks !== b.ticks) return a.ticks - b.ticks;
        const aIsOn = (a.statusByte & 240) === 144 && (a.data[1] ?? 0) > 0;
        const bIsOn = (b.statusByte & 240) === 144 && (b.data[1] ?? 0) > 0;
        if (aIsOn !== bIsOn) return aIsOn ? 1 : -1;
        return (a.data[0] ?? 0) - (b.data[0] ?? 0);
      });

      solfaTrack.pushEvents(
        ...setupEvents,
        ...solfaNoteEvents,
        new MIDIMessage(maxSolfaTick + 10, MIDIMessageTypes.endOfTrack, new Uint8Array([]))
      );
      filteredMidi.tracks.push(solfaTrack);
    }

    filteredMidi.flush();
    if (hasAnySolfaChannel) {
      this.solfegeBaseSynthChannel = filteredMidi.portChannelOffsetMap[solfaPort] ?? 16;
      this.ensureSolfegeSynthChannels();
    }

    const currentTime = this.sequencer.currentTime;
    const wasPlaying = !this.sequencer.paused;
    this.sequencer.loadNewSongList([{ binary: filteredMidi.writeMIDI(), fileName: this.currentMidiName }]);
    this.sequencer.currentTime = currentTime;
    this.sequencer.playbackRate = this.playbackRate;
    this.applyKeyShiftToChannels();
    this.applyMuteSoloRules();
    if (wasPlaying) this.sequencer.play();
  }

  // --- Interactive Virtual Piano direct playback (supports polyphonic Solfege chords) ---

  public playNoteInteractive(channel: number, midiNote: number, velocity: number = 100): void {
    if (!this.synth) return;
    this.resumeAudioContext();

    const chObj = this.channels[channel];
    if (chObj?.isSolfaVocal && this.solfegeBankMeta && channel !== 9) {
      this.ensureSolfegeSynthChannels();
      const degree = ((midiNote % 12) - this.solfaRootKey + 12) % 12;
      const subCh = degreeToSolfaSubChannel(degree);
      const targetSynthCh = this.solfegeBaseSynthChannel + subCh;
      const patch = this.solfegePresetMap[degree];
      if (patch) {
        this.synth.controllerChange(targetSynthCh, 0, patch.bankMSB);
        this.synth.controllerChange(targetSynthCh, 32, patch.bankLSB);
        this.synth.programChange(targetSynthCh, patch.program);
      }
      const panCC = Math.max(0, Math.min(127, Math.round((chObj.pan + 1) * 63.5)));
      this.synth.controllerChange(targetSynthCh, 7, chObj.volume);
      this.synth.controllerChange(targetSynthCh, 10, panCC);
      this.synth.controllerChange(targetSynthCh, 91, chObj.reverb);
      this.synth.midiChannels[targetSynthCh]?.setSystemParameter('keyShift', this.transposeSemitones);

      this.interactiveSolfaNotes.set(`${channel}:${midiNote}`, targetSynthCh);
      const stack = this.solfaActivePitchToUiChannel.get(midiNote) || [];
      stack.unshift(channel);
      this.solfaActivePitchToUiChannel.set(midiNote, stack);

      this.synth.noteOn(targetSynthCh, midiNote, velocity);
      chObj.activeNotes.add(midiNote);
      this.notifyNoteEvent(channel, midiNote, velocity, true);
      this.notifyChannelUpdate();
      return;
    }

    this.synth.noteOn(channel, midiNote, velocity);
    this.channels[channel].activeNotes.add(midiNote);
    this.notifyNoteEvent(channel, midiNote, velocity, true);
    this.notifyChannelUpdate();
  }

  public stopNoteInteractive(channel: number, midiNote: number): void {
    if (!this.synth) return;

    const noteKey = `${channel}:${midiNote}`;
    const solfaSynthCh = this.interactiveSolfaNotes.get(noteKey);
    if (solfaSynthCh !== undefined) {
      this.interactiveSolfaNotes.delete(noteKey);
      const stack = this.solfaActivePitchToUiChannel.get(midiNote);
      if (stack) {
        const idx = stack.indexOf(channel);
        if (idx >= 0) stack.splice(idx, 1);
        if (stack.length === 0) this.solfaActivePitchToUiChannel.delete(midiNote);
      }
      this.synth.noteOff(solfaSynthCh, midiNote);
      this.channels[channel].activeNotes.delete(midiNote);
      this.notifyNoteEvent(channel, midiNote, 0, false);
      this.notifyChannelUpdate();
      return;
    }

    this.synth.noteOff(channel, midiNote);
    this.channels[channel].activeNotes.delete(midiNote);
    this.notifyNoteEvent(channel, midiNote, 0, false);
    this.notifyChannelUpdate();
  }

  // --- Polyphony Stress Benchmark (Refinement 4) ---

  public runPolyphonyBenchmark(): void {
    if (!this.synth) return;
    this.resumeAudioContext();
    this.isStressTesting = true;
    this.stressVoicesGenerated = 0;

    let step = 0;
    const basePitches = [36, 48, 60, 72, 84];
    const intervals = [0, 4, 7, 11, 14, 17, 21, 24]; // rich extended major chords

    this.stressTestInterval = window.setInterval(() => {
      if (!this.synth || step > 40) {
        this.stopPolyphonyBenchmark();
        return;
      }

      // Trigger 16 simultaneous notes across channels 0-4
      for (let ch = 0; ch < 4; ch++) {
        const root = basePitches[step % basePitches.length] + ch * 2;
        for (let i = 0; i < 4; i++) {
          const note = Math.min(127, root + intervals[i]);
          this.synth.noteOn(ch, note, 110);
          this.stressVoicesGenerated++;
          // Auto release after 1800ms
          setTimeout(() => {
            this.synth?.noteOff(ch, note);
          }, 1800);
        }
      }
      step++;
    }, 120);
  }

  public stopPolyphonyBenchmark(): void {
    if (this.stressTestInterval) {
      clearInterval(this.stressTestInterval);
      this.stressTestInterval = null;
    }
    this.isStressTesting = false;
    this.synth?.stopAll(true);
  }

  // --- Getters & Subscribers ---

  public getChannels(): ChannelState[] {
    return this.channels;
  }

  public getTracks(): TrackInfo[] {
    return this.tracks;
  }

  public getParsedNotes(): SequencerNote[] {
    return this.parsedNotes;
  }

  public getSoundFonts(): SoundFontMeta[] {
    return this.loadedSoundFonts;
  }

  public getIsSoundFontLoaded(): boolean {
    return this.isSoundFontLoaded;
  }

  public getCurrentMidiName(): string {
    return this.currentMidiName;
  }

  public getCurrentMidiBuffer(): ArrayBuffer | null {
    return this.rawMidiBuffer ? this.rawMidiBuffer.slice(0) : null;
  }

  public getCurrentMidiSummary(): MidiSongSummary | null {
    if (!this.rawMidiBuffer) return null;
    return summarizeMidiForAi(this.rawMidiBuffer, this.currentMidiName || 'untitled.mid');
  }

  public canUndoAiEdit(): boolean {
    return this.aiUndoStack.length > 0;
  }

  public getAiUndoCount(): number {
    return this.aiUndoStack.length;
  }

  public async loadAiMidi(buffer: ArrayBuffer, fileName: string, savePreviousForUndo = true): Promise<void> {
    if (savePreviousForUndo && this.rawMidiBuffer) {
      this.aiUndoStack.push({
        buffer: this.rawMidiBuffer.slice(0),
        name: this.currentMidiName
      });
      if (this.aiUndoStack.length > 10) {
        this.aiUndoStack.shift();
      }
    }
    await this.loadMidi(buffer, fileName);
  }

  public async undoLastAiEdit(): Promise<boolean> {
    const snap = this.aiUndoStack.pop();
    if (!snap) return false;
    await this.loadMidi(snap.buffer, snap.name);
    return true;
  }

  public exportCurrentMidi(): void {
    if (!this.rawMidiBuffer) return;
    downloadMidiBuffer(this.rawMidiBuffer, this.currentMidiName || 'melodex_export.mid');
  }

  public getPlaybackRate(): number {
    return this.playbackRate;
  }

  public getTranspose(): number {
    return this.transposeSemitones;
  }

  public onNoteEvent(cb: NoteEventCallback): () => void {
    this.noteEventListeners.add(cb);
    return () => this.noteEventListeners.delete(cb);
  }

  public onTransport(cb: TransportCallback): () => void {
    this.transportListeners.add(cb);
    return () => this.transportListeners.delete(cb);
  }

  public onChannelUpdate(cb: ChannelUpdateCallback): () => void {
    this.channelUpdateListeners.add(cb);
    return () => this.channelUpdateListeners.delete(cb);
  }

  public onBenchmark(cb: BenchmarkCallback): () => void {
    this.benchmarkListeners.add(cb);
    return () => this.benchmarkListeners.delete(cb);
  }

  private notifyNoteEvent(channel: number, midiNote: number, velocity: number, isNoteOn: boolean): void {
    for (const listener of this.noteEventListeners) {
      listener(channel, midiNote, velocity, isNoteOn);
    }
  }

  private notifyChannelUpdate(): void {
    for (const listener of this.channelUpdateListeners) {
      listener(this.channels);
    }
  }
}

export const audioEngine = new AudioEngine();
