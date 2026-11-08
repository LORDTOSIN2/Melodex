/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Play, Pause, Square, RotateCcw, Repeat, Gauge, Music2 } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';

interface TransportBarProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  tempoBpm: number;
  playbackRate: number;
  transpose: number;
  isLooping: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  onSeek: (seconds: number) => void;
  onRateChange: (rate: number) => void;
  onTransposeChange: (semitones: number) => void;
  onToggleLoop: () => void;
}

export const TransportBar: React.FC<TransportBarProps> = ({
  currentTime,
  duration,
  isPlaying,
  tempoBpm,
  playbackRate,
  transpose,
  isLooping,
  onTogglePlay,
  onStop,
  onSeek,
  onRateChange,
  onTransposeChange,
  onToggleLoop
}) => {
  const [isScrubbing, setIsScrubbing] = React.useState(false);
  const [scrubValue, setScrubValue] = React.useState(0);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  const progressPercent = duration > 0 ? ((isScrubbing ? scrubValue : currentTime) / duration) * 100 : 0;

  return (
    <div className="bg-slate-900/90 backdrop-blur border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-white">
      {/* Primary Transport Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={onStop}
          className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700/60"
          title="Stop & Rewind to Start"
        >
          <Square className="w-4 h-4 fill-current" />
        </button>

        <button
          onClick={onTogglePlay}
          className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all shadow-md shadow-indigo-600/30 flex items-center gap-2"
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? (
            <>
              <Pause className="w-4 h-4 fill-current" />
              <span className="text-sm">Pause</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span className="text-sm">Play</span>
            </>
          )}
        </button>

        <button
          onClick={onToggleLoop}
          className={`p-2.5 rounded-lg border transition-colors ${
            isLooping
              ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/40'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border-slate-700/60'
          }`}
          title="Toggle Song Looping"
        >
          <Repeat className="w-4 h-4" />
        </button>

        {/* Time display */}
        <div className="flex items-center gap-1 font-mono text-xs px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
          <span className="text-indigo-400 font-bold">{formatTime(isScrubbing ? scrubValue : currentTime)}</span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-400">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Center: Scrubber / Timeline bar */}
      <div className="flex-1 min-w-[200px] flex items-center gap-3">
        <div className="relative flex-1 flex items-center group">
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={0.1}
            value={isScrubbing ? scrubValue : currentTime}
            onChange={(e) => {
              setScrubValue(parseFloat(e.target.value));
            }}
            onMouseDown={() => {
              setIsScrubbing(true);
              setScrubValue(currentTime);
            }}
            onMouseUp={(e) => {
              setIsScrubbing(false);
              onSeek(parseFloat((e.target as HTMLInputElement).value));
            }}
            onTouchStart={() => {
              setIsScrubbing(true);
              setScrubValue(currentTime);
            }}
            onTouchEnd={(e) => {
              setIsScrubbing(false);
              onSeek(parseFloat((e.target as HTMLInputElement).value));
            }}
            className="w-full h-2 rounded-lg appearance-none bg-slate-800 accent-indigo-500 cursor-pointer focus:outline-none"
          />
        </div>
      </div>

      {/* Right Controls: Tempo (Rate) & Transposition */}
      <div className="flex items-center gap-4 text-xs">
        {/* Tempo Multiplier */}
        <div className="flex items-center gap-2 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
          <Gauge className="w-3.5 h-3.5 text-indigo-400" />
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Tempo</span>
            <span className="font-mono text-slate-200">
              {Math.round(tempoBpm * playbackRate)} <span className="text-[10px] text-slate-500">BPM</span>
            </span>
          </div>
          <input
            type="range"
            min={0.25}
            max={2.0}
            step={0.05}
            value={playbackRate}
            onChange={(e) => onRateChange(parseFloat(e.target.value))}
            className="w-16 h-1.5 bg-slate-800 rounded accent-indigo-500 cursor-pointer"
            title={`Playback speed: ${playbackRate.toFixed(2)}x`}
          />
          <button
            onClick={() => onRateChange(1.0)}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
            title="Reset tempo to 1.0x"
          >
            {playbackRate.toFixed(2)}x
          </button>
        </div>

        {/* Live Key Transposition */}
        <div className="flex items-center gap-2 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
          <Music2 className="w-3.5 h-3.5 text-violet-400" />
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Transpose</span>
            <span className="font-mono text-slate-200">
              {transpose > 0 ? `+${transpose}` : transpose} <span className="text-[10px] text-slate-500">semi</span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onTransposeChange(transpose - 1)}
              className="w-5 h-5 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
              title="Transpose down 1 semitone"
            >
              -
            </button>
            <button
              onClick={() => onTransposeChange(0)}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              title="Reset transposition to original key (0)"
            >
              {transpose === 0 ? '0' : `${transpose > 0 ? '+' : ''}${transpose}`}
            </button>
            <button
              onClick={() => onTransposeChange(transpose + 1)}
              className="w-5 h-5 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
              title="Transpose up 1 semitone"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
