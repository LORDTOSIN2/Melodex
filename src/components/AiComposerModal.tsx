/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Wand2,
  X,
  Plus,
  Music,
  Download,
  RotateCcw,
  Loader2,
  Sparkles,
  Layers,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { compileArrangementToMidi, mergeTracksIntoMidi } from '../services/midiCompiler';
import { GM_INSTRUMENTS } from '../services/gmInstruments';
import type {
  AiComposeMode,
  AiComposeRequest,
  AiComposeResponse,
  MidiSongSummary,
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
    prompt: 'Upbeat 1970s funk groove with tight kick/snare/hi-hat drums, syncopated slap bassline, Rhodes electric piano chords, and punchy brass stabs.',
    bpm: 112,
    key: 'E Minor',
    bars: 8,
    ts: '4/4'
  },
  {
    label: 'Lo-Fi Chill (82 BPM)',
    prompt: 'Warm lo-fi chillhop beat with dusty swung drums, jazzy Rhodes 7th chords, deep finger bass, and a gentle flute melody.',
    bpm: 82,
    key: 'F Major',
    bars: 8,
    ts: '4/4'
  },
  {
    label: '80s Synthwave (118 BPM)',
    prompt: 'Driving 1980s retro synthwave track with punchy drums, pulsing 8th-note synth bass, lush warm pad chords, and an expressive sawtooth lead melody.',
    bpm: 118,
    key: 'A Minor',
    bars: 8,
    ts: '4/4'
  },
  {
    label: 'Jazz Waltz (3/4)',
    prompt: 'Lyrical jazz waltz in 3/4 time with acoustic upright bass, jazz brush/ride drum pattern, grand piano comping, and alto saxophone melody.',
    bpm: 132,
    key: 'Bb Major',
    bars: 12,
    ts: '3/4'
  }
];

const STEM_PRESETS = [
  {
    label: 'Add Drum Groove',
    prompt: 'Add a tight, dynamic drum kit track on channel 9 (kick, snare, hi-hat, crash accents) that locks onto the current tempo and bar structure.'
  },
  {
    label: 'Add Bassline',
    prompt: 'Add an expressive electric finger bass track that follows the root and fifth harmony of each bar with rhythmic groove.'
  },
  {
    label: 'Add String Pad',
    prompt: 'Add a lush String Ensemble pad track playing smooth voice-led harmonic chords across each bar.'
  },
  {
    label: 'Add Lead Melody',
    prompt: 'Add a memorable, lyrical solo counter-melody (Alto Sax or Acoustic Piano) that complements the existing harmony with natural phrasing.'
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

  const [songSummary, setSongSummary] = useState<MidiSongSummary | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    title: string;
    tracks: SymbolicArrangement['tracks'];
    modelUsed: string;
  } | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSongSummary(audioEngine.getCurrentMidiSummary());
      setCanUndo(audioEngine.canUndoAiEdit());
      setError(null);
    }
  }, [isOpen, currentSongTitle]);

  if (!isOpen) return null;

  const handleModeSwitch = (nextMode: AiComposeMode) => {
    setMode(nextMode);
    setError(null);
    setLastResult(null);
    if (nextMode === 'add_track') {
      setSongSummary(audioEngine.getCurrentMidiSummary());
      setPrompt(STEM_PRESETS[0].prompt);
    } else {
      setPrompt(CREATE_PRESETS[0].prompt);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please describe the music or track you want the AI to generate.');
      return;
    }

    if (mode === 'add_track' && !audioEngine.getCurrentMidiBuffer()) {
      setError('Load or generate a MIDI file first before adding a new track.');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const payload: AiComposeRequest =
        mode === 'create'
          ? {
              mode: 'create',
              prompt: prompt.trim(),
              bpm,
              musicalKey,
              totalBars,
              timeSignature
            }
          : {
              mode: 'add_track',
              prompt: prompt.trim(),
              songSummary: songSummary || audioEngine.getCurrentMidiSummary() || undefined
            };

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
      } else {
        const existingBuf = audioEngine.getCurrentMidiBuffer();
        const existingName = audioEngine.getCurrentMidiName() || 'arrangement.mid';
        if (!existingBuf) {
          throw new Error('No active MIDI buffer found.');
        }
        const merged = mergeTracksIntoMidi(existingBuf, existingName, typed.arrangement.tracks);
        await audioEngine.loadAiMidi(merged.buffer, merged.fileName, true);
        audioEngine.play();
        setSongSummary(audioEngine.getCurrentMidiSummary());
        setLastResult({
          title: `${currentSongTitle || existingName} (+${merged.mergedTracks.length} AI track${merged.mergedTracks.length > 1 ? 's' : ''})`,
          tracks: merged.mergedTracks,
          modelUsed: typed.modelUsed
        });
      }

      setCanUndo(audioEngine.canUndoAiEdit());
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
      setCanUndo(audioEngine.canUndoAiEdit());
      setSongSummary(audioEngine.getCurrentMidiSummary());
      setLastResult(null);
      onMidiUpdated(audioEngine.getCurrentMidiName().replace(/\.mid$/i, ''));
    }
  };

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
              <h2 className="text-base font-bold text-slate-100">AI MIDI Composer</h2>
              <p className="text-xs text-slate-400">
                Create original multi-track MIDIs or add new stems to your active arrangement.
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

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-2 my-4 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => handleModeSwitch('create')}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
              mode === 'create'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Create New MIDI</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('add_track')}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
              mode === 'add_track'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Track / Stem to Current</span>
          </button>
        </div>

        {/* Mode-specific context / controls */}
        {mode === 'create' ? (
          <div className="space-y-3 mb-4">
            {/* Quick Style Presets */}
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

            {/* Musical Parameters */}
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
        ) : (
          <div className="space-y-3 mb-4">
            {/* Active Song Context Card */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Active Song Context</span>
                </div>
                {songSummary && (
                  <span className="font-mono text-[11px] text-indigo-400">
                    {songSummary.bpm} BPM • {songSummary.timeSignatureNumerator}/{songSummary.timeSignatureDenominator} • {songSummary.totalBars} bars
                  </span>
                )}
              </div>
              {songSummary ? (
                <div className="text-[11px] text-slate-400 space-y-1">
                  <div>
                    <strong className="text-slate-300">{songSummary.fileName}</strong> — {songSummary.existingTracks.length} active track(s) on channels [{songSummary.usedChannels.map((c) => c + 1).join(', ')}]
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono truncate">
                    Harmony digest: {songSummary.barDigest.slice(0, 4).join(' | ')}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-amber-400">
                  No MIDI loaded. Load a demo song or create a new MIDI first.
                </p>
              )}
            </div>

            {/* Stem Quick Chips */}
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

        {/* Prompt Textarea */}
        <div className="space-y-1.5 mb-4">
          <label className="text-xs font-semibold text-slate-300 block">
            {mode === 'create'
              ? 'Describe the MIDI arrangement you want to create:'
              : 'Describe the track, drum groove, or instrument stem to add:'}
          </label>
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              mode === 'create'
                ? 'e.g. Soulful Neo-Soul chord progression with Rhodes piano, finger bass, crisp rimshot drums, and synth lead...'
                : 'e.g. Add a syncopated brass horn section and shaker percussion groove...'
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-emerald-300">
                <CheckCircle2 className="w-4 h-4" />
                <span>Loaded into Workstation: {lastResult.title}</span>
              </div>
              <button
                type="button"
                onClick={() => audioEngine.exportCurrentMidi()}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-[11px] transition-colors"
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
            {canUndo && (
              <button
                type="button"
                onClick={handleUndo}
                disabled={isGenerating}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Undo AI Edit</span>
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
              disabled={isGenerating || (mode === 'add_track' && !songSummary)}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold text-xs transition-all shadow-md shadow-indigo-600/30 cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Composing MIDI...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  <span>{mode === 'create' ? 'Generate & Play MIDI' : 'Generate & Merge Track'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
