/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Eye, Music, Volume2, Sparkles } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { getPitchName, getSolfaInfo, KEY_CENTERS } from '../services/solfaService';
import { GM_INSTRUMENTS } from '../services/gmInstruments';
import { SolfaMode } from '../types/midi';

// Distinctive color palette for 16 MIDI channels
export const CHANNEL_COLORS = [
  '#3b82f6', // 0: Blue (Piano)
  '#10b981', // 1: Emerald (Bass/Organ)
  '#f59e0b', // 2: Amber (Strings)
  '#ec4899', // 3: Pink (Brass)
  '#8b5cf6', // 4: Purple (Lead)
  '#06b6d4', // 5: Cyan (Woodwind)
  '#f97316', // 6: Orange (Guitar)
  '#14b8a6', // 7: Teal (Pad)
  '#84cc16', // 8: Lime (Ensemble)
  '#ef4444', // 9: Red (Percussion/Drums)
  '#a855f7', // 10: Violet
  '#6366f1', // 11: Indigo
  '#eab308', // 12: Yellow
  '#d946ef', // 13: Fuchsia
  '#22c55e', // 14: Green
  '#64748b'  // 15: Slate
];

// Computer keyboard mappings to note offsets relative to startNote (Middle C = 60)
const KEYBOARD_MAP: { [key: string]: number } = {
  // Lower Octave (starts at C4 = 60)
  a: 60, // C4
  w: 61, // C#4
  s: 62, // D4
  e: 63, // D#4
  d: 64, // E4
  f: 65, // F4
  t: 66, // F#4
  g: 67, // G4
  y: 68, // G#4
  h: 69, // A4
  u: 70, // A#4
  j: 71, // B4
  k: 72, // C5
  o: 73, // C#5
  l: 74, // D5
  p: 75, // D#5
  ';': 76 // E5
};

interface VirtualPianoProps {
  selectedChannel: number;
  onChannelSelect: (ch: number) => void;
}

export const VirtualPiano: React.FC<VirtualPianoProps> = ({
  selectedChannel,
  onChannelSelect
}) => {
  // Key configuration
  const [totalVisibleKeys, setTotalVisibleKeys] = useState<number>(49); // 25, 49, 61, 76, 88
  const [startKeyIndex, setStartKeyIndex] = useState<number>(36); // Note 36 (C2)
  const [solfaMode, setSolfaMode] = useState<SolfaMode>('both'); // 'pitch' | 'solfa' | 'both'
  const [rootKeyIndex, setRootKeyIndex] = useState<number>(0); // 0 = C Major
  const [activeNotesMap, setActiveNotesMap] = useState<Map<number, number>>(new Map()); // midiNote -> channel
  const [keyboardShortcutOctaveShift, setKeyboardShortcutOctaveShift] = useState<number>(0); // -2 to +2

  const activeNotesMapRef = useRef(activeNotesMap);
  activeNotesMapRef.current = activeNotesMap;

  // Track active mouse note
  const [mouseActiveNote, setMouseActiveNote] = useState<number | null>(null);
  const isMouseDownRef = useRef(false);

  // Subscribe to real-time note events from audio engine
  useEffect(() => {
    const unsubscribe = audioEngine.onNoteEvent((channel, midiNote, velocity, isNoteOn) => {
      setActiveNotesMap((prev) => {
        const next = new Map(prev);
        if (isNoteOn) {
          next.set(midiNote, channel);
        } else {
          next.delete(midiNote);
        }
        return next;
      });
    });

    return () => unsubscribe();
  }, []);

  // Computer keyboard musical typing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key in KEYBOARD_MAP && !e.repeat) {
        const baseNote = KEYBOARD_MAP[key];
        const shiftedNote = Math.max(0, Math.min(127, baseNote + keyboardShortcutOctaveShift * 12));
        audioEngine.playNoteInteractive(selectedChannel, shiftedNote, 100);
      } else if (e.key === 'z') {
        // Octave down
        setKeyboardShortcutOctaveShift((prev) => Math.max(-2, prev - 1));
      } else if (e.key === 'x') {
        // Octave up
        setKeyboardShortcutOctaveShift((prev) => Math.min(2, prev + 1));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key in KEYBOARD_MAP) {
        const baseNote = KEYBOARD_MAP[key];
        const shiftedNote = Math.max(0, Math.min(127, baseNote + keyboardShortcutOctaveShift * 12));
        audioEngine.stopNoteInteractive(selectedChannel, shiftedNote);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedChannel, keyboardShortcutOctaveShift]);

  // Handle global mouse up for glissando
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      isMouseDownRef.current = false;
      if (mouseActiveNote !== null) {
        audioEngine.stopNoteInteractive(selectedChannel, mouseActiveNote);
        setMouseActiveNote(null);
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [mouseActiveNote, selectedChannel]);

  // Generate piano keys in the visible range (standard 88 keys range from 21 to 108)
  const keys = useMemo(() => {
    const endKeyIndex = Math.min(108, startKeyIndex + totalVisibleKeys);
    const result: Array<{
      note: number;
      isBlack: boolean;
      pitch: string;
      solfa: ReturnType<typeof getSolfaInfo>;
      shortcutKey?: string;
    }> = [];

    // Invert keyboard map for visual display
    const keyToChar = new Map<number, string>();
    Object.entries(KEYBOARD_MAP).forEach(([char, note]) => {
      keyToChar.set(note + keyboardShortcutOctaveShift * 12, char.toUpperCase());
    });

    for (let n = startKeyIndex; n < endKeyIndex; n++) {
      const pitchClass = n % 12;
      const isBlack = [1, 3, 6, 8, 10].includes(pitchClass);
      result.push({
        note: n,
        isBlack,
        pitch: getPitchName(n),
        solfa: getSolfaInfo(n, rootKeyIndex),
        shortcutKey: keyToChar.get(n)
      });
    }
    return result;
  }, [startKeyIndex, totalVisibleKeys, rootKeyIndex, keyboardShortcutOctaveShift]);

  const whiteKeys = useMemo(() => keys.filter((k) => !k.isBlack), [keys]);

  // Mouse note triggers
  const handleKeyMouseDown = (note: number) => {
    isMouseDownRef.current = true;
    setMouseActiveNote(note);
    audioEngine.playNoteInteractive(selectedChannel, note, 110);
  };

  const handleKeyMouseEnter = (note: number) => {
    if (isMouseDownRef.current && mouseActiveNote !== note) {
      if (mouseActiveNote !== null) {
        audioEngine.stopNoteInteractive(selectedChannel, mouseActiveNote);
      }
      setMouseActiveNote(note);
      audioEngine.playNoteInteractive(selectedChannel, note, 110);
    }
  };

  const handleKeyMouseLeave = (note: number) => {
    if (isMouseDownRef.current && mouseActiveNote === note) {
      audioEngine.stopNoteInteractive(selectedChannel, note);
      setMouseActiveNote(null);
    }
  };

  return (
    <div className="bg-slate-900 border-b border-slate-800 p-4 select-none">
      {/* Keyboard Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-semibold text-slate-200">
            <Music className="w-4 h-4 text-indigo-400" />
            <span>Virtual Piano Keyboard</span>
          </div>

          {/* Interactive Channel Selector */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-md border border-slate-800">
            <span className="text-slate-400 font-medium">Input Channel:</span>
            <select
              value={selectedChannel}
              onChange={(e) => onChannelSelect(parseInt(e.target.value))}
              className="bg-slate-800 text-white rounded px-2 py-0.5 border border-slate-700 font-mono focus:outline-none"
            >
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i}>
                  Ch {i + 1} {i === 9 ? '(Drums)' : `(${GM_INSTRUMENTS[audioEngine.getChannels()[i]?.program || 0]})`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Viewport & Solfa Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Solfa Mode Selector */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-md border border-slate-800">
            <Eye className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-400">Labels:</span>
            <div className="flex rounded bg-slate-800 p-0.5 border border-slate-700">
              {(['pitch', 'solfa', 'both'] as SolfaMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSolfaMode(mode)}
                  className={`px-2 py-0.5 rounded text-[11px] capitalize transition-colors ${
                    solfaMode === mode ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Tonic Solfa Root Key Center */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-md border border-slate-800">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400">Key Center (Do):</span>
            <select
              value={rootKeyIndex}
              onChange={(e) => setRootKeyIndex(parseInt(e.target.value))}
              className="bg-slate-800 text-white rounded px-2 py-0.5 border border-slate-700 font-medium focus:outline-none"
            >
              {KEY_CENTERS.map((k) => (
                <option key={k.rootNote} value={k.rootNote}>
                  {k.name}
                </option>
              ))}
            </select>
          </div>

          {/* Visible Keys Size */}
          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-md border border-slate-800">
            <span className="text-slate-400">Keys:</span>
            {[25, 49, 61, 88].map((size) => (
              <button
                key={size}
                onClick={() => {
                  setTotalVisibleKeys(size);
                  if (startKeyIndex + size > 108) {
                    setStartKeyIndex(Math.max(21, 108 - size));
                  }
                }}
                className={`px-1.5 py-0.5 rounded font-mono text-[11px] ${
                  totalVisibleKeys === size ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {size}
              </button>
            ))}
          </div>

          {/* Octave Shift Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setStartKeyIndex((prev) => Math.max(21, prev - 12))}
              disabled={startKeyIndex <= 21}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white border border-slate-700"
              title="Pan keyboard 1 octave lower"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-slate-300 font-mono text-[11px] px-1">
              Octave {Math.floor(startKeyIndex / 12) - 1}
            </span>
            <button
              onClick={() => setStartKeyIndex((prev) => Math.min(108 - totalVisibleKeys, prev + 12))}
              disabled={startKeyIndex + totalVisibleKeys >= 108}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white border border-slate-700"
              title="Pan keyboard 1 octave higher"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Musical Typing Hint */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2 px-1">
        <span>
          💡 <strong>Musical Typing Active:</strong> Play keys <code>A, W, S, E, D, F, T, G, Y, H, U, J, K...</code> (Press <code>Z</code>/<code>X</code> to shift octave)
        </span>
        <span className="text-slate-500">
          Showing Notes {getPitchName(startKeyIndex)} to {getPitchName(Math.min(108, startKeyIndex + totalVisibleKeys - 1))}
        </span>
      </div>

      {/* Realistic Piano Keyboard Surface */}
      <div className="relative w-full h-36 bg-slate-950 rounded-lg p-1.5 shadow-inner border border-slate-800 overflow-hidden flex">
        {/* Render White Keys in Flex Row */}
        <div className="relative w-full h-full flex">
          {whiteKeys.map((key) => {
            const isPlaying = activeNotesMap.has(key.note) || mouseActiveNote === key.note;
            const channel = activeNotesMap.get(key.note) ?? selectedChannel;
            const channelColor = isPlaying ? CHANNEL_COLORS[channel % CHANNEL_COLORS.length] : undefined;

            return (
              <div
                key={key.note}
                onMouseDown={() => handleKeyMouseDown(key.note)}
                onMouseEnter={() => handleKeyMouseEnter(key.note)}
                onMouseLeave={() => handleKeyMouseLeave(key.note)}
                style={{
                  backgroundColor: isPlaying ? channelColor : '#f8fafc',
                  boxShadow: isPlaying ? `0 0 16px ${channelColor}` : undefined
                }}
                className={`relative flex-1 h-full rounded-b-md border-r border-slate-300 last:border-r-0 cursor-pointer transition-colors duration-75 flex flex-col justify-end items-center pb-2 select-none group ${
                  isPlaying ? 'translate-y-0.5' : 'hover:bg-slate-100 shadow-[inset_0_-4px_6px_rgba(0,0,0,0.15)]'
                }`}
              >
                {/* Visual labels on white keys */}
                <div className="flex flex-col items-center pointer-events-none">
                  {key.shortcutKey && (
                    <span className="text-[9px] font-mono font-bold text-slate-400 mb-0.5 px-1 rounded bg-slate-200/60">
                      {key.shortcutKey}
                    </span>
                  )}
                  {(solfaMode === 'solfa' || solfaMode === 'both') && (
                    <span
                      className={`font-bold text-[11px] leading-tight ${
                        isPlaying ? 'text-white' : key.solfa.isAccidental ? 'text-violet-600' : 'text-indigo-600'
                      }`}
                    >
                      {key.solfa.syllable}
                    </span>
                  )}
                  {(solfaMode === 'pitch' || solfaMode === 'both') && (
                    <span
                      className={`text-[10px] font-semibold leading-tight ${
                        isPlaying ? 'text-white' : 'text-slate-600'
                      }`}
                    >
                      {key.pitch}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Render Black Keys Absolutely Overlaid */}
        <div className="absolute inset-x-1.5 top-1.5 h-20 pointer-events-none flex">
          {whiteKeys.map((whiteKey, idx) => {
            // Find if there is a black key immediately following this white key
            const pitchClass = whiteKey.note % 12;
            const hasBlackKey = [0, 2, 5, 7, 9].includes(pitchClass) && whiteKey.note + 1 <= 108;
            if (!hasBlackKey) return <div key={idx} className="flex-1 pointer-events-none" />;

            const blackKeyNote = whiteKey.note + 1;
            const blackKeyData = keys.find((k) => k.note === blackKeyNote);
            if (!blackKeyData) return <div key={idx} className="flex-1 pointer-events-none" />;

            const isPlaying = activeNotesMap.has(blackKeyNote) || mouseActiveNote === blackKeyNote;
            const channel = activeNotesMap.get(blackKeyNote) ?? selectedChannel;
            const channelColor = isPlaying ? CHANNEL_COLORS[channel % CHANNEL_COLORS.length] : undefined;

            return (
              <div key={idx} className="flex-1 relative pointer-events-none">
                <div
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    handleKeyMouseDown(blackKeyNote);
                  }}
                  onMouseEnter={() => handleKeyMouseEnter(blackKeyNote)}
                  onMouseLeave={() => handleKeyMouseLeave(blackKeyNote)}
                  style={{
                    backgroundColor: isPlaying ? channelColor : '#0f172a',
                    boxShadow: isPlaying ? `0 0 16px ${channelColor}` : '0 4px 6px rgba(0,0,0,0.5)'
                  }}
                  className={`pointer-events-auto absolute right-[-30%] top-0 w-[60%] h-full rounded-b-md border border-slate-900 cursor-pointer z-10 transition-colors duration-75 flex flex-col justify-end items-center pb-1.5 select-none ${
                    isPlaying ? 'translate-y-0.5' : 'hover:bg-slate-800'
                  }`}
                >
                  <div className="flex flex-col items-center pointer-events-none">
                    {blackKeyData.shortcutKey && (
                      <span className="text-[8px] font-mono text-slate-400 mb-0.5 px-0.5 rounded bg-slate-800">
                        {blackKeyData.shortcutKey}
                      </span>
                    )}
                    {(solfaMode === 'solfa' || solfaMode === 'both') && (
                      <span className="font-bold text-[9px] text-amber-300 leading-none">
                        {blackKeyData.solfa.syllable}
                      </span>
                    )}
                    {(solfaMode === 'pitch' || solfaMode === 'both') && (
                      <span className="text-[8px] font-medium text-slate-300 leading-none">
                        {blackKeyData.pitch}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
