/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkletSynthesizer, Sequencer } from 'spessasynth_lib';
import { BasicMIDI } from 'spessasynth_core';
import { ChannelState, TrackInfo, SoundFontMeta, BenchmarkMetrics, SequencerNote } from '../types/midi';
import { GM_INSTRUMENTS } from './gmInstruments';

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
      }
      this.notifyNoteEvent(ch, event.midiNote, event.velocity, true);
      this.notifyChannelUpdate();
    });

    // Note Off
    this.synth.eventHandler.addEvent('noteOff', 'melodex_note_off', (event) => {
      const ch = event.channel;
      if (ch < this.channels.length) {
        this.channels[ch].activeNotes.delete(event.midiNote);
      }
      this.notifyNoteEvent(ch, event.midiNote, 0, false);
      this.notifyChannelUpdate();
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

  public async loadDefaultSoundFont(onProgress?: (pct: number, msg: string) => void): Promise<void> {
    await this.initialize();
    await this.resumeAudioContext();

    if (!this.synth) throw new Error('Synth not initialized');

    onProgress?.(10, 'Fetching GeneralUser GS SoundFont (30MB)...');
    const response = await fetch('/soundfonts/GeneralUser.sf2');
    if (!response.ok) {
      throw new Error(`Failed to load SoundFont: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    const contentLength = +(response.headers.get('Content-Length') || 31457280);
    let receivedLength = 0;
    const chunks: Uint8Array[] = [];

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;
        const pct = Math.min(85, Math.round(10 + (receivedLength / contentLength) * 75));
        onProgress?.(pct, `Downloading SoundFont... ${(receivedLength / (1024 * 1024)).toFixed(1)}MB`);
      }
    }

    onProgress?.(88, 'Parsing SoundFont presets & wavetables...');
    const allChunks = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      allChunks.set(chunk, position);
      position += chunk.length;
    }

    onProgress?.(94, 'Registering SoundFont with AudioWorklet...');
    await this.synth.soundBankManager.addSoundBank(allChunks.buffer, 'generaluser_default');
    await this.synth.isReady;

    this.isSoundFontLoaded = true;
    this.loadedSoundFonts = [
      {
        id: 'generaluser_default',
        name: 'GeneralUser GS v1.47 (S. Christian Collins)',
        sizeBytes: receivedLength,
        isDefault: true,
        presetCount: 128
      }
    ];

    onProgress?.(100, 'SoundFont ready!');
  }

  public async loadCustomSoundFont(file: File, onProgress?: (pct: number, msg: string) => void): Promise<void> {
    await this.initialize();
    await this.resumeAudioContext();

    if (!this.synth) throw new Error('Synth not initialized');

    onProgress?.(20, `Reading ${file.name}...`);
    const buffer = await file.arrayBuffer();

    onProgress?.(60, 'Transferring SoundFont to synthesizer engine...');
    await this.synth.soundBankManager.addSoundBank(buffer, file.name);
    await this.synth.isReady;

    this.isSoundFontLoaded = true;
    this.loadedSoundFonts.unshift({
      id: file.name,
      name: file.name,
      sizeBytes: file.size,
      isDefault: false,
      presetCount: 128
    });

    onProgress?.(100, `Loaded ${file.name}!`);
  }

  public async loadMidi(buffer: ArrayBuffer, fileName: string): Promise<void> {
    await this.initialize();
    await this.resumeAudioContext();

    if (!this.sequencer || !this.synth) throw new Error('Sequencer not ready');

    this.rawMidiBuffer = buffer.slice(0);
    this.currentMidiName = fileName;

    // Parse with BasicMIDI from spessasynth_core
    this.currentMidi = BasicMIDI.fromArrayBuffer(buffer, fileName);

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

    // Reset channel states
    this.initDefaultChannels();

    // Load into sequencer
    this.sequencer.loadNewSongList([{ binary: buffer, fileName }]);
    this.sequencer.playbackRate = this.playbackRate;

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
    this.notifyChannelUpdate();
  }

  public setChannelPan(channel: number, pan: number): void {
    if (channel < 0 || channel >= 16) return;
    // pan is -1 (left) to 1 (right)
    this.channels[channel].pan = pan;
    const ccVal = Math.max(0, Math.min(127, Math.round((pan + 1) * 63.5)));
    this.synth?.controllerChange(channel, 10, ccVal);
    this.notifyChannelUpdate();
  }

  public setChannelReverb(channel: number, reverb: number): void {
    if (channel < 0 || channel >= 16) return;
    const clamped = Math.max(0, Math.min(127, Math.round(reverb)));
    this.channels[channel].reverb = clamped;
    this.synth?.controllerChange(channel, 91, clamped);
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

    for (let ch = 0; ch < 16; ch++) {
      const channelObj = this.channels[ch];
      let shouldMute = channelObj.isMuted;
      if (hasAnySolo) {
        shouldMute = !channelObj.isSoloed || channelObj.isMuted;
      }
      this.synth.midiChannels[ch]?.setSystemParameter('isMuted', shouldMute);
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

    // If no tracks are muted or soloed and trims are default, reload original
    const allDefault = this.tracks.every((t) => !t.isMuted && !t.isSoloed && t.velocityTrim === 1.0);
    if (allDefault) {
      const currentTime = this.sequencer.currentTime;
      const wasPlaying = !this.sequencer.paused;
      this.sequencer.loadNewSongList([{ binary: this.rawMidiBuffer, fileName: this.currentMidiName }]);
      this.sequencer.currentTime = currentTime;
      if (wasPlaying) this.sequencer.play();
      return;
    }

    // Non-destructively parse fresh copy of MIDI to manipulate track events
    const filteredMidi = BasicMIDI.fromArrayBuffer(this.rawMidiBuffer, this.currentMidiName);
    filteredMidi.tracks.forEach((track, i) => {
      const trackMeta = this.tracks[i];
      if (!trackMeta) return;

      const isAudible = (!hasAnySolo || trackMeta.isSoloed) && !trackMeta.isMuted;

      if (!isAudible) {
        // Strip or mute NoteOn events from this track
        track.events = track.events.filter((e) => {
          const status = e.statusByte & 240;
          return status !== 144 && status !== 128; // retain tempo, program change, and CCs so synth state remains consistent
        });
      } else if (trackMeta.velocityTrim !== 1.0) {
        // Apply velocity trim scaling
        track.events.forEach((e) => {
          if ((e.statusByte & 240) === 144 && e.data[1] > 0) {
            e.data[1] = Math.max(1, Math.min(127, Math.round(e.data[1] * trackMeta.velocityTrim)));
          }
        });
      }
    });

    const currentTime = this.sequencer.currentTime;
    const wasPlaying = !this.sequencer.paused;
    this.sequencer.loadNewSongList([{ binary: filteredMidi.writeMIDI(), fileName: this.currentMidiName }]);
    this.sequencer.currentTime = currentTime;
    if (wasPlaying) this.sequencer.play();
  }

  // --- Interactive Virtual Piano direct playback ---

  public playNoteInteractive(channel: number, midiNote: number, velocity: number = 100): void {
    if (!this.synth) return;
    this.resumeAudioContext();
    this.synth.noteOn(channel, midiNote, velocity);
    this.channels[channel].activeNotes.add(midiNote);
    this.notifyNoteEvent(channel, midiNote, velocity, true);
    this.notifyChannelUpdate();
  }

  public stopNoteInteractive(channel: number, midiNote: number): void {
    if (!this.synth) return;
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
