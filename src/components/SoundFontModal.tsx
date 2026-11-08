/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { Volume2, X, Upload, Check, RefreshCw, FileText, HardDrive } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { SoundFontMeta } from '../types/midi';

interface SoundFontModalProps {
  isOpen: boolean;
  onClose: () => void;
  soundFonts: SoundFontMeta[];
  isSoundFontLoaded: boolean;
}

export const SoundFontModal: React.FC<SoundFontModalProps> = ({
  isOpen,
  onClose,
  soundFonts,
  isSoundFontLoaded
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      setTimeout(() => setLoadingStatus(null), 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadingStatus({ progress: 100, message: `Error loading SoundFont: ${msg}` });
      setTimeout(() => setLoadingStatus(null), 3000);
    }
    e.target.value = '';
  };

  const handleReloadDefault = async () => {
    try {
      setLoadingStatus({ progress: 10, message: 'Reloading default GeneralUser GS...' });
      await audioEngine.loadDefaultSoundFont((progress, message) => {
        setLoadingStatus({ progress, message });
      });
      setTimeout(() => setLoadingStatus(null), 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadingStatus({ progress: 100, message: `Error reloading: ${msg}` });
      setTimeout(() => setLoadingStatus(null), 3000);
    }
  };

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
                Manage General MIDI soundbanks and import custom SF2/SF3 SoundFonts.
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

        {/* Loading Progress Notification */}
        {loadingStatus && (
          <div className="my-4 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl">
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

        {/* Current SoundFonts List */}
        <div className="my-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Loaded SoundBanks ({soundFonts.length})
          </h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {soundFonts.map((sf) => (
              <div
                key={sf.id}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800/80"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-indigo-400" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-100">{sf.name}</span>
                      {sf.isDefault && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                          Active GM Bank
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500 font-mono">
                      {(sf.sizeBytes / (1024 * 1024)).toFixed(1)} MB • {sf.presetCount} GM Presets
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 rounded bg-slate-800 text-[11px] font-mono text-emerald-400 flex items-center gap-1 border border-slate-700">
                    <Check className="w-3 h-3" /> Ready
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Drag-and-drop / Custom Upload Area */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl p-5 text-center cursor-pointer bg-slate-950/50 hover:bg-slate-950 transition-colors my-4 group"
        >
          <Upload className="w-7 h-7 text-slate-500 group-hover:text-indigo-400 mx-auto mb-2 transition-colors" />
          <p className="text-xs font-semibold text-slate-200">
            Click or drag &amp; drop a custom SoundFont (.sf2 or .sf3)
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            Supports SF2 (PCM) and SF3 (Vorbis compressed) instrument banks with multi-velocity zones.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sf2,.sf3,.dls"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-800">
          <button
            onClick={handleReloadDefault}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reload Default GS Bank</span>
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
