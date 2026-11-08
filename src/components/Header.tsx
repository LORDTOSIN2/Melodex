/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Music, Activity, Cpu, Upload, FolderOpen, Volume2, Sparkles } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { SoundFontMeta } from '../types/midi';

interface HeaderProps {
  isSoundFontLoaded: boolean;
  soundFonts: SoundFontMeta[];
  activeVoices: number;
  peakVoices: number;
  onOpenSoundFontModal: () => void;
  onOpenDemoModal: () => void;
  onOpenBenchmark: () => void;
  currentSongTitle: string;
}

export const Header: React.FC<HeaderProps> = ({
  isSoundFontLoaded,
  soundFonts,
  activeVoices,
  peakVoices,
  onOpenSoundFontModal,
  onOpenDemoModal,
  onOpenBenchmark,
  currentSongTitle
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        audioEngine.loadMidi(reader.result, file.name);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  return (
    <header className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-white select-none">
      {/* Brand & Title */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Music className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              Melodex
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-mono border border-indigo-500/20">
              v1.0 Workstation
            </span>
          </div>
          <p className="text-xs text-slate-400 font-medium truncate max-w-[280px] sm:max-w-md">
            {currentSongTitle ? `Playing: ${currentSongTitle}` : 'No MIDI loaded — select a demo or upload'}
          </p>
        </div>
      </div>

      {/* Middle Status Indicators: SoundFont & Voice Counter */}
      <div className="flex items-center gap-2">
        {/* SoundFont Status Pill */}
        <button
          onClick={onOpenSoundFontModal}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            isSoundFontLoaded
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
              : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20 animate-pulse'
          }`}
          title="Click to view SoundFont details or load custom SF2/SF3"
        >
          <Volume2 className="w-3.5 h-3.5" />
          <span className="max-w-[130px] truncate">
            {isSoundFontLoaded
              ? soundFonts[0]?.name?.replace('.sf2', '') || 'GeneralUser GS'
              : 'Loading SoundFont...'}
          </span>
        </button>

        {/* Real-time Voice & Benchmark Pill */}
        <button
          onClick={onOpenBenchmark}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-slate-200 transition-colors"
          title="Click to open Polyphony Benchmark & Diagnostics"
        >
          <Activity className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
          <span>Voices: <strong className="text-white">{activeVoices}</strong></span>
          <span className="text-slate-400 text-[11px]">(Peak {peakVoices})</span>
        </button>
      </div>

      {/* Action Buttons: Demos & Upload */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenDemoModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 transition-colors shadow-sm"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Demo Songs</span>
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-sm shadow-indigo-600/30"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>Open MIDI</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".mid,.midi,.kar"
          className="hidden"
          onChange={handleFileUpload}
        />
      </div>
    </header>
  );
};
