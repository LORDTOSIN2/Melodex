/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BasicMIDI,
  MIDIMessage,
  MIDIMessageTypes,
  MIDITrack,
  type MIDIMessageType
} from 'spessasynth_core';
import {
  MidiSongSummary,
  SymbolicArrangement,
  SymbolicNote,
  SymbolicTrack
} from '../types/midi';
import { PITCH_NAMES } from './solfaService';

const PPQ = 480;

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

function encodeAscii(str: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(str.length));
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0x7f;
  }
  return bytes;
}

function buildSetTempoData(bpm: number): Uint8Array<ArrayBuffer> {
  const clampedBpm = clamp(bpm, 30, 280);
  const microsecondsPerBeat = Math.round(60_000_000 / clampedBpm);
  return new Uint8Array([
    (microsecondsPerBeat >> 16) & 0xff,
    (microsecondsPerBeat >> 8) & 0xff,
    microsecondsPerBeat & 0xff
  ]);
}

function buildTimeSignatureData(num: number, den: number): Uint8Array<ArrayBuffer> {
  const clampedNum = clamp(Math.round(num), 1, 16);
  const validDens = [2, 4, 8, 16];
  const closestDen = validDens.reduce((prev, curr) =>
    Math.abs(curr - den) < Math.abs(prev - den) ? curr : prev
  );
  const denPower = Math.round(Math.log2(closestDen));
  return new Uint8Array([clampedNum, denPower, 24, 8]);
}

/**
 * Sanitizes notes on a single track and prevents overlapping identical pitches (stuck-note safe).
 */
function sanitizeNotes(rawNotes: SymbolicNote[], isDrum: boolean, ppq: number): {
  pitch: number;
  startTick: number;
  endTick: number;
  velocity: number;
}[] {
  const cleaned = (rawNotes || [])
    .filter((n) => n && Number.isFinite(n.pitch) && Number.isFinite(n.startBeat))
    .map((n) => {
      const pitch = clamp(Math.round(n.pitch), isDrum ? 27 : 0, isDrum ? 87 : 127);
      const startBeat = Math.max(0, n.startBeat);
      const durationBeats = clamp(n.durationBeats || 0.25, 0.0625, 32);
      const velocity = clamp(Math.round(n.velocity || 96), 1, 127);
      const startTick = Math.round(startBeat * ppq);
      const endTick = Math.max(startTick + 15, Math.round((startBeat + durationBeats) * ppq));
      return { pitch, startTick, endTick, velocity };
    })
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

  // Prevent overlapping notes on the exact same pitch
  const lastByPitch = new Map<number, { pitch: number; startTick: number; endTick: number; velocity: number }>();
  const resolved: typeof cleaned = [];

  for (const note of cleaned) {
    const prev = lastByPitch.get(note.pitch);
    if (prev && prev.endTick > note.startTick) {
      prev.endTick = Math.max(prev.startTick + 10, note.startTick - 2);
    }
    lastByPitch.set(note.pitch, note);
    resolved.push(note);
  }

  return resolved;
}

/**
 * Normalizes track channel assignments so drums always sit on channel 9
 * and melodic tracks do not collide on channel 9 or duplicate channels unnecessarily.
 */
function sanitizeTracks(
  rawTracks: SymbolicTrack[],
  reservedMelodicChannels: Set<number> = new Set()
): SymbolicTrack[] {
  const usedMelodic = new Set<number>(reservedMelodicChannels);

  const pickFreeMelodicChannel = (preferred: number): number => {
    const candidate = clamp(Math.round(preferred), 0, 15);
    if (candidate !== 9 && !usedMelodic.has(candidate)) {
      usedMelodic.add(candidate);
      return candidate;
    }
    for (let ch = 0; ch < 16; ch++) {
      if (ch !== 9 && !usedMelodic.has(ch)) {
        usedMelodic.add(ch);
        return ch;
      }
    }
    // Fallback if all 15 melodic channels are already occupied
    return candidate === 9 ? 0 : candidate;
  };

  return (rawTracks || []).map((track, idx) => {
    const nameLower = (track.name || '').toLowerCase();
    const looksLikeDrum =
      Boolean(track.isDrum) ||
      track.channel === 9 ||
      /\b(drum|drums|percussion|kit|808|909|beats)\b/.test(nameLower);

    const channel = looksLikeDrum ? 9 : pickFreeMelodicChannel(track.channel ?? idx);
    const program = looksLikeDrum ? 0 : clamp(Math.round(track.program ?? 0), 0, 127);

    return {
      name: (track.name || `AI Track ${idx + 1}`).trim(),
      channel,
      program,
      isDrum: looksLikeDrum,
      volume: clamp(Math.round(track.volume ?? 100), 1, 127),
      pan: clamp(Math.round(track.pan ?? 64), 0, 127),
      notes: Array.isArray(track.notes) ? track.notes : []
    };
  });
}

function buildMidiTrackFromSymbolic(track: SymbolicTrack, ppq: number): MIDITrack {
  const midiTrack = new MIDITrack();
  midiTrack.name = track.name;
  midiTrack.port = 0;

  const events: MIDIMessage[] = [];
  events.push(
    new MIDIMessage(0, MIDIMessageTypes.trackName, encodeAscii(track.name))
  );

  if (!track.isDrum) {
    events.push(MIDIMessage.programChange(0, track.channel, track.program));
  } else {
    events.push(MIDIMessage.programChange(0, 9, 0));
  }

  events.push(MIDIMessage.controllerChange(0, track.channel, 7, track.volume));
  events.push(MIDIMessage.controllerChange(0, track.channel, 10, track.pan));
  events.push(MIDIMessage.controllerChange(0, track.channel, 91, 35)); // Subtle reverb

  const notes = sanitizeNotes(track.notes, track.isDrum, ppq);
  const noteEvents: { tick: number; isNoteOn: boolean; pitch: number; velocity: number }[] = [];

  let maxTick = 0;
  for (const n of notes) {
    noteEvents.push({ tick: n.startTick, isNoteOn: true, pitch: n.pitch, velocity: n.velocity });
    noteEvents.push({ tick: n.endTick, isNoteOn: false, pitch: n.pitch, velocity: 0 });
    if (n.endTick > maxTick) maxTick = n.endTick;
  }

  // Sort strictly by tick; NoteOff precedes NoteOn on identical ticks to avoid stuck notes
  noteEvents.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    if (a.isNoteOn !== b.isNoteOn) return a.isNoteOn ? 1 : -1;
    return a.pitch - b.pitch;
  });

  for (const ev of noteEvents) {
    const status = ((ev.isNoteOn ? MIDIMessageTypes.noteOn : MIDIMessageTypes.noteOff) |
      track.channel) as MIDIMessageType;
    events.push(new MIDIMessage(ev.tick, status, new Uint8Array([ev.pitch, ev.velocity])));
  }

  events.push(new MIDIMessage(maxTick + 10, MIDIMessageTypes.endOfTrack, new Uint8Array([])));
  midiTrack.pushEvents(...events);
  return midiTrack;
}

/**
 * Compiles a complete SymbolicArrangement into a Standard MIDI File Type 1 ArrayBuffer.
 */
export function compileArrangementToMidi(arrangement: SymbolicArrangement): {
  buffer: ArrayBuffer;
  fileName: string;
  sanitized: SymbolicArrangement;
} {
  const bpm = clamp(Math.round(arrangement.bpm || 120), 30, 280);
  const num = clamp(Math.round(arrangement.timeSignatureNumerator || 4), 1, 16);
  const den = clamp(Math.round(arrangement.timeSignatureDenominator || 4), 2, 16);
  const title = (arrangement.title || 'AI Composition').trim();
  const sanitizedTracks = sanitizeTracks(arrangement.tracks);

  const midi = new BasicMIDI();
  midi.format = 1;
  midi.timeDivision = PPQ;

  // Conductor / Tempo Track (Track 0)
  const conductorTrack = new MIDITrack();
  conductorTrack.name = title;
  conductorTrack.pushEvents(
    new MIDIMessage(0, MIDIMessageTypes.trackName, encodeAscii(title)),
    new MIDIMessage(0, MIDIMessageTypes.setTempo, buildSetTempoData(bpm)),
    new MIDIMessage(0, MIDIMessageTypes.timeSignature, buildTimeSignatureData(num, den)),
    new MIDIMessage(0, MIDIMessageTypes.endOfTrack, new Uint8Array([]))
  );
  midi.tracks.push(conductorTrack);

  // Instrument Tracks
  for (const track of sanitizedTracks) {
    midi.tracks.push(buildMidiTrackFromSymbolic(track, PPQ));
  }

  midi.flush();
  const buffer = midi.writeMIDI();
  const safeSlug = title.replace(/[^a-z0-9\-_ ]/gi, '').trim().replace(/\s+/g, '_') || 'ai_composition';

  return {
    buffer,
    fileName: `${safeSlug}.mid`,
    sanitized: {
      ...arrangement,
      title,
      bpm,
      timeSignatureNumerator: num,
      timeSignatureDenominator: den,
      tracks: sanitizedTracks
    }
  };
}

/**
 * Non-destructively merges new AI-generated SymbolicTracks into an existing MIDI file buffer.
 */
export function mergeTracksIntoMidi(
  existingBuffer: ArrayBuffer,
  existingName: string,
  newTracks: SymbolicTrack[]
): {
  buffer: ArrayBuffer;
  fileName: string;
  mergedTracks: SymbolicTrack[];
} {
  const midi = BasicMIDI.fromArrayBuffer(existingBuffer.slice(0), existingName);
  const ppq = midi.timeDivision || PPQ;

  const existingMelodicChannels = new Set<number>();
  for (const t of midi.tracks) {
    t.channels.forEach((ch) => {
      if (ch !== 9) existingMelodicChannels.add(ch);
    });
  }

  const sanitizedNewTracks = sanitizeTracks(newTracks, existingMelodicChannels);
  for (const track of sanitizedNewTracks) {
    midi.tracks.push(buildMidiTrackFromSymbolic(track, ppq));
  }

  midi.flush();
  return {
    buffer: midi.writeMIDI(),
    fileName: existingName,
    mergedTracks: sanitizedNewTracks
  };
}

/**
 * Extracts a compact, token-efficient musical summary of the currently loaded MIDI
 * so AI models can harmonize, match tempo/bars, and pick unused channels cleanly.
 */
export function summarizeMidiForAi(buffer: ArrayBuffer, fileName: string): MidiSongSummary {
  const midi = BasicMIDI.fromArrayBuffer(buffer.slice(0), fileName);
  const ppq = midi.timeDivision || PPQ;

  // Primary tempo (tempoChanges is sorted descending by ticks, so last entry is tick 0)
  const initialTempoObj = midi.tempoChanges[midi.tempoChanges.length - 1];
  const bpm = Math.round(initialTempoObj?.tempo || 120);

  // Detect first time signature meta event if present
  let tsNum = 4;
  let tsDen = 4;
  for (const t of midi.tracks) {
    for (const ev of t.events) {
      if (ev.statusByte === MIDIMessageTypes.timeSignature && ev.data.length >= 2) {
        tsNum = ev.data[0] || 4;
        tsDen = Math.pow(2, ev.data[1] ?? 2);
        break;
      }
    }
  }

  const beatsPerBar = tsNum * (4 / tsDen);
  const ticksPerBeat = ppq;
  const ticksPerBar = Math.max(1, Math.round(beatsPerBar * ticksPerBeat));
  const totalTicks = Math.max(ticksPerBar, midi.lastVoiceEventTick || ticksPerBar * 8);
  const totalBars = Math.max(1, Math.ceil(totalTicks / ticksPerBar));
  const totalBeats = Math.round(totalBars * beatsPerBar);

  const usedChannelSet = new Set<number>();
  const existingTracks = midi.tracks.map((track, idx) => {
    let program = 0;
    let noteCount = 0;
    for (const ev of track.events) {
      const status = ev.statusByte & 0xf0;
      if (status === MIDIMessageTypes.programChange) {
        program = ev.data[0] ?? 0;
      } else if (status === MIDIMessageTypes.noteOn && (ev.data[1] ?? 0) > 0) {
        noteCount++;
      }
    }
    const channels = Array.from(track.channels);
    channels.forEach((c) => usedChannelSet.add(c));
    return {
      index: idx,
      name: track.name.trim() || `Track ${idx + 1}`,
      channels,
      program,
      noteCount
    };
  });

  // Build compact pitch-class digest for up to the first 32 bars (keeps AI prompt light & accurate)
  const maxBarsToDigest = Math.min(totalBars, 32);
  const barPitchSets: Set<string>[] = Array.from({ length: maxBarsToDigest }, () => new Set<string>());

  for (const track of midi.tracks) {
    for (const ev of track.events) {
      const status = ev.statusByte & 0xf0;
      const ch = ev.statusByte & 0x0f;
      if (status === MIDIMessageTypes.noteOn && (ev.data[1] ?? 0) > 0 && ch !== 9) {
        const barIdx = Math.floor(ev.ticks / ticksPerBar);
        if (barIdx >= 0 && barIdx < maxBarsToDigest) {
          const pitchName = PITCH_NAMES[(ev.data[0] ?? 60) % 12];
          barPitchSets[barIdx].add(pitchName);
        }
      }
    }
  }

  const barDigest = barPitchSets.map((set, i) => {
    const pitches = Array.from(set).slice(0, 6);
    return `Bar ${i + 1}: ${pitches.length > 0 ? pitches.join(',') : 'Rest'}`;
  });

  return {
    fileName,
    bpm,
    timeSignatureNumerator: tsNum,
    timeSignatureDenominator: tsDen,
    totalBars,
    totalBeats,
    durationSeconds: Number((midi.duration || 0).toFixed(2)),
    usedChannels: Array.from(usedChannelSet).sort((a, b) => a - b),
    existingTracks: existingTracks.filter((t) => t.noteCount > 0 || t.channels.length > 0),
    barDigest
  };
}

/**
 * Triggers a browser download of an ArrayBuffer as a .mid file.
 */
export function downloadMidiBuffer(buffer: ArrayBuffer, fileName: string): void {
  const blob = new Blob([buffer], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.mid') ? fileName : `${fileName}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
