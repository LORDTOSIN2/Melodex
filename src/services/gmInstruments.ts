/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const GM_INSTRUMENTS: string[] = [
  // Piano (0-7)
  "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano",
  "Electric Piano 1 (Rhodes)", "Electric Piano 2 (Chorused)", "Harpsichord", "Clavinet",
  // Chromatic Percussion (8-15)
  "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  // Organ (16-23)
  "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  // Guitar (24-31)
  "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)",
  "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar harmonics",
  // Bass (32-39)
  "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass",
  "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  // Strings (40-47)
  "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
  // Ensemble (48-55)
  "String Ensemble 1", "String Ensemble 2", "SynthStrings 1", "SynthStrings 2",
  "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
  // Brass (56-63)
  "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "SynthBrass 1", "SynthBrass 2",
  // Reed (64-71)
  "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
  // Pipe (72-79)
  "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  // Synth Lead (80-87)
  "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)",
  "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
  // Synth Pad (88-95)
  "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)",
  "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
  // Synth Effects (96-103)
  "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)",
  "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
  // Ethnic (104-111)
  "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai",
  // Percussive (112-119)
  "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  // Sound Effects (120-127)
  "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot"
];

export const GM_DRUM_KITS: { [bank: number]: string } = {
  0: "Standard Drum Kit",
  8: "Room Drum Kit",
  16: "Power Drum Kit",
  24: "Electronic Drum Kit",
  25: "TR-808 Drum Kit",
  32: "Jazz Drum Kit",
  40: "Brush Drum Kit",
  48: "Orchestra Drum Kit"
};

export const DEMO_SONGS = [
  {
    id: "take5",
    title: "Take Five",
    composer: "Paul Desmond (Dave Brubeck Quartet)",
    genre: "Cool Jazz (5/4 time)",
    path: "/demo-midis/Take 5 - by Paul Desmond.mid",
    description: "Famous jazz classic in 5/4 swing time with alto sax, acoustic piano, double bass, and drums.",
    estimatedTracks: 6
  },
  {
    id: "earthday",
    title: "Earthday Orchestral Suite",
    composer: "Richard Audd",
    genre: "Symphonic Orchestra",
    path: "/demo-midis/earthday.mid",
    description: "Multi-track orchestral arrangement with 21 tracks (flutes, horns, timpani, strings, brass, glockenspiel).",
    estimatedTracks: 21
  },
  {
    id: "battle",
    title: "To Make the End of Battle",
    composer: "Falcom (SC-88 Arrangement)",
    genre: "Video Game / Rock Fusion",
    path: "/demo-midis/To Make the End of Battle.mid",
    description: "Energetic high-polyphony synthesizer rock track featuring dual electric guitars, slap bass, synth brass, and driving drums.",
    estimatedTracks: 14
  },
  {
    id: "allnight",
    title: "All Night Long",
    composer: "Lionel Richie",
    genre: "R&B / Pop Groove",
    path: "/demo-midis/All Night Long.mid",
    description: "Catchy calypso-pop rhythm arrangement with rich percussive layers, basslines, and brass stabs.",
    estimatedTracks: 8
  },
  {
    id: "christmas",
    title: "The Christmas Song",
    composer: "Mel Tormé & Robert Wells",
    genre: "Vocal Jazz / Ballad",
    path: "/demo-midis/The Christmas Song.mid",
    description: "Lush harmonic ballad showcasing expressive strings, warm piano chords, and muted brass.",
    estimatedTracks: 7
  }
];
