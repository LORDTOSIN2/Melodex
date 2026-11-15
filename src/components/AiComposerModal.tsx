/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Wand2,
  X,
  Plus,
  Download,
  RotateCcw,
  Loader2,
  Sparkles,
  Layers,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Check
} from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import {
  compileArrangementToMidi,
  mergeTracksIntoMidi,
  replaceTracksInMidi
} from '../services/midiCompiler';
import { GM_INSTRUMENTS } from '../services/gmInstruments';
import type {
  AiComposeMode,
  AiComposeRequest,
  AiComposeResponse,
  MidiSongSummary,
  RemixScope,
  SymbolicArrangement
} from '../types/midi';

interface AiComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSongTitle: string;
  onMidiUpdated: (newTitle: string) => void;
}

const CREATE_PRESETS = [
  {
    label: 'Funk Groove (112 BPM)',
    prompt:
      'Upbeat 1970s funk groove with tight kick/snare/hi-hat drums, syncopated slap bassline, Rhodes electric piano chords, and punchy brass stabs.',
    bpm: 112,
    key: 'E Minor',
    bars: 8,
    ts: '4/4'
  },
  {
    label: 'Lo-Fi Chill (82 BPM)',
    prompt:
      'Warm lo-fi chillhop beat with dusty swung drums, jazzy Rhodes 7th chords, deep finger bass, and a gentle flute melody.',
    bpm: 82,
    key: 'F Major',
    bars: 8,
    ts: '4/4'
  },
  {
    label: '80s Synthwave (118 BPM)',
    prompt:
      'Driving 1980s retro synthwave track with punchy drums, pulsing 8th-note synth bass, lush warm pad chords, and an expressive sawtooth lead melody.',
    bpm: 118,
    key: 'A Minor',
    bars: 8,
    ts: '4/4'
  },
  {
    label: 'Jazz Waltz (3/4)',
    prompt:
      'Lyrical jazz waltz in 3/4 time with acoustic upright bass, jazz brush/ride drum pattern, grand piano comping, and alto saxophone melody.',
    bpm: 132,
    key: 'Bb Major',
    bars: 12,
    ts: '3/4'
  }
];

const STEM_PRESETS = [
  {
    label: 'Add Drum Groove',
    prompt:
      'Add a tight, dynamic drum kit track on channel 9 (kick, snare, hi-hat, crash accents) that locks onto the current tempo and bar structure.'
  },
  {
    label: 'Add Bassline',
    prompt:
      'Add an expressive electric finger bass track that follows the detected chord roots and fifths of each bar with rhythmic groove.'
  },
  {
    label: 'Add String Pad',
    prompt:
      'Add a lush String Ensemble pad track playing smooth voice-led harmonic chords following the detected bar chords.'
  },
  {
    label: 'Add Lead Melody',
    prompt:
      'Add a memorable, lyrical solo counter-melody (Alto Sax or Acoustic Piano) that complements the existing harmony with natural phrasing.'
  }
];

const REMIX_PRESETS = [
  {
    label: 'Lo-Fi Chillhop',
    style: 'Lo-Fi Chillhop',
    bpm: 84,
    prompt:
      'Reimagine this piece as a warm Lo-Fi Chillhop remix with swung dusty drums, mellow Rhodes electric piano 7th voicings, and deep round finger bass.'
  },
  {
    label: '80s Synthwave',
    style: '80s Synthwave',
    bpm: 118,
    prompt:
      'Transform the arrangement into a driving 80s retro Synthwave remix with gated-feel punchy drums, driving 8th-note synth bass, warm analog pads, and bright saw lead.'
  },
  {
    label: 'House / Club',
    style: 'Deep House',
    bpm: 124,
    prompt:
      'Remix into a groovy Deep House track with a 4-on-the-floor kick, crisp off-beat hi-hats, bouncy synth bassline, and rhythmic organ/piano stabs.'
  },
  {
    label: 'Bossa Nova Jazz',
    style: 'Bossa Nova Jazz',
    bpm: 126,
    prompt:
      'Re-arrange into an authentic Bossa Nova acoustic jazz groove with nylon guitar syncopation, upright bass, light brush percussion, and lyrical piano/sax.'
  },
  {
    label: 'Epic Orchestral',
    style: 'Cinematic Orchestral',
    bpm: 104,
    prompt:
      'Re-orchestrate for cinematic symphony orchestra with lush string ensemble swells, French horn/brass harmonies, timpani/percussion hits, and grand piano.'
  },
  {
    label: '90s Funk Groove',
    style: '90s Funk',
    bpm: 110,
    prompt:
      'Remix into a high-energy 90s Funk arrangement with tight pocket drums, syncopated slap bass, Clavinet/Rhodes comping, and punchy brass section.'
  }
];

const KEY_OPTIONS = [
  'C Major', 'G Major', 'D Major', 'F Major', 'Bb Major', 'Eb Major',
  'A Minor', 'E Minor', 'D Minor', 'C Minor', 'G Minor', 'F# Minor'
];

export const AiComposerModal: React.FC<AiComposerModalProps> = ({
  isOpen,
  onClose,
  currentSongTitle,
  onMidiUpdated
}) => {
  const [mode, setMode] = useState<AiComposeMode>('create');
  const [prompt, setPrompt] = useState(CREATE_PRESETS[0].prompt);
  const [bpm, setBpm] = useState<number>(112);
  const [musicalKey, setMusicalKey] = useState<string>('E Minor');
  const [totalBars, setTotalBars] = useState<number>(8);
  const [timeSignature, setTimeSignature] = useState<string>('4/4');

  // Stage 2 Remix state
  const [remixStyle, setRemixStyle] = useState<string>(REMIX_PRESETS[0].style);
  const [remixScope, setRemixScope] = useState<RemixScope>('full');
  const [keepTrackIndices, setKeepTrackIndices] = useState<number[]>([]);
  const [targetBpm, setTargetBpm] = useState<number>(84);
  const [remixBars, setRemixBars] = useState<number>(8);
  const [preserveMelody, setPreserveMelody] = useState<boolean>(true);

  const [songSummary, setSongSummary] = useState<MidiSongSummary | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    title: string;
    tracks: SymbolicArrangement['tracks'];
    keptCount?: number;
    modelUsed: string;
  } | null>(null);
  const [undoCount, setUndoCount] = useState(0);

  const refreshContext = () => {
    const summary = audioEngine.getCurrentMidiSummary();
    setSongSummary(summary);
    setUndoCount(audioEngine.getAiUndoCount());
    if (summary) {
      setRemixBars(Math.min(Math.max(4, summary.totalBars), 16));
      // Pre-select melody/lead track(s) cleanly for keep_selected mode
      const melodyTracks = summary.existingTracks
        .filter((t) => t.role === 'melody' && t.noteCount > 0)
        .map((t) => t.index);
      if (melodyTracks.length > 0) {
        setKeepTrackIndices(melodyTracks);
      } else {
        const firstMelodic = summary.existingTracks.find((t) => !t.isDrum && t.noteCount > 0);
        setKeepTrackIndices(firstMelodic ? [firstMelodic.index] : []);
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshContext();
      setError(null);
    }
  }, [isOpen, currentSongTitle]);

  if (!isOpen) return null;

  const handleModeSwitch = (nextMode: AiComposeMode) => {
    setMode(nextMode);
    setError(null);
    setLastResult(null);
    refreshContext();
    if (nextMode === 'add_track') {
      setPrompt(STEM_PRESETS[0].prompt);
    } else if (nextMode === 'remix') {
      setRemixStyle(REMIX_PRESETS[0].style);
      setTargetBpm(REMIX_PRESETS[0].bpm);
      setPrompt(REMIX_PRESETS[0].prompt);
    } else {
      setPrompt(CREATE_PRESETS[0].prompt);
    }
  };

  const toggleKeepTrack = (trackIndex: number) => {
    setKeepTrackIndices((prev) =>
      prev.includes(trackIndex) ? prev.filter((id) => id !== trackIndex) : [...prev, trackIndex]
    );
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please describe the music, track, or remix direction for the AI.');
      return;
    }

    const activeSummary = songSummary || audioEngine.getCurrentMidiSummary();
    if ((mode === 'add_track' || mode === 'remix') && (!audioEngine.getCurrentMidiBuffer() || !activeSummary)) {
      setError('Load or generate a MIDI file first before adding tracks or remixing.');
      return;
    }

    if (mode === 'remix' && remixScope === 'keep_selected' && keepTrackIndices.length === 0) {
      setError('Select at least one track to keep intact, or switch to Full Arrangement Remix.');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      let payload: AiComposeRequest;

      if (mode === 'create') {
        payload = {
          mode: 'create',
          prompt: prompt.trim(),
          bpm,
          musicalKey,
          totalBars,
          timeSignature
        };
      } else if (mode === 'add_track') {
        payload = {
          mode: 'add_track',
          prompt: prompt.trim(),
          songSummary: activeSummary!
        };
      } else {
        payload = {
          mode: 'remix',
          prompt: prompt.trim(),
          songSummary: activeSummary!,
          remixStyle,
          remixScope,
          keepTrackIndices: remixScope === 'keep_selected' ? keepTrackIndices : [],
          targetBpm,
          targetBars: remixBars,
          preserveMelody
        };
      }

      const res = await fetch('/api/ai/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }

      const typed = data as AiComposeResponse;

      if (mode === 'create') {
        const compiled = compileArrangementToMidi(typed.arrangement);
        await audioEngine.loadAiMidi(compiled.buffer, compiled.fileName, true);
        audioEngine.play();
        onMidiUpdated(compiled.sanitized.title);
        setLastResult({
          title: compiled.sanitized.title,
          tracks: compiled.sanitized.tracks,
          modelUsed: typed.modelUsed
        });
      } else if (mode === 'add_track') {
        const existingBuf = audioEngine.getCurrentMidiBuffer();
        const existingName = audioEngine.getCurrentMidiName() || 'arrangement.mid';
        if (!existingBuf) {
          throw new Error('No active MIDI buffer found.');
        }
        const merged = mergeTracksIntoMidi(existingBuf, existingName, typed.arrangement.tracks);
        await audioEngine.loadAiMidi(merged.buffer, merged.fileName, true);
        audioEngine.play();
        setLastResult({
          title: `${currentSongTitle || existingName} (+${merged.mergedTracks.length} AI track${merged.mergedTracks.length > 1 ? 's' : ''})`,
          tracks: merged.mergedTracks,
          modelUsed: typed.modelUsed
        });
      } else {
        // Stage 2: Remix mode
        if (remixScope === 'keep_selected' && keepTrackIndices.length > 0) {
          const existingBuf = audioEngine.getCurrentMidiBuffer();
          const existingName = audioEngine.getCurrentMidiName() || 'song.mid';
          if (!existingBuf) {
            throw new Error('No active MIDI buffer found.');
          }
          const remixed = replaceTracksInMidi(
            existingBuf,
            existingName,
            keepTrackIndices,
            typed.arrangement.tracks,
            targetBpm
          );
          await audioEngine.loadAiMidi(remixed.buffer, remixed.fileName, true);
          audioEngine.play();
          const baseTitle = currentSongTitle || existingName.replace(/\.mid$/i, '');
          const nextTitle = `${baseTitle} (${remixStyle} Remix)`;
          onMidiUpdated(nextTitle);
          setLastResult({
            title: nextTitle,
            tracks: remixed.mergedTracks,
            keptCount: remixed.keptTrackCount,
            modelUsed: typed.modelUsed
          });
        } else {
          // Full re-arrangement remix
          const arrangementToCompile: SymbolicArrangement = {
            ...typed.arrangement,
            bpm: targetBpm || typed.arrangement.bpm
          };
          const compiled = compileArrangementToMidi(arrangementToCompile);
          await audioEngine.loadAiMidi(compiled.buffer, compiled.fileName, true);
          audioEngine.play();
          onMidiUpdated(compiled.sanitized.title);
          setLastResult({
            title: compiled.sanitized.title,
            tracks: compiled.sanitized.tracks,
            modelUsed: typed.modelUsed
          });
        }
      }

      refreshContext();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUndo = async () => {
    const reverted = await audioEngine.undoLastAiEdit();
    if (reverted) {
      refreshContext();
      setLastResult(null);
      onMidiUpdated(audioEngine.getCurrentMidiName().replace(/\.(mid|midi|kar)$/i, ''));
    }
  };

  const renderSongAnalysisCard = (summary: MidiSongSummary | null) => (
    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200">
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          <span>Musical Analysis</span>
        </div>
        {summary && (
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
            <span className="px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30">
              Key: {summary.estimatedKey}
            </span>
            <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              {summary.bpm} BPM • {summary.timeSignatureNumerator}/{summary.timeSignatureDenominator} • {summary.totalBars} bars
            </span>
          </div>
        )}
      </div>

      {summary ? (
        <div className="space-y-1.5">
          <div className="text-[11px] text-slate-400">
            <strong className="text-slate-300">{summary.fileName}</strong> — {summary.existingTracks.length} track(s) on channels [{summary.usedChannels.map((c) => c + 1).join(', ')}]
          </div>
          {summary.barDetails && summary.barDetails.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {summary.barDetails.slice(0, 8).map((b) => (
                <span
                  key={b.bar}
                  className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-300"
                  title={`Motif: ${b.melodyMotif}`}
                >
                  <span className="text-slate-500">{b.bar}:</span> {b.chordSymbol}
                </span>
              ))}
              {summary.barDetails.length > 8 && (
                <span className="px-1.5 py-0.5 text-[10px] text-slate-500 font-mono">
                  +{summary.barDetails.length - 8} bars analyzed
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-amber-400">
          No MIDI loaded. Load a demo song or create a new MIDI first.
        </p>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl text-white max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-violet-600 to-indigo-500 text-white flex items-center justify-center shadow-lg shadow-violet-600/20">
              <Wand2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">AI MIDI Composer &amp; Remixer</h2>
              <p className="text-xs text-slate-400">
                Create original multi-track MIDIs, layer new stems, or remix existing songs.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3-Mode Switcher */}
        <div className="grid grid-cols-3 gap-1.5 my-4 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => handleModeSwitch('create')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-semibold transition-all ${
              mode === 'create'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Create New</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('add_track')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-semibold transition-all ${
              mode === 'add_track'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Track / Stem</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('remix')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-semibold transition-all ${
              mode === 'remix'
                ? 'bg-violet-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Remix Current</span>
          </button>
        </div>

        {/* Mode-specific context / controls */}
        {mode === 'create' && (
          <div className="space-y-3 mb-4">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-1.5">
                Quick Style Presets
              </span>
              <div className="flex flex-wrap gap-1.5">
                {CREATE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setPrompt(preset.prompt);
                      setBpm(preset.bpm);
                      setMusicalKey(preset.key);
                      setTotalBars(preset.bars);
                      setTimeSignature(preset.ts);
                    }}
                    className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
              <div>
                <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                  Tempo (BPM)
                </label>
                <input
                  type="number"
                  min={40}
                  max={220}
                  value={bpm}
                  onChange={(e) => setBpm(Number(e.target.value) || 120)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                  Musical Key
                </label>
                <select
                  value={musicalKey}
                  onChange={(e) => setMusicalKey(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-white focus:outline-none focus:border-indigo-500"
                >
                  {KEY_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                  Length (Bars)
                </label>
                <select
                  value={totalBars}
                  onChange={(e) => setTotalBars(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-white font-mono focus:outline-none focus:border-indigo-500"
                >
                  {[4, 8, 12, 16].map((bars) => (
                    <option key={bars} value={bars}>
                      {bars} bars
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                  Time Signature
                </label>
                <select
                  value={timeSignature}
                  onChange={(e) => setTimeSignature(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-white font-mono focus:outline-none focus:border-indigo-500"
                >
                  {['4/4', '3/4', '5/4', '6/8'].map((ts) => (
                    <option key={ts} value={ts}>
                      {ts}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {mode === 'add_track' && (
          <div className="space-y-3 mb-4">
            {renderSongAnalysisCard(songSummary)}

            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-1.5">
                Quick Stem Ideas
              </span>
              <div className="flex flex-wrap gap-1.5">
                {STEM_PRESETS.map((stem) => (
                  <button
                    key={stem.label}
                    type="button"
                    onClick={() => setPrompt(stem.prompt)}
                    className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                  >
                    {stem.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {mode === 'remix' && (
          <div className="space-y-3 mb-4">
            {renderSongAnalysisCard(songSummary)}

            {/* Remix Genre / Style Presets */}
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-1.5">
                Remix Genre Styles
              </span>
              <div className="flex flex-wrap gap-1.5">
                {REMIX_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setRemixStyle(preset.style);
                      setTargetBpm(preset.bpm);
                      setPrompt(preset.prompt);
                    }}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                      remixStyle === preset.style
                        ? 'bg-violet-600/30 border-violet-500 text-violet-200'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Remix Scope + Tempo + Bars */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRemixScope('full')}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    remixScope === 'full'
                      ? 'bg-violet-950/60 border-violet-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="font-semibold text-xs">Full Arrangement Remix</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Reimagines all instruments &amp; drums from the analyzed chords &amp; motifs.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setRemixScope('keep_selected')}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    remixScope === 'keep_selected'
                      ? 'bg-violet-950/60 border-violet-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="font-semibold text-xs">Keep Selected Tracks + New Backing</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Preserves chosen original track(s) intact &amp; replaces the rest with AI stems.
                  </div>
                </button>
              </div>

              {remixScope === 'full' ? (
                <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={preserveMelody}
                    onChange={(e) => setPreserveMelody(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-violet-500 focus:ring-0"
                  />
                  <span>Preserve original chord progression &amp; melody motifs in the remix</span>
                </label>
              ) : (
                songSummary && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      Select Original Tracks to Keep Intact ({keepTrackIndices.length} kept):
                    </span>
                    <div className="max-h-28 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 pr-1">
                      {songSummary.existingTracks
                        .filter((t) => t.noteCount > 0)
                        .map((track) => {
                          const isKept = keepTrackIndices.includes(track.index);
                          return (
                            <button
                              key={track.index}
                              type="button"
                              onClick={() => toggleKeepTrack(track.index)}
                              className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border text-left text-[11px] transition-colors ${
                                isKept
                                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                              }`}
                            >
                              <div className="truncate">
                                <span className="font-semibold">{track.name}</span>{' '}
                                <span className="text-[10px] opacity-75">
                                  ({track.role}, {track.noteCount}n)
                                </span>
                              </div>
                              <span
                                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                                  isKept ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800'
                                }`}
                              >
                                {isKept && <Check className="w-3 h-3" />}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )
              )}

              <div className="grid grid-cols-2 gap-2.5 pt-1 border-t border-slate-800/80">
                <div>
                  <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                    Remix Tempo (BPM)
                  </label>
                  <input
                    type="number"
                    min={40}
                    max={220}
                    value={targetBpm}
                    onChange={(e) => setTargetBpm(Number(e.target.value) || 120)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-white font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                    Section Length (Bars)
                  </label>
                  <select
                    value={remixBars}
                    onChange={(e) => setRemixBars(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-white font-mono focus:outline-none focus:border-violet-500"
                  >
                    {[4, 8, 12, 16, 24].map((bars) => (
                      <option key={bars} value={bars}>
                        {bars} bars
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Prompt Textarea */}
        <div className="space-y-1.5 mb-4">
          <label className="text-xs font-semibold text-slate-300 block">
            {mode === 'create'
              ? 'Describe the MIDI arrangement you want to create:'
              : mode === 'add_track'
                ? 'Describe the track, drum groove, or instrument stem to add:'
                : 'Describe how you want the AI to remix or re-arrange this song:'}
          </label>
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              mode === 'create'
                ? 'e.g. Soulful Neo-Soul chord progression with Rhodes piano, finger bass, crisp rimshot drums, and synth lead...'
                : mode === 'add_track'
                  ? 'e.g. Add a syncopated brass horn section and shaker percussion groove...'
                  : 'e.g. Remix into a mellow Lo-Fi Chillhop groove with Rhodes chords and swung drums...'
            }
            className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 p-3 text-sm text-white placeholder-slate-500 focus:outline-none resize-none"
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Success Result Card */}
        {lastResult && (
          <div className="mb-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  Loaded into Workstation: {lastResult.title}
                  {lastResult.keptCount ? ` (${lastResult.keptCount} original track kept)` : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => audioEngine.exportCurrentMidi()}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-[11px] transition-colors shrink-0"
              >
                <Download className="w-3 h-3" />
                <span>Download .mid</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {lastResult.tracks.map((t, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded bg-slate-950/80 border border-slate-800 text-[10px] font-mono text-slate-300"
                >
                  {t.name} • Ch {t.channel + 1} ({t.isDrum ? 'Drums' : GM_INSTRUMENTS[t.program] || 'GM'}) • {t.notes.length} notes
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-slate-800">
          <div className="flex items-center gap-2">
            {undoCount > 0 && (
              <button
                type="button"
                onClick={handleUndo}
                disabled={isGenerating}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Undo AI Edit{undoCount > 1 ? ` (${undoCount})` : ''}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => audioEngine.exportCurrentMidi()}
              disabled={!audioEngine.getCurrentMidiBuffer()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 border border-slate-700 transition-colors"
              title="Download active MIDI file"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export .mid</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || ((mode === 'add_track' || mode === 'remix') && !songSummary)}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold text-xs transition-all shadow-md shadow-indigo-600/30 cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{mode === 'remix' ? 'Remixing Arrangement...' : 'Composing MIDI...'}</span>
                </>
              ) : (
                <>
                  {mode === 'remix' ? <RefreshCw className="w-4 h-4" /> : <Wand2 className="w-4 h-4" />}
                  <span>
                    {mode === 'create'
                      ? 'Generate & Play MIDI'
                      : mode === 'add_track'
                        ? 'Generate & Merge Track'
                        : 'Remix & Play MIDI'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
