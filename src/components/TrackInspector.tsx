/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Layers, Info, VolumeX, Volume2, ShieldAlert } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { TrackInfo } from '../types/midi';
import { CHANNEL_COLORS } from './VirtualPiano';

interface TrackInspectorProps {
  tracks: TrackInfo[];
}

export const TrackInspector: React.FC<TrackInspectorProps> = ({ tracks }) => {
  // Detect shared channels across tracks
  const channelToTracksMap = React.useMemo(() => {
    const map = new Map<number, number[]>();
    tracks.forEach((track) => {
      track.channels.forEach((ch) => {
        if (!map.has(ch)) map.set(ch, []);
        map.get(ch)!.push(track.index);
      });
    });
    return map;
  }, [tracks]);

  if (tracks.length === 0) {
    return (
      <div className="bg-slate-900/60 p-6 rounded-xl border border-slate-800 text-center text-slate-400">
        <Layers className="w-8 h-8 text-slate-600 mx-auto mb-2" />
        <p className="text-sm font-medium">No MIDI file loaded yet.</p>
        <p className="text-xs text-slate-500 mt-1">
          Open a MIDI file or pick a demo song to inspect tracks and per-track isolation controls.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-indigo-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
            MIDI Track Inspector ({tracks.length} Tracks)
          </h2>
        </div>

        {/* Informative banner on Track vs Channel separation */}
        <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
          <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span>
            <strong>Track-Level Isolation:</strong> Track Mute/Solo filters note events before synthesis, so you can isolate tracks sharing the same channel.
          </span>
        </div>
      </div>

      {/* Track List Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300 border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-mono uppercase text-[10px]">
              <th className="py-2 px-3 w-12">#</th>
              <th className="py-2 px-3">Track Name</th>
              <th className="py-2 px-3">Routed MIDI Channels</th>
              <th className="py-2 px-3">Notes / Events</th>
              <th className="py-2 px-3">Velocity Trim</th>
              <th className="py-2 px-3 text-right">Track Mute / Solo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {tracks.map((track) => {
              // Check if any channel assigned to this track is shared with another track
              const isSharingChannel = track.channels.some(
                (ch) => (channelToTracksMap.get(ch)?.length || 0) > 1
              );

              return (
                <tr
                  key={track.index}
                  className={`hover:bg-slate-800/40 transition-colors ${
                    track.isMuted
                      ? 'opacity-40'
                      : track.isSoloed
                      ? 'bg-amber-500/10'
                      : ''
                  }`}
                >
                  {/* Track Number */}
                  <td className="py-2.5 px-3 font-mono font-bold text-slate-400">
                    T{track.index}
                  </td>

                  {/* Track Name & Shared Indicator */}
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-100">{track.name}</span>
                      {isSharingChannel && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px] bg-violet-500/10 text-violet-300 border border-violet-500/20"
                          title="This track shares its MIDI channel with one or more other tracks"
                        >
                          Shared Channel
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Assigned MIDI Channels */}
                  <td className="py-2.5 px-3">
                    <div className="flex flex-wrap gap-1">
                      {track.channels.length > 0 ? (
                        track.channels.map((ch) => (
                          <span
                            key={ch}
                            style={{
                              backgroundColor: `${CHANNEL_COLORS[ch % CHANNEL_COLORS.length]}20`,
                              borderColor: `${CHANNEL_COLORS[ch % CHANNEL_COLORS.length]}50`,
                              color: CHANNEL_COLORS[ch % CHANNEL_COLORS.length]
                            }}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-bold border"
                          >
                            {ch === 9 ? 'Ch 10 (Drums)' : `Ch ${ch + 1}`}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-600 italic">Global / Metadata</span>
                      )}
                    </div>
                  </td>

                  {/* Event Counts */}
                  <td className="py-2.5 px-3 font-mono text-slate-400">
                    <span className="text-white font-medium">{track.noteCount}</span> notes{' '}
                    <span className="text-slate-500 text-[10px]">({track.eventCount} events)</span>
                  </td>

                  {/* Velocity Trim */}
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2 max-w-[140px]">
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.1}
                        value={track.velocityTrim}
                        onChange={(e) =>
                          audioEngine.setTrackVelocityTrim(track.index, parseFloat(e.target.value))
                        }
                        className="w-20 h-1.5 bg-slate-800 rounded accent-indigo-500 cursor-pointer"
                        title={`Velocity Trim: ${Math.round(track.velocityTrim * 100)}%`}
                      />
                      <span className="font-mono text-[10px] text-slate-400">
                        {Math.round(track.velocityTrim * 100)}%
                      </span>
                    </div>
                  </td>

                  {/* Track Mute / Solo Buttons */}
                  <td className="py-2.5 px-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        onClick={() => audioEngine.toggleTrackMute(track.index)}
                        className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-colors ${
                          track.isMuted
                            ? 'bg-rose-600 text-white border-rose-500'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                        }`}
                        title="Mute this track's note events"
                      >
                        Mute
                      </button>
                      <button
                        onClick={() => audioEngine.toggleTrackSolo(track.index)}
                        className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-colors ${
                          track.isSoloed
                            ? 'bg-amber-500 text-slate-950 border-amber-400'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                        }`}
                        title="Solo this track (silences all non-soloed tracks)"
                      >
                        Solo
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
