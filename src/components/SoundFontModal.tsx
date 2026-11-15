/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { Volume2, X, Upload, HardDrive, Zap, Trash2, Mic } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { SOLFA_DEGREE_NAMES } from '../services/solfaService';
import { SoundFontMeta, SolfegeBankMeta } from '../types/midi';

interface SoundFontModalProps {
  isOpen: boolean;
  onClose: () => void;
  soundFonts: SoundFontMeta[];
  solfegeBankMeta: SolfegeBankMeta | null;
  isSoundFontLoaded: boolean;
}

export const SoundFontModal: React.FC<SoundFontModalProps> = ({
  isOpen,
  onClose,
  soundFonts,
  solfegeBankMeta,
  isSoundFontLoaded
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const solfegeInputRef = useRef<HTMLInputElement>(null);
  const [loadingStatus, setLoadingStatus] = useState<{ progress: number; message: string } | null>(null);

  if (!isOpen) return null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoadingStatus({ progress: 10, message: `Reading ${file.name}...` });
      await audioEngine.loadCustomSoundFont(file, (progress, message) => {
        setLoadingStatus({ progress, message });
      });
      setTimeout(() => setLoadingStatus(null), 1200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadingStatus({ progress: 100, message: `Error loading SoundFont: ${msg}` });
      setTimeout(() => setLoadingStatus(null), 3000);
    }
    e.target.value = '';
  };

  const handleSwitchSoundFont = async (type: 'compact' | 'full') => {
    try {
      setLoadingStatus({
        progress: 10,
        message: type === 'compact' ? 'Loading Compact SF3 (6.1MB)...' : 'Loading Full SF2 (30MB)...'
      });
      await audioEngine.loadSoundFont(type, (progress, message) => {
        setLoadingStatus({ progress, message });
      });
      setTimeout(() => setLoadingStatus(null), 1200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadingStatus({ progress: 100, message: `Error: ${msg}` });
      setTimeout(() => setLoadingStatus(null), 3000);
    }
  };

  const handleClearCache = async () => {
    await audioEngine.clearSoundFontCache();
    setLoadingStatus({ progress: 100, message: 'Browser SoundFont cache cleared from IndexedDB.' });
    setTimeout(() => setLoadingStatus(null), 2500);
  };

  const handleSolfegeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setLoadingStatus({ progress: 15, message: `Layering Solfege SF2 (${file.name})...` });
      await audioEngine.loadSolfegeSoundFont(file, (progress, message) => {
        setLoadingStatus({ progress, message });
      });
      setTimeout(() => setLoadingStatus(null), 1600);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadingStatus({ progress: 100, message: `Solfege SF2 Error: ${msg}` });
      setTimeout(() => setLoadingStatus(null), 3500);
    }
    e.target.value = '';
  };

  const handleLoadBundledSolfege = async () => {
    try {
      setLoadingStatus({ progress: 15, message: 'Loading bundled QDSolfege (1.2MB)...' });
      await audioEngine.loadBundledSolfegeSoundFont((progress, message) => {
        setLoadingStatus({ progress, message });
      });
      setTimeout(() => setLoadingStatus(null), 1600);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadingStatus({ progress: 100, message: `Bundled Solfege Error: ${msg}` });
      setTimeout(() => setLoadingStatus(null), 3500);
    }
  };

  const handleRemoveSolfege = async () => {
    await audioEngine.removeSolfegeSoundFont();
    setLoadingStatus({ progress: 100, message: 'Removed layered Solfege vocal bank.' });
    setTimeout(() => setLoadingStatus(null), 2000);
  };

  const activeFont = soundFonts[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 shadow-2xl text-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <Volume2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                SoundFont &amp; Synthesis Bank Manager
              </h2>
              <p className="text-xs text-slate-400">
                Select between compact and full soundfonts, or import custom SF2/SF3 files.
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

        {/* Persistence Banner */}
        <div className="my-3.5 p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-2.5 text-xs text-slate-300">
          <HardDrive className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-slate-100">Persistent Browser Storage (IndexedDB): </span>
            <span className="text-slate-400">
              Once downloaded or uploaded, SoundFonts are cached permanently on your local device. Returning to the app or refreshing loads them in ~50ms with <strong>0 bytes of network download</strong>.
            </span>
          </div>
        </div>

        {/* Loading Progress Notification */}
        {loadingStatus && (
          <div className="my-3 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-indigo-300 font-medium">{loadingStatus.message}</span>
              <span className="font-mono text-indigo-400">{loadingStatus.progress}%</span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                style={{ width: `${loadingStatus.progress}%` }}
                className="h-full bg-indigo-500 transition-all duration-150"
              />
            </div>
          </div>
        )}

        {/* Built-in SoundFont Profiles */}
        <div className="my-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Available SoundBanks
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Option 1: Compact SF3 (6.1MB) */}
            <div
              onClick={() => handleSwitchSoundFont('compact')}
              className={`p-3 rounded-xl border cursor-pointer transition-all ${
                activeFont?.id === 'generaluser_compact_sf3'
                  ? 'bg-indigo-950/60 border-indigo-500 shadow-md ring-1 ring-indigo-500'
                  : 'bg-slate-950 border-slate-800 hover:border-slate-700 hover:bg-slate-900/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 font-bold text-xs text-white">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Compact GM (6.1MB)</span>
                </div>
                {activeFont?.id === 'generaluser_compact_sf3' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/40">
                    Active
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 leading-tight">
                Vorbis-compressed SF3 format. 79% smaller than SF2, ultra-fast download and lightweight memory footprint.
              </p>
            </div>

            {/* Option 2: Full Studio SF2 (30MB) */}
            <div
              onClick={() => handleSwitchSoundFont('full')}
              className={`p-3 rounded-xl border cursor-pointer transition-all ${
                activeFont?.id === 'generaluser_full_sf2' || activeFont?.id === 'generaluser_default'
                  ? 'bg-indigo-950/60 border-indigo-500 shadow-md ring-1 ring-indigo-500'
                  : 'bg-slate-950 border-slate-800 hover:border-slate-700 hover:bg-slate-900/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 font-bold text-xs text-white">
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Studio GS (30MB)</span>
                </div>
                {(activeFont?.id === 'generaluser_full_sf2' || activeFont?.id === 'generaluser_default') && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
                    Active
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 leading-tight">
                Uncompressed 16-bit PCM wavetables with multi-velocity layers for maximum acoustic detail.
              </p>
            </div>
          </div>
        </div>

        {/* Drag-and-drop / Custom Upload Area (Main Bank 0) */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl p-3.5 text-center cursor-pointer bg-slate-950/40 hover:bg-slate-950 transition-colors my-3 group"
        >
          <Upload className="w-5 h-5 text-slate-500 group-hover:text-indigo-400 mx-auto mb-1 transition-colors" />
          <p className="text-xs font-semibold text-slate-200">
            Import Custom Main SoundFont (.sf2 or .sf3)
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Replaces or supplements Bank 0 General MIDI instruments.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sf2,.sf3,.dls"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>

        {/* Layered Solfege Vocal SoundBank (Bank Offset 100) */}
        <div className="my-3 p-3.5 rounded-xl bg-cyan-950/20 border border-cyan-500/30 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/20 text-cyan-300 flex items-center justify-center border border-cyan-500/30">
                <Mic className="w-3.5 h-3.5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-cyan-100">
                  Layered Solfege Vocal Bank (Bank 100 • Polyphonic)
                </h3>
                <p className="text-[10px] text-cyan-300/75">
                  Bundled QDSolfege V3.1 (Movable-Do). GeneralUser GS stays active on Bank 0 for drums &amp; accompaniment.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(!solfegeBankMeta || !solfegeBankMeta.name.includes('Bundled')) && (
                <button
                  type="button"
                  onClick={handleLoadBundledSolfege}
                  className="px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Use Bundled QDSolfege
                </button>
              )}
              <button
                type="button"
                onClick={() => solfegeInputRef.current?.click()}
                className="px-2.5 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-semibold transition-colors cursor-pointer"
              >
                {solfegeBankMeta ? 'Upload Custom .sf2' : 'Load Custom .sf2'}
              </button>
              {solfegeBankMeta && (
                <button
                  type="button"
                  onClick={handleRemoveSolfege}
                  className="px-2 py-1.5 rounded-md bg-slate-800 hover:bg-rose-600/80 text-slate-300 hover:text-white text-[11px] font-medium transition-colors"
                  title="Unload Solfege Vocal SoundFont"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              ref={solfegeInputRef}
              type="file"
              accept=".sf2,.sf3"
              className="hidden"
              onChange={handleSolfegeUpload}
            />
          </div>

          {solfegeBankMeta ? (
            <div className="bg-slate-950/70 rounded-lg p-2.5 border border-slate-800 text-[11px] space-y-1.5">
              <div className="flex items-center justify-between text-slate-300">
                <span className="font-semibold truncate">{solfegeBankMeta.name}</span>
                <span className="font-mono text-[10px] text-cyan-400">
                  {(solfegeBankMeta.sizeBytes / (1024 * 1024)).toFixed(2)} MB • {solfegeBankMeta.detectedDegrees.length}/12 presets
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {SOLFA_DEGREE_NAMES.map((syllable, deg) => {
                  const found = solfegeBankMeta.detectedDegrees.includes(deg);
                  return (
                    <span
                      key={deg}
                      title={
                        found
                          ? `Program ${deg}: ${solfegeBankMeta.presetNames[deg]}`
                          : `Program ${deg} missing (uses nearest syllable fallback)`
                      }
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                        found
                          ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                          : 'bg-slate-900 text-slate-500 border-slate-800'
                      }`}
                    >
                      {deg}:{syllable}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">
              No Solfege SoundFont currently active. Click <strong className="text-emerald-300">Use Bundled QDSolfege</strong> or upload a custom `.sf2`/`.sf3`, then toggle <strong className="text-cyan-300">Solfa</strong> on any channel in the Mixer.
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800">
          <button
            onClick={handleClearCache}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-rose-400 bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700"
            title="Clear stored soundfonts from IndexedDB cache"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Local Cache</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition-colors shadow-md shadow-indigo-600/30"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
