/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { ZoomIn, ZoomOut, Eye, Filter, Crosshair, Music, Info } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { SequencerNote } from '../types/midi';
import { CHANNEL_COLORS } from './VirtualPiano';
import { getPitchName } from '../services/solfaService';
import { GM_INSTRUMENTS } from '../services/gmInstruments';

interface PianoRollProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  notes: SequencerNote[];
  selectedChannel: number;
}

export const PianoRoll: React.FC<PianoRollProps> = ({
  currentTime,
  duration,
  isPlaying,
  notes,
  selectedChannel
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Zoom and scroll state
  const [pixelsPerSecond, setPixelsPerSecond] = useState<number>(60); // 20 - 240
  const [noteHeight, setNoteHeight] = useState<number>(10); // 6 - 20
  const [filterChannel, setFilterChannel] = useState<number | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [hoveredNote, setHoveredNote] = useState<SequencerNote | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Pitch range (MIDI 21 to 108 is standard 88 keys)
  const minPitch = 21;
  const maxPitch = 108;
  const totalPitches = maxPitch - minPitch + 1;

  // Filtered notes by selected channel
  const filteredNotes = useMemo(() => {
    if (filterChannel === 'all') return notes;
    return notes.filter((n) => n.channel === filterChannel);
  }, [notes, filterChannel]);

  // Initial scroll to center around average pitch
  useEffect(() => {
    if (containerRef.current && notes.length > 0) {
      const avgPitch = notes.reduce((acc, n) => acc + n.midiNote, 0) / notes.length;
      const targetY = (maxPitch - avgPitch) * noteHeight - 150;
      containerRef.current.scrollTop = Math.max(0, targetY);
    }
  }, [notes.length, noteHeight]);

  // Auto-scroll follow playhead
  useEffect(() => {
    if (autoScroll && isPlaying && containerRef.current) {
      const playheadX = currentTime * pixelsPerSecond;
      const scrollLeft = containerRef.current.scrollLeft;
      const clientWidth = containerRef.current.clientWidth;

      if (playheadX > scrollLeft + clientWidth * 0.75 || playheadX < scrollLeft) {
        containerRef.current.scrollLeft = Math.max(0, playheadX - clientWidth * 0.2);
      }
    }
  }, [currentTime, autoScroll, isPlaying, pixelsPerSecond]);

  // Canvas drawing loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = Math.max(1200, Math.ceil(duration * pixelsPerSecond) + 200);
    const height = totalPitches * noteHeight;

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Draw pitch background grid
    for (let pitch = minPitch; pitch <= maxPitch; pitch++) {
      const y = (maxPitch - pitch) * noteHeight;
      const isBlackKey = [1, 3, 6, 8, 10].includes(pitch % 12);
      const isC = pitch % 12 === 0;

      ctx.fillStyle = isC ? '#1e293b' : isBlackKey ? '#090d16' : '#0f172a';
      ctx.fillRect(0, y, width, noteHeight);

      // Horizontal grid lines
      ctx.strokeStyle = isC ? '#334155' : '#1e293b';
      ctx.lineWidth = isC ? 1.5 : 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // 2. Draw vertical time/beat lines
    const secondsPerMeasure = 2.0; // approx measure line
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 0.5;
    for (let sec = 0; sec <= duration + 5; sec += 0.5) {
      const x = sec * pixelsPerSecond;
      const isMeasure = Math.abs(sec % secondsPerMeasure) < 0.01;

      ctx.strokeStyle = isMeasure ? '#334155' : '#172033';
      ctx.lineWidth = isMeasure ? 1 : 0.5;

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // 3. Draw Notes
    for (const note of filteredNotes) {
      if (note.midiNote < minPitch || note.midiNote > maxPitch) continue;

      const x = note.startTime * pixelsPerSecond;
      const y = (maxPitch - note.midiNote) * noteHeight;
      const w = Math.max(3, note.duration * pixelsPerSecond);
      const h = noteHeight - 1;

      const color = CHANNEL_COLORS[note.channel % CHANNEL_COLORS.length];
      const alpha = 0.4 + (note.velocity / 127) * 0.6;

      // Note body
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.roundRect(x, y + 0.5, w, h, 2);
      ctx.fill();

      // Note border
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Note highlight if playing right now
      if (currentTime >= note.startTime && currentTime <= note.startTime + note.duration) {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.8;
        ctx.fillRect(x, y + 0.5, Math.min(w, 4), h);
      }
    }

    ctx.globalAlpha = 1.0;

    // 4. Draw Playhead cursor
    const playheadX = currentTime * pixelsPerSecond;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    // Playhead glowing cap
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(playheadX, 6, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }, [currentTime, duration, filteredNotes, pixelsPerSecond, noteHeight, totalPitches]);

  useEffect(() => {
    let animId: number;
    const renderLoop = () => {
      draw();
      animId = requestAnimationFrame(renderLoop);
    };
    renderLoop();
    return () => cancelAnimationFrame(animId);
  }, [draw]);

  // Handle clicking on piano roll to seek
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const seekTime = Math.max(0, Math.min(duration, x / pixelsPerSecond));
    audioEngine.seek(seekTime);
  };

  // Handle hover inspection of notes
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const timeAtX = x / pixelsPerSecond;
    const pitchAtY = maxPitch - Math.floor(y / noteHeight);

    const match = filteredNotes.find(
      (n) =>
        n.midiNote === pitchAtY &&
        timeAtX >= n.startTime &&
        timeAtX <= n.startTime + n.duration
    );

    if (match) {
      setHoveredNote(match);
      setHoverPos({ x: e.clientX, y: e.clientY });
    } else {
      setHoveredNote(null);
    }
  };

  return (
    <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800">
      {/* Piano Roll Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 text-xs">
        <div className="flex items-center gap-2">
          <Music className="w-5 h-5 text-indigo-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
            Interactive Piano Roll Sequencer ({filteredNotes.length} Notes)
          </h2>
        </div>

        {/* Filters and Zoom */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Channel Filter Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-md border border-slate-800">
            <Filter className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-400">View Channel:</span>
            <select
              value={filterChannel}
              onChange={(e) =>
                setFilterChannel(e.target.value === 'all' ? 'all' : parseInt(e.target.value))
              }
              className="bg-slate-800 text-white rounded px-2 py-0.5 border border-slate-700 font-medium focus:outline-none"
            >
              <option value="all">All Channels (Full Score)</option>
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i}>
                  Ch {i + 1} {i === 9 ? '(Drums)' : `(${GM_INSTRUMENTS[audioEngine.getChannels()[i]?.program || 0]})`}
                </option>
              ))}
            </select>
          </div>

          {/* Auto Scroll Toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded border transition-colors ${
              autoScroll
                ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
            title="Auto-scroll canvas to follow playhead"
          >
            <Crosshair className="w-3 h-3" />
            <span>Follow Cursor</span>
          </button>

          {/* Zoom Controls */}
          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-md border border-slate-800">
            <span className="text-slate-400">Time Zoom:</span>
            <button
              onClick={() => setPixelsPerSecond((prev) => Math.max(25, prev - 15))}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
              title="Zoom Out Time Axis"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="font-mono text-slate-300 text-[10px] px-1">
              {Math.round((pixelsPerSecond / 60) * 100)}%
            </span>
            <button
              onClick={() => setPixelsPerSecond((prev) => Math.min(200, prev + 15))}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
              title="Zoom In Time Axis"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
          </div>

          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-md border border-slate-800">
            <span className="text-slate-400">Height:</span>
            <button
              onClick={() => setNoteHeight((prev) => Math.max(6, prev - 2))}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
            >
              -
            </button>
            <span className="font-mono text-slate-300 text-[10px] px-1">{noteHeight}px</span>
            <button
              onClick={() => setNoteHeight((prev) => Math.min(22, prev + 2))}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Main Piano Roll Container with Left Piano Sidebar */}
      <div
        ref={containerRef}
        className="relative w-full h-[360px] bg-slate-950 rounded-xl border border-slate-800 overflow-auto flex select-none"
      >
        {/* Left Sticky Pitch Key Sidebar */}
        <div
          style={{ height: `${totalPitches * noteHeight}px` }}
          className="sticky left-0 z-20 w-16 bg-slate-900 border-r border-slate-800 shrink-0 flex flex-col justify-start"
        >
          {Array.from({ length: totalPitches }, (_, i) => {
            const pitch = maxPitch - i;
            const isBlackKey = [1, 3, 6, 8, 10].includes(pitch % 12);
            const isC = pitch % 12 === 0;

            return (
              <div
                key={pitch}
                style={{ height: `${noteHeight}px` }}
                onMouseDown={() => audioEngine.playNoteInteractive(selectedChannel, pitch, 100)}
                onMouseUp={() => audioEngine.stopNoteInteractive(selectedChannel, pitch)}
                className={`w-full flex items-center justify-end pr-1 cursor-pointer transition-colors border-b border-slate-800/40 ${
                  isC
                    ? 'bg-indigo-950/60 text-indigo-300 font-bold'
                    : isBlackKey
                    ? 'bg-slate-950 text-slate-500 hover:bg-slate-800'
                    : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {noteHeight >= 10 && (
                  <span className="text-[8px] font-mono leading-none pointer-events-none">
                    {getPitchName(pitch)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Right Canvas Scrollable Area */}
        <div className="relative flex-1">
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => setHoveredNote(null)}
            className="cursor-crosshair block"
          />
        </div>
      </div>

      {/* Hover Inspection Tooltip */}
      {hoveredNote && hoverPos && (
        <div
          style={{
            position: 'fixed',
            left: `${hoverPos.x + 12}px`,
            top: `${hoverPos.y - 36}px`,
            pointerEvents: 'none'
          }}
          className="z-50 bg-slate-900/95 border border-indigo-500/80 rounded-lg px-2.5 py-1.5 shadow-xl text-white text-[11px] font-mono flex items-center gap-2"
        >
          <span
            style={{ color: CHANNEL_COLORS[hoveredNote.channel % CHANNEL_COLORS.length] }}
            className="font-bold"
          >
            {getPitchName(hoveredNote.midiNote)}
          </span>
          <span className="text-slate-400">
            Ch {hoveredNote.channel + 1} ({GM_INSTRUMENTS[audioEngine.getChannels()[hoveredNote.channel]?.program || 0]})
          </span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-300">{hoveredNote.startTime.toFixed(2)}s</span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400">Vel: {hoveredNote.velocity}</span>
        </div>
      )}

      {/* Footer hint */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 px-1">
        <span>Click on the timeline to scrub playhead. Hover over note blocks to inspect pitch, velocity &amp; timing.</span>
        <span>Canvas accelerated 60fps render with dynamic channel color mapping.</span>
      </div>
    </div>
  );
};
