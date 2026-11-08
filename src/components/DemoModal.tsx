/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Sparkles, X, Play, Music, Disc } from 'lucide-react';
import { DEMO_SONGS } from '../services/gmInstruments';
import { audioEngine } from '../services/audioEngine';

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSongLoaded?: (title: string) => void;
}

export const DemoModal: React.FC<DemoModalProps> = ({ isOpen, onClose, onSongLoaded }) => {
  if (!isOpen) return null;

  const handleSelectDemo = async (demo: typeof DEMO_SONGS[0]) => {
    try {
      const response = await fetch(demo.path);
      const buffer = await response.arrayBuffer();
      await audioEngine.loadMidi(buffer, `${demo.title}.mid`);
      audioEngine.play();
      onSongLoaded?.(demo.title);
      onClose();
    } catch (err) {
      console.error('Failed to load demo:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl text-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Select a Demo Song</h2>
              <p className="text-xs text-slate-400">
                Test realistic multi-track arrangements across genres with high polyphony.
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

        {/* Demo Cards List */}
        <div className="my-4 space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
          {DEMO_SONGS.map((demo) => (
            <div
              key={demo.id}
              onClick={() => handleSelectDemo(demo)}
              className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/80 hover:bg-slate-900/80 transition-all cursor-pointer flex items-center justify-between gap-4 group"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20 group-hover:scale-105 transition-transform shrink-0 mt-0.5">
                  <Disc className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-100 group-hover:text-indigo-300 transition-colors">
                      {demo.title}
                    </h3>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-indigo-300 border border-slate-700">
                      {demo.genre}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 font-medium">{demo.composer}</p>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    {demo.description}
                  </p>
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-2">
                <span className="text-[11px] font-mono text-slate-500">
                  ~{demo.estimatedTracks} tracks
                </span>
                <button
                  type="button"
                  className="p-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-sm shadow-indigo-600/30"
                >
                  <Play className="w-4 h-4 fill-current" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-3 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
