/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TrackInfo {
  index: number;
  name: string;
  channels: number[];
  eventCount: number;
  noteCount: number;
  isMuted: boolean;
  isSoloed: boolean;
  velocityTrim: number; // 0.0 to 2.0 (default 1.0)
}

export interface ChannelState {
  channelNumber: number;
  name: string;
  program: number; // 0 - 127
  isDrum: boolean;
  volume: number; // 0 - 127 (CC 7)
  pan: number; // -1.0 to 1.0 (or CC 10: 0-127)
  reverb: number; // 0 - 127 (CC 91)
  isMuted: boolean;
  isSoloed: boolean;
  presetLocked: boolean;
  activityLevel: number; // 0.0 - 1.0 for VU meter decay
  activeNotes: Set<number>;
}

export interface SoundFontMeta {
  id: string;
  name: string;
  sizeBytes: number;
  isDefault: boolean;
  presetCount: number;
  isCachedLocally?: boolean;
  format?: 'sf2' | 'sf3' | 'custom';
}

export interface BenchmarkMetrics {
  activeVoices: number;
  peakVoices: number;
  audioTimeMs: number;
  stressTestRunning: boolean;
  stressVoicesGenerated: number;
}

export type SolfaMode = 'pitch' | 'solfa' | 'both';

export interface SolfaInfo {
  syllable: string;
  degree: number;
  chromaticOffset: number;
  isAccidental: boolean;
  octaveOffset: number; // -2, -1, 0, 1, 2
}

export interface DemoSong {
  id: string;
  title: string;
  composer: string;
  genre: string;
  path: string;
  description: string;
  estimatedTracks: number;
}

export interface SequencerNote {
  id: string;
  channel: number;
  midiNote: number;
  startTime: number; // in seconds
  duration: number; // in seconds
  velocity: number;
}

export interface SymbolicNote {
  pitch: number; // 0-127
  startBeat: number; // >= 0
  durationBeats: number; // > 0
  velocity: number; // 1-127
}

export interface SymbolicTrack {
  name: string;
  channel: number; // 0-15 (9 = drums)
  program: number; // 0-127 GM program
  isDrum: boolean;
  volume: number; // 0-127
  pan: number; // 0-127 (64 = center)
  notes: SymbolicNote[];
}

export interface SymbolicArrangement {
  title: string;
  bpm: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  musicalKey: string;
  totalBars: number;
  tracks: SymbolicTrack[];
}

export interface MidiSongSummary {
  fileName: string;
  bpm: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  totalBars: number;
  totalBeats: number;
  durationSeconds: number;
  usedChannels: number[];
  existingTracks: {
    index: number;
    name: string;
    channels: number[];
    program: number;
    noteCount: number;
  }[];
  barDigest: string[];
}

export type AiComposeMode = 'create' | 'add_track';

export interface AiComposeRequest {
  mode: AiComposeMode;
  prompt: string;
  bpm?: number;
  musicalKey?: string;
  totalBars?: number;
  timeSignature?: string;
  songSummary?: MidiSongSummary;
}

export interface AiComposeResponse {
  arrangement: SymbolicArrangement;
  modelUsed: string;
}


