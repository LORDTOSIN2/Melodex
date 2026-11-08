/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Activity, X, Zap, Cpu, AlertTriangle, Play, Square, CheckCircle } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { BenchmarkMetrics } from '../types/midi';

interface BenchmarkPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BenchmarkPanel: React.FC<BenchmarkPanelProps> = ({ isOpen, onClose }) => {
  const [metrics, setMetrics] = useState<BenchmarkMetrics>({
    activeVoices: 0,
    peakVoices: 0,
    audioTimeMs: 0,
    stressTestRunning: false,
    stressVoicesGenerated: 0
  });

  useEffect(() => {
    const unsubscribe = audioEngine.onBenchmark((m) => {
      setMetrics(m);
    });
    return () => unsubscribe();
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 shadow-2xl text-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Voice Polyphony Benchmark &amp; Audio Diagnostics
              </h2>
              <p className="text-xs text-slate-400">
                Live synthesizer telemetry, voice stealing analysis, and stress testing.
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

        {/* Real-time Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 my-5">
          {/* Active Voices */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block mb-1">
              Active Voices
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold font-mono text-indigo-400">
                {metrics.activeVoices}
              </span>
              <span className="text-xs text-slate-500">voices</span>
            </div>
            {/* Visual voice load bar */}
            <div className="w-full h-1.5 bg-slate-800 rounded-full mt-2 overflow-hidden">
              <div
                style={{ width: `${Math.min(100, (metrics.activeVoices / 128) * 100)}%` }}
                className={`h-full transition-all duration-100 ${
                  metrics.activeVoices > 100 ? 'bg-rose-500' : metrics.activeVoices > 64 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
              />
            </div>
          </div>

          {/* Peak Voices */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block mb-1">
              Peak Voices
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold font-mono text-emerald-400">
                {metrics.peakVoices}
              </span>
              <span className="text-xs text-slate-500">voices</span>
            </div>
            <span className="text-[10px] text-slate-500 mt-2 block">
              Target baseline: 128 voices
            </span>
          </div>

          {/* Audio Engine Clock */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 col-span-2 sm:col-span-1">
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block mb-1">
              Audio Clock Time
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold font-mono text-slate-200">
                {(metrics.audioTimeMs / 1000).toFixed(1)}
              </span>
              <span className="text-xs text-slate-500">sec</span>
            </div>
            <span className="text-[10px] text-emerald-400/80 mt-2 block flex items-center gap-1">
              <CheckCircle className="w-3 h-3 inline" /> AudioWorklet Active
            </span>
          </div>
        </div>

        {/* Stress Testing Section */}
        <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-200">
                Polyphony Stress Test (Benchmark 128+ Target)
              </h3>
            </div>
            {metrics.stressTestRunning ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                Test Running...
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400">
                Idle
              </span>
            )}
          </div>

          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            This stress test triggers dense multi-octave harmonic chord clusters across 4 channels to evaluate how many voices your device can synthesize simultaneously before voice stealing or audio dropouts occur.
          </p>

          <div className="flex items-center justify-between">
            <div className="text-xs font-mono text-slate-300">
              Generated in test: <strong className="text-white">{metrics.stressVoicesGenerated}</strong> notes
            </div>

            {metrics.stressTestRunning ? (
              <button
                onClick={() => audioEngine.stopPolyphonyBenchmark()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs transition-colors shadow-md"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop Benchmark</span>
              </button>
            ) : (
              <button
                onClick={() => audioEngine.runPolyphonyBenchmark()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition-colors shadow-md shadow-indigo-600/30"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Stress Test</span>
              </button>
            )}
          </div>
        </div>

        {/* Technical Architecture Notes */}
        <div className="text-xs text-slate-400 space-y-1.5 bg-slate-950 p-3 rounded-lg border border-slate-800/80">
          <div className="font-semibold text-slate-300">Synth Engine Specifications:</div>
          <ul className="list-disc pl-4 space-y-1 text-slate-400 text-[11px]">
            <li>Synthesis Pipeline: AudioWorklet multithreaded processor (44.1kHz sample rate).</li>
            <li>Voice Stealing: Soft envelope attenuation with least-recently-played voice reassignment.</li>
            <li>Dynamic Filters: Resonant lowpass filters and dual DAHDSR envelopes per voice.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
