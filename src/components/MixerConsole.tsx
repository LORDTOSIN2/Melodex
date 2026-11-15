/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Lock, Unlock, Sliders, Mic } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { ChannelState, SolfegeBankMeta } from '../types/midi';
import { GM_INSTRUMENTS, GM_DRUM_KITS } from '../services/gmInstruments';
import { CHANNEL_COLORS } from './VirtualPiano';

interface MixerConsoleProps {
  channels: ChannelState[];
  selectedChannel: number;
  onSelectChannel: (ch: number) => void;
  solfegeBankMeta: SolfegeBankMeta | null;
  onOpenSoundFontModal: () => void;
}

export const MixerConsole: React.FC<MixerConsoleProps> = ({
  channels,
  selectedChannel,
  onSelectChannel,
  solfegeBankMeta,
  onOpenSoundFontModal
}) => {
  return (
    <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-indigo-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
            16-Channel Mixer Console
          </h2>
          <span className="text-xs text-slate-500 font-mono">
            (CC7 Volume, CC10 Pan, CC91 Reverb &amp; Preset Lock)
          </span>
        </div>
        <div className="text-xs text-slate-400 flex flex-wrap items-center gap-3">
          {solfegeBankMeta ? (
            <button
              type="button"
              onClick={onOpenSoundFontModal}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 transition-colors text-[11px] font-medium"
              title="Layered Solfege Vocal SoundFont on Bank 100"
            >
              <Mic className="w-3 h-3" />
              <span>Solfa Bank: {solfegeBankMeta.name}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenSoundFontModal}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors text-[11px]"
              title="Load a 12-preset Solfege .sf2 layered on Bank 100"
            >
              <Mic className="w-3 h-3 text-cyan-400" />
              <span>+ Load Solfa SF2</span>
            </button>
          )}
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Active Voice Signal
          </span>
          <span className="flex items-center gap-1">
            <Lock className="w-3.5 h-3.5 text-amber-400" /> Preset Locked (Overrides MIDI file)
          </span>
        </div>
      </div>

      {/* 16-Channel Strip Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 lg:grid-cols-16 gap-2 overflow-x-auto pb-2">
        {channels.map((ch) => {
          const isSelected = selectedChannel === ch.channelNumber;
          const channelColor = CHANNEL_COLORS[ch.channelNumber % CHANNEL_COLORS.length];
          const hasNotes = ch.activeNotes.size > 0;

          return (
            <div
              key={ch.channelNumber}
              onClick={() => onSelectChannel(ch.channelNumber)}
              className={`flex flex-col bg-slate-950/80 rounded-lg p-2 border transition-all cursor-pointer ${
                isSelected
                  ? 'border-indigo-500 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-500'
                  : 'border-slate-800/80 hover:border-slate-700'
              }`}
            >
              {/* Channel Header & Badge */}
              <div className="flex items-center justify-between mb-1.5">
                <span
                  style={{ color: channelColor }}
                  className="text-[11px] font-mono font-bold"
                >
                  {ch.channelNumber === 9 ? 'CH 10 (DRUM)' : `CH ${ch.channelNumber + 1}`}
                </span>
                {/* Active LED */}
                <div
                  style={{
                    backgroundColor: hasNotes ? channelColor : '#1e293b',
                    boxShadow: hasNotes ? `0 0 8px ${channelColor}` : 'none'
                  }}
                  className="w-2 h-2 rounded-full transition-colors duration-75"
                />
              </div>

              {/* Instrument Name Dropdown */}
              <div className="mb-2">
                <select
                  value={ch.program}
                  onChange={(e) => {
                    e.stopPropagation();
                    audioEngine.setChannelProgram(ch.channelNumber, parseInt(e.target.value));
                  }}
                  className="w-full bg-slate-900 text-slate-200 text-[10px] rounded px-1 py-1 border border-slate-800 truncate focus:outline-none"
                  title={ch.isDrum ? GM_DRUM_KITS[ch.program] || 'Drum Kit' : GM_INSTRUMENTS[ch.program]}
                >
                  {ch.isDrum
                    ? Object.entries(GM_DRUM_KITS).map(([bank, name]) => (
                        <option key={bank} value={bank}>
                          {name}
                        </option>
                      ))
                    : GM_INSTRUMENTS.map((name, i) => (
                        <option key={i} value={i}>
                          {i}: {name}
                        </option>
                      ))}
                </select>
              </div>

              {/* Preset Lock & Solfa Vocal Toggles */}
              <div className="flex items-center justify-between gap-1 mb-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    audioEngine.toggleChannelPresetLock(ch.channelNumber);
                  }}
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    ch.presetLocked
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                  }`}
                  title="Lock preset to prevent MIDI file program changes from changing this instrument"
                >
                  {ch.presetLocked ? (
                    <>
                      <Lock className="w-2.5 h-2.5" />
                      <span>Lock</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-2.5 h-2.5" />
                      <span>Free</span>
                    </>
                  )}
                </button>

                {ch.channelNumber !== 9 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!solfegeBankMeta) {
                        onOpenSoundFontModal();
                      } else {
                        audioEngine.toggleChannelSolfaVocal(ch.channelNumber);
                      }
                    }}
                    className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                      ch.isSolfaVocal
                        ? 'bg-cyan-500/25 text-cyan-200 border-cyan-400/60 shadow-sm shadow-cyan-500/20'
                        : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-cyan-300'
                    }`}
                    title={
                      solfegeBankMeta
                        ? 'Toggle polyphonic Movable-Do Solfa singing on this channel'
                        : 'Load a 12-preset Solfege .sf2 to sing Movable-Do syllables on this channel'
                    }
                  >
                    <Mic className="w-2.5 h-2.5" />
                    <span>Solfa</span>
                  </button>
                )}
              </div>

              {/* Pan & Reverb Knobs / Sliders */}
              <div className="space-y-1.5 mb-2 bg-slate-900/60 p-1.5 rounded border border-slate-900">
                {/* Pan */}
                <div className="flex items-center justify-between text-[9px] text-slate-400">
                  <span>Pan</span>
                  <span className="font-mono">
                    {ch.pan === 0 ? 'C' : ch.pan < 0 ? `L${Math.round(Math.abs(ch.pan) * 100)}` : `R${Math.round(ch.pan * 100)}`}
                  </span>
                </div>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={ch.pan}
                  onChange={(e) => {
                    e.stopPropagation();
                    audioEngine.setChannelPan(ch.channelNumber, parseFloat(e.target.value));
                  }}
                  className="w-full h-1 bg-slate-800 rounded accent-indigo-400 cursor-pointer"
                />

                {/* Reverb */}
                <div className="flex items-center justify-between text-[9px] text-slate-400">
                  <span>Rev</span>
                  <span className="font-mono">{ch.reverb}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={127}
                  value={ch.reverb}
                  onChange={(e) => {
                    e.stopPropagation();
                    audioEngine.setChannelReverb(ch.channelNumber, parseInt(e.target.value));
                  }}
                  className="w-full h-1 bg-slate-800 rounded accent-violet-400 cursor-pointer"
                />
              </div>

              {/* Volume Fader & Real-Time Animated VU Meter */}
              <div className="flex items-center gap-1.5 h-28 my-1 px-1">
                {/* Vertical Fader */}
                <div className="flex-1 h-full flex flex-col items-center justify-between">
                  <span className="text-[9px] font-mono text-slate-400">{ch.volume}</span>
                  <input
                    type="range"
                    min={0}
                    max={127}
                    value={ch.volume}
                    onChange={(e) => {
                      e.stopPropagation();
                      audioEngine.setChannelVolume(ch.channelNumber, parseInt(e.target.value));
                    }}
                    className="h-20 w-1.5 appearance-none bg-slate-800 rounded accent-indigo-500 cursor-pointer [writing-mode:vertical-lr] [direction:rtl]"
                  />
                  <span className="text-[8px] text-slate-500 font-bold">VOL</span>
                </div>

                {/* Real-Time VU Meter Bar */}
                <div className="w-2.5 h-20 bg-slate-900 rounded-sm p-0.5 flex flex-col justify-end border border-slate-800 overflow-hidden">
                  <div
                    style={{
                      height: `${Math.min(100, ch.activityLevel * 100)}%`,
                      backgroundColor:
                        ch.activityLevel > 0.85
                          ? '#ef4444'
                          : ch.activityLevel > 0.6
                          ? '#eab308'
                          : '#10b981'
                    }}
                    className="w-full rounded-sm transition-all duration-75"
                  />
                </div>
              </div>

              {/* Mute and Solo Buttons */}
              <div className="grid grid-cols-2 gap-1 mt-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    audioEngine.toggleChannelMute(ch.channelNumber);
                  }}
                  className={`py-1 rounded text-[10px] font-bold border transition-colors ${
                    ch.isMuted
                      ? 'bg-rose-600 text-white border-rose-500'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border-slate-800'
                  }`}
                >
                  M
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    audioEngine.toggleChannelSolo(ch.channelNumber);
                  }}
                  className={`py-1 rounded text-[10px] font-bold border transition-colors ${
                    ch.isSoloed
                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border-slate-800'
                  }`}
                >
                  S
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
