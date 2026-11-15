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
  BarMusicalSummary,
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

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const CHORD_TEMPLATES: { suffix: string; intervals: number[] }[] = [
  { suffix: '', intervals: [0, 4, 7] },
  { suffix: 'm', intervals: [0, 3, 7] },
  { suffix: '7', intervals: [0, 4, 7, 10] },
  { suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { suffix: 'm7', intervals: [0, 3, 7, 10] },
  { suffix: 'dim', intervals: [0, 3, 6] },
  { suffix: 'sus4', intervals: [0, 5, 7] },
  { suffix: '5', intervals: [0, 7] }
];

function formatMidiPitch(pitch: number): string {
  const name = PITCH_NAMES[((pitch % 12) + 12) % 12];
  const octave = Math.floor(pitch / 12) - 1;
  return `${name}${octave}`;
}

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function estimateMusicalKey(pcWeights: number[]): string {
  const total = pcWeights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 'C Major';

  let bestScore = -Infinity;
  let bestKey = 'C Major';

  for (let root = 0; root < 12; root++) {
    const rotated = Array.from({ length: 12 }, (_, i) => pcWeights[(root + i) % 12]);
    const majScore = pearsonCorrelation(rotated, MAJOR_PROFILE);
    if (majScore > bestScore) {
      bestScore = majScore;
      bestKey = `${PITCH_NAMES[root]} Major`;
    }
    const minScore = pearsonCorrelation(rotated, MINOR_PROFILE);
    if (minScore > bestScore) {
      bestScore = minScore;
      bestKey = `${PITCH_NAMES[root]} Minor`;
    }
  }
  return bestKey;
}

function detectBarChord(pcWeights: number[], lowestPitch: number | null): string {
  const total = pcWeights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 'N.C.';

  const bassPc = lowestPitch !== null ? ((lowestPitch % 12) + 12) % 12 : -1;
  let bestScore = -Infinity;
  let bestLabel = 'N.C.';

  for (let root = 0; root < 12; root++) {
    for (const tpl of CHORD_TEMPLATES) {
      const intervalSet = new Set(tpl.intervals.map((iv) => (root + iv) % 12));
      let inChord = 0;
      let outChord = 0;
      for (let pc = 0; pc < 12; pc++) {
        if (intervalSet.has(pc)) {
          inChord += pcWeights[pc];
        } else {
          outChord += pcWeights[pc];
        }
      }
      let score = inChord - outChord * 0.6 - tpl.intervals.length * 0.04 * total;
      if (bassPc === root) {
        score += total * 0.28; // Favor root matching bass pitch
      }
      if (score > bestScore) {
        bestScore = score;
        bestLabel = `${PITCH_NAMES[root]}${tpl.suffix}`;
      }
    }
  }

  return bestLabel;
}

function inferTrackRole(
  isDrum: boolean,
  melodicChannelCount: number,
  program: number,
  avgPitch: number,
  noteCount: number,
  simultaneousFraction: number
): 'drums' | 'bass' | 'chords' | 'melody' | 'pad' | 'multi' | 'other' {
  if (isDrum) return 'drums';
  if (noteCount === 0) return 'other';
  if (melodicChannelCount > 1) return 'multi';
  if ((program >= 32 && program <= 39) || avgPitch < 48) return 'bass';
  if (program >= 88 && program <= 103) return 'pad';
  if (simultaneousFraction > 0.35) return 'chords';
  if (avgPitch >= 55) return 'melody';
  return 'other';
}

interface ParsedNoteEvent {
  trackIndex: number;
  channel: number;
  pitch: number;
  startTick: number;
  endTick: number;
}

/**
 * Non-destructively preserves selected original track indices and replaces remaining tracks
 * with AI-generated SymbolicTracks (optionally updating tempo for style remixes).
 */
export function replaceTracksInMidi(
  existingBuffer: ArrayBuffer,
  existingName: string,
  keepTrackIndices: number[],
  newTracks: SymbolicTrack[],
  targetBpm?: number
): {
  buffer: ArrayBuffer;
  fileName: string;
  keptTrackCount: number;
  mergedTracks: SymbolicTrack[];
} {
  const sourceMidi = BasicMIDI.fromArrayBuffer(existingBuffer.slice(0), existingName);
  const ppq = sourceMidi.timeDivision || PPQ;

  const outMidi = new BasicMIDI();
  outMidi.format = 1;
  outMidi.timeDivision = ppq;

  // Build dedicated conductor track (Track 0)
  const conductorTrack = new MIDITrack();
  const baseTitle = existingName.replace(/\.(mid|midi|kar)$/i, '') || 'Remix';
  conductorTrack.name = `${baseTitle} (AI Remix)`;

  const conductorEvents: MIDIMessage[] = [
    new MIDIMessage(0, MIDIMessageTypes.trackName, encodeAscii(conductorTrack.name))
  ];

  // Collect time signatures from source
  let hasTimeSig = false;
  let maxConductorTick = 0;
  for (const t of sourceMidi.tracks) {
    for (const ev of t.events) {
      if (ev.statusByte === MIDIMessageTypes.timeSignature) {
        hasTimeSig = true;
        conductorEvents.push(new MIDIMessage(ev.ticks, ev.statusByte, ev.data.slice()));
        if (ev.ticks > maxConductorTick) maxConductorTick = ev.ticks;
      } else if (!targetBpm && ev.statusByte === MIDIMessageTypes.setTempo) {
        conductorEvents.push(new MIDIMessage(ev.ticks, ev.statusByte, ev.data.slice()));
        if (ev.ticks > maxConductorTick) maxConductorTick = ev.ticks;
      }
    }
  }

  if (!hasTimeSig) {
    conductorEvents.push(
      new MIDIMessage(0, MIDIMessageTypes.timeSignature, buildTimeSignatureData(4, 4))
    );
  }

  if (targetBpm && Number.isFinite(targetBpm) && targetBpm > 0) {
    conductorEvents.push(
      new MIDIMessage(0, MIDIMessageTypes.setTempo, buildSetTempoData(targetBpm))
    );
  } else {
    const hasTempo = conductorEvents.some((e) => e.statusByte === MIDIMessageTypes.setTempo);
    if (!hasTempo) {
      conductorEvents.push(
        new MIDIMessage(0, MIDIMessageTypes.setTempo, buildSetTempoData(120))
      );
    }
  }

  conductorEvents.sort((a, b) => a.ticks - b.ticks);
  conductorEvents.push(
    new MIDIMessage(maxConductorTick + 10, MIDIMessageTypes.endOfTrack, new Uint8Array([]))
  );
  conductorTrack.pushEvents(...conductorEvents);
  outMidi.tracks.push(conductorTrack);

  // Copy kept tracks intact (excluding tempo/timeSignature meta events so Track 0 owns timing)
  const keepSet = new Set(keepTrackIndices);
  const keptMelodicChannels = new Set<number>();
  let keptTrackCount = 0;

  sourceMidi.tracks.forEach((srcTrack, idx) => {
    if (!keepSet.has(idx)) return;
    const cloned = new MIDITrack();
    cloned.name = srcTrack.name || `Kept Track ${idx + 1}`;
    cloned.port = srcTrack.port || 0;

    const filteredEvents = srcTrack.events
      .filter(
        (ev) =>
          ev.statusByte !== MIDIMessageTypes.setTempo &&
          ev.statusByte !== MIDIMessageTypes.timeSignature
      )
      .map((ev) => new MIDIMessage(ev.ticks, ev.statusByte, ev.data.slice()));

    if (filteredEvents.length === 0) return;

    const hasEnd = filteredEvents.some((e) => e.statusByte === MIDIMessageTypes.endOfTrack);
    if (!hasEnd) {
      const lastTick = filteredEvents[filteredEvents.length - 1]?.ticks ?? 0;
      filteredEvents.push(
        new MIDIMessage(lastTick + 10, MIDIMessageTypes.endOfTrack, new Uint8Array([]))
      );
    }

    cloned.pushEvents(...filteredEvents);
    outMidi.tracks.push(cloned);
    keptTrackCount++;

    srcTrack.channels.forEach((ch) => {
      if (ch !== 9) keptMelodicChannels.add(ch);
    });
  });

  // Append newly composed AI backing tracks on non-colliding channels
  const sanitizedNewTracks = sanitizeTracks(newTracks, keptMelodicChannels);
  for (const track of sanitizedNewTracks) {
    outMidi.tracks.push(buildMidiTrackFromSymbolic(track, ppq));
  }

  outMidi.flush();
  return {
    buffer: outMidi.writeMIDI(),
    fileName: `${baseTitle}_remix.mid`,
    keptTrackCount,
    mergedTracks: sanitizedNewTracks
  };
}

/**
 * Extracts a rich yet token-efficient musical summary of the currently loaded MIDI
 * (Key estimation, track roles, per-bar chords, bass root, and lead melody motifs)
 * so AI models can compose stems or remix arrangements accurately.
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
  outer: for (const t of midi.tracks) {
    for (const ev of t.events) {
      if (ev.statusByte === MIDIMessageTypes.timeSignature && ev.data.length >= 2) {
        tsNum = ev.data[0] || 4;
        tsDen = Math.pow(2, ev.data[1] ?? 2);
        break outer;
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
  const globalPcWeights = new Array<number>(12).fill(0);
  const allMelodicNotes: ParsedNoteEvent[] = [];

  const existingTracks = midi.tracks.map((track, idx) => {
    let program = 0;
    let noteCount = 0;
    let minPitch = 127;
    let maxPitch = 0;
    let pitchSum = 0;
    let simultaneousCount = 0;
    let prevStartTick = -1;

    const activeStarts = new Map<string, number>();

    for (const ev of track.events) {
      const status = ev.statusByte & 0xf0;
      const ch = ev.statusByte & 0x0f;
      if (status === MIDIMessageTypes.programChange) {
        program = ev.data[0] ?? 0;
      } else if (status === MIDIMessageTypes.noteOn && (ev.data[1] ?? 0) > 0) {
        const pitch = ev.data[0] ?? 60;
        noteCount++;
        pitchSum += pitch;
        if (pitch < minPitch) minPitch = pitch;
        if (pitch > maxPitch) maxPitch = pitch;
        if (prevStartTick !== -1 && Math.abs(ev.ticks - prevStartTick) <= Math.round(ppq * 0.08)) {
          simultaneousCount++;
        }
        prevStartTick = ev.ticks;
        if (ch !== 9) {
          activeStarts.set(`${ch}:${pitch}`, ev.ticks);
        }
      } else if (
        status === MIDIMessageTypes.noteOff ||
        (status === MIDIMessageTypes.noteOn && (ev.data[1] ?? 0) === 0)
      ) {
        const pitch = ev.data[0] ?? 60;
        const key = `${ch}:${pitch}`;
        const startTick = activeStarts.get(key);
        if (startTick !== undefined && ch !== 9) {
          const endTick = Math.max(startTick + Math.round(ppq * 0.125), ev.ticks);
          const durBeats = Math.min(8, (endTick - startTick) / ppq);
          globalPcWeights[pitch % 12] += durBeats;
          allMelodicNotes.push({ trackIndex: idx, channel: ch, pitch, startTick, endTick });
          activeStarts.delete(key);
        }
      }
    }

    // Flush any dangling notes at track end
    for (const [key, startTick] of activeStarts.entries()) {
      const [chStr, pitchStr] = key.split(':');
      const ch = Number(chStr);
      const pitch = Number(pitchStr);
      const endTick = startTick + ppq;
      globalPcWeights[pitch % 12] += 1;
      allMelodicNotes.push({ trackIndex: idx, channel: ch, pitch, startTick, endTick });
    }

    const channels = Array.from(track.channels);
    channels.forEach((c) => usedChannelSet.add(c));
    const melodicChannelCount = channels.filter((c) => c !== 9).length;
    const isDrum = channels.includes(9) && channels.length === 1;
    const avgPitch = noteCount > 0 ? pitchSum / noteCount : 60;
    const simultaneousFraction = noteCount > 1 ? simultaneousCount / noteCount : 0;
    const role = inferTrackRole(
      isDrum,
      melodicChannelCount,
      program,
      avgPitch,
      noteCount,
      simultaneousFraction
    );
    const pitchRange = noteCount > 0 ? `${formatMidiPitch(minPitch)}-${formatMidiPitch(maxPitch)}` : '-';

    return {
      index: idx,
      name: track.name.trim() || `Track ${idx + 1}`,
      channels,
      program,
      noteCount,
      isDrum,
      role,
      pitchRange
    };
  });

  const estimatedKey = estimateMusicalKey(globalPcWeights);

  // Build detailed per-bar harmony & melody analysis for up to 24 bars
  const maxBarsToDigest = Math.min(totalBars, 24);
  const barPcWeights: number[][] = Array.from({ length: maxBarsToDigest }, () =>
    new Array<number>(12).fill(0)
  );
  const barLowestPitch: (number | null)[] = Array.from({ length: maxBarsToDigest }, () => null);
  const barNotes: ParsedNoteEvent[][] = Array.from({ length: maxBarsToDigest }, () => []);

  for (const n of allMelodicNotes) {
    const barIdx = Math.floor(n.startTick / ticksPerBar);
    if (barIdx >= 0 && barIdx < maxBarsToDigest) {
      const durBeats = Math.max(0.25, Math.min(beatsPerBar, (n.endTick - n.startTick) / ppq));
      barPcWeights[barIdx][n.pitch % 12] += durBeats;
      const curLow = barLowestPitch[barIdx];
      if (curLow === null || n.pitch < curLow) {
        barLowestPitch[barIdx] = n.pitch;
      }
      barNotes[barIdx].push(n);
    }
  }

  // Pick melody track if one clearly exists to keep motif extraction super clean
  const melodyTracks = new Set(
    existingTracks.filter((t) => t.role === 'melody').map((t) => t.index)
  );

  const barDetails: BarMusicalSummary[] = Array.from({ length: maxBarsToDigest }, (_, barIdx) => {
    const chordSymbol = detectBarChord(barPcWeights[barIdx], barLowestPitch[barIdx]);
    const bassNote = barLowestPitch[barIdx] !== null ? formatMidiPitch(barLowestPitch[barIdx]!) : null;
    const notesInBar = barNotes[barIdx];

    // Prefer dedicated melody track notes if present; otherwise prefer upper-register pitches (>= G3 / 55)
    let candidateNotes =
      melodyTracks.size > 0 && notesInBar.some((n) => melodyTracks.has(n.trackIndex))
        ? notesInBar.filter((n) => melodyTracks.has(n.trackIndex))
        : notesInBar;
    const upperNotes = candidateNotes.filter((n) => n.pitch >= 55);
    if (upperNotes.length > 0) {
      candidateNotes = upperNotes;
    }

    // Group by quantized 16th-beat onset within bar & keep top pitch per onset (up to 6 motif notes)
    const barStartTick = barIdx * ticksPerBar;
    const stepTicks = Math.max(1, Math.round(ppq / 4));
    const onsetTop = new Map<number, ParsedNoteEvent>();
    for (const n of candidateNotes) {
      const relTick = Math.max(0, n.startTick - barStartTick);
      const qStep = Math.round(relTick / stepTicks);
      const existing = onsetTop.get(qStep);
      if (!existing || n.pitch > existing.pitch) {
        onsetTop.set(qStep, n);
      }
    }

    const motifTokens = Array.from(onsetTop.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, 6)
      .map(([qStep, n]) => {
        const beatInBar = Number((qStep * 0.25).toFixed(2));
        const durBeats = Number(
          Math.max(0.25, Math.min(beatsPerBar, (n.endTick - n.startTick) / ppq)).toFixed(2)
        );
        return `${formatMidiPitch(n.pitch)}@${beatInBar}(${durBeats})`;
      });

    const density: 'sparse' | 'medium' | 'dense' =
      notesInBar.length <= 4 ? 'sparse' : notesInBar.length <= 14 ? 'medium' : 'dense';

    return {
      bar: barIdx + 1,
      chordSymbol,
      bassNote,
      melodyMotif: motifTokens.length > 0 ? motifTokens.join(' ') : 'Rest',
      density
    };
  });

  const barDigest = barDetails.map(
    (b) => `Bar ${b.bar}: ${b.chordSymbol}${b.bassNote ? ` (bass ${b.bassNote})` : ''}`
  );

  return {
    fileName,
    bpm,
    timeSignatureNumerator: tsNum,
    timeSignatureDenominator: tsDen,
    estimatedKey,
    totalBars,
    totalBeats,
    durationSeconds: Number((midi.duration || 0).toFixed(2)),
    usedChannels: Array.from(usedChannelSet).sort((a, b) => a - b),
    existingTracks: existingTracks.filter((t) => t.noteCount > 0 || t.channels.length > 0),
    barDigest,
    barDetails
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
