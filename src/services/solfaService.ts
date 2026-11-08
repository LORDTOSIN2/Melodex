/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SolfaInfo } from '../types/midi';

export const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const KEY_CENTERS = [
  { name: 'C Major / A Minor', rootNote: 0 },
  { name: 'G Major / E Minor', rootNote: 7 },
  { name: 'D Major / B Minor', rootNote: 2 },
  { name: 'A Major / F# Minor', rootNote: 9 },
  { name: 'E Major / C# Minor', rootNote: 4 },
  { name: 'B Major / G# Minor', rootNote: 11 },
  { name: 'F# / Gb Major', rootNote: 6 },
  { name: 'Db / C# Major', rootNote: 1 },
  { name: 'Ab Major / F Minor', rootNote: 8 },
  { name: 'Eb Major / C Minor', rootNote: 3 },
  { name: 'Bb Major / G Minor', rootNote: 10 },
  { name: 'F Major / D Minor', rootNote: 5 }
];

// Major scale degree intervals: 0, 2, 4, 5, 7, 9, 11
// Diatonic syllables: do, re, mi, fa, sol, la, ti
// Chromatic inflections: di/ra, ri/me, fi/se, si/le, li/te
const DEGREE_TO_SOLFA: { [interval: number]: { syllable: string; degree: number; isAccidental: boolean } } = {
  0: { syllable: 'd', degree: 1, isAccidental: false },  // Do
  1: { syllable: 'di', degree: 1, isAccidental: true },  // Di / Ra
  2: { syllable: 'r', degree: 2, isAccidental: false },  // Re
  3: { syllable: 'ri', degree: 2, isAccidental: true },  // Ri / Me
  4: { syllable: 'm', degree: 3, isAccidental: false },  // Mi
  5: { syllable: 'f', degree: 4, isAccidental: false },  // Fa
  6: { syllable: 'fi', degree: 4, isAccidental: true },  // Fi / Se
  7: { syllable: 's', degree: 5, isAccidental: false },  // Sol
  8: { syllable: 'si', degree: 5, isAccidental: true },  // Si / Le
  9: { syllable: 'l', degree: 6, isAccidental: false },  // La
  10: { syllable: 'ta', degree: 7, isAccidental: true }, // Ta / Li
  11: { syllable: 't', degree: 7, isAccidental: false }  // Ti
};

/**
 * Gets standard pitch name for a MIDI note (e.g. 60 -> "C4")
 */
export function getPitchName(midiNote: number): string {
  const noteName = PITCH_NAMES[midiNote % 12];
  const octave = Math.floor(midiNote / 12) - 1;
  return `${noteName}${octave}`;
}

/**
 * Calculates Movable-Do Solfa notation for a given MIDI note based on key root
 */
export function getSolfaInfo(midiNote: number, rootKeyIndex: number = 0): SolfaInfo {
  // Interval from root key (0-11)
  const pitchClass = midiNote % 12;
  const interval = (pitchClass - rootKeyIndex + 12) % 12;
  const mapping = DEGREE_TO_SOLFA[interval] || { syllable: '?', degree: 0, isAccidental: false };

  // Calculate octave relative to middle C (note 60) in the chosen key
  const octave = Math.floor(midiNote / 12) - 1;
  const relativeOctave = octave - 4; // 0 for 4th octave (e.g. C4-B4)

  // Add solfa octave marks if desired: d' for higher, d, for lower
  let formattedSyllable = mapping.syllable;
  if (relativeOctave > 0) {
    formattedSyllable += "'".repeat(relativeOctave);
  } else if (relativeOctave < 0) {
    formattedSyllable += ",".repeat(Math.abs(relativeOctave));
  }

  return {
    syllable: formattedSyllable,
    degree: mapping.degree,
    chromaticOffset: interval,
    isAccidental: mapping.isAccidental,
    octaveOffset: relativeOctave
  };
}
