/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { audioEngine } from './services/audioEngine';
import { ChannelState, TrackInfo, SoundFontMeta, SequencerNote } from './types/midi';
import { Header } from './components/Header';
import { TransportBar } from './components/TransportBar';
import { VirtualPiano } from './components/VirtualPiano';
import { MixerConsole } from './components/MixerConsole';
import { TrackInspector } from './components/TrackInspector';
import { PianoRoll } from './components/PianoRoll';
import { SoundFontModal } from './components/SoundFontModal';
import { DemoModal } from './components/DemoModal';
import { BenchmarkPanel } from './components/BenchmarkPanel';
import { Music, Play, Sliders, Layers, Sparkles, Volume2, Activity, ArrowRight } from 'lucide-react';
import { DEMO_SONGS } from './services/gmInstruments';

export default function App() {
  // Initialization state
  const [hasStarted, setHasStarted] = useState(false);
  const [initProgress, setInitProgress] = useState<{ progress: number; message: string }>({
    progress: 0,
    message: ''
  });

  // SoundFont state
  const [isSoundFontLoaded, setIsSoundFontLoaded] = useState(false);
  const [soundFonts, setSoundFonts] = useState<SoundFontMeta[]>([]);

  // Transport state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [tempoBpm, setTempoBpm] = useState(120);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [transpose, setTranspose] = useState(0);
  const [isLooping, setIsLooping] = useState(false);
  const [currentSongTitle, setCurrentSongTitle] = useState('');

  // Channel & Track State
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [selectedChannel, setSelectedChannel] = useState(0);

  // Active View Tab ('both' | 'pianoroll' | 'mixer' | 'tracks')
  const [activeTab, setActiveTab] = useState<'both' | 'pianoroll' | 'mixer' | 'tracks'>('both');
  const [parsedNotes, setParsedNotes] = useState<SequencerNote[]>([]);

  // Benchmark stats
  const [activeVoices, setActiveVoices] = useState(0);
  const [peakVoices, setPeakVoices] = useState(0);

  // Modals
  const [isSoundFontModalOpen, setIsSoundFontModalOpen] = useState(false);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isBenchmarkOpen, setIsBenchmarkOpen] = useState(false);

  // Setup subscribers
  useEffect(() => {
    const unsubTransport = audioEngine.onTransport((curr, dur, playing, bpm) => {
      setCurrentTime(curr);
      setDuration(dur);
      setIsPlaying(playing);
      setTempoBpm(bpm);
    });

    const unsubChannels = audioEngine.onChannelUpdate((chList) => {
      setChannels([...chList]);
      setTracks([...audioEngine.getTracks()]);
      setParsedNotes([...audioEngine.getParsedNotes()]);
      setIsSoundFontLoaded(audioEngine.getIsSoundFontLoaded());
      setSoundFonts([...audioEngine.getSoundFonts()]);
    });

    const unsubBenchmark = audioEngine.onBenchmark((m) => {
      setActiveVoices(m.activeVoices);
      setPeakVoices(m.peakVoices);
    });

    return () => {
      unsubTransport();
      unsubChannels();
      unsubBenchmark();
    };
  }, []);

  // Global spacebar shortcut for play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        if (hasStarted) {
          if (isPlaying) {
            audioEngine.pause();
          } else {
            audioEngine.play();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasStarted, isPlaying]);

  // Start initialization flow
  const handleStartMelodex = async () => {
    setHasStarted(true);
    setInitProgress({ progress: 10, message: 'Initializing Web Audio & AudioWorklet Engine...' });
    try {
      await audioEngine.initialize();
      setInitProgress({ progress: 30, message: 'Loading General MIDI SoundFont (30MB)...' });
      await audioEngine.loadDefaultSoundFont((pct, msg) => {
        setInitProgress({ progress: pct, message: msg });
      });

      // Automatically load the first demo song ("Take Five") as starter
      const demo = DEMO_SONGS[0];
      const res = await fetch(demo.path);
      const buf = await res.arrayBuffer();
      await audioEngine.loadMidi(buf, `${demo.title}.mid`);
      setCurrentSongTitle(demo.title);
      setInitProgress({ progress: 100, message: 'Ready!' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(err);
      setInitProgress({ progress: 100, message: `Notice: ${msg}` });
    }
  };

  // Transport handlers
  const handleTogglePlay = () => {
    if (isPlaying) {
      audioEngine.pause();
    } else {
      audioEngine.play();
    }
  };

  const handleStop = () => {
    audioEngine.stop();
  };

  const handleSeek = (sec: number) => {
    audioEngine.seek(sec);
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    audioEngine.setPlaybackRate(rate);
  };

  const handleTransposeChange = (semi: number) => {
    setTranspose(semi);
    audioEngine.setTranspose(semi);
  };

  const handleToggleLoop = () => {
    const looping = audioEngine.toggleLoop();
    setIsLooping(looping);
  };

  // If not started yet, display the startup screen
  if (!hasStarted) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center items-center p-6 relative overflow-hidden select-none">
        {/* Background glow effects */}
        <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/3 w-96 h-96 bg-violet-600/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-xl w-full text-center space-y-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-xl shadow-indigo-500/25 mb-2">
            <Music className="w-8 h-8 text-white" />
          </div>

          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              Melodex Workstation
            </h1>
            <p className="text-slate-400 text-sm mt-2 max-w-md mx-auto">
              Modern browser-based MIDI player, General MIDI SoundFont synthesizer, 16-channel mixing console, and interactive virtual piano.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-left my-4">
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
              <Volume2 className="w-4 h-4 text-emerald-400 mb-1" />
              <div className="font-semibold text-xs text-slate-200">SF2 &amp; SF3 Synthesis</div>
              <div className="text-[11px] text-slate-400 mt-0.5">30MB GeneralUser GS SoundFont</div>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
              <Sliders className="w-4 h-4 text-indigo-400 mb-1" />
              <div className="font-semibold text-xs text-slate-200">Separated Controls</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Independent Track &amp; Channel mixing</div>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 col-span-2 sm:col-span-1">
              <Sparkles className="w-4 h-4 text-amber-400 mb-1" />
              <div className="font-semibold text-xs text-slate-200">Virtual Piano &amp; Solfa</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Movable-Do notation &amp; typing</div>
            </div>
          </div>

          <button
            onClick={handleStartMelodex}
            className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-sm transition-all shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 group cursor-pointer"
          >
            <span>Initialize Audio &amp; Start Melodex</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>

          <p className="text-[11px] text-slate-500">
            Clicking activates the Web Audio API engine in compliance with browser autoplay security standards.
          </p>
        </div>
      </div>
    );
  }

  // Loading indicator while SoundFont is downloading/parsing
  if (!isSoundFontLoaded && initProgress.progress < 100) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center items-center p-6 select-none">
        <div className="max-w-md w-full bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-2xl space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30 animate-pulse">
              <Volume2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">Loading SoundBank</h2>
              <p className="text-xs text-slate-400">{initProgress.message || 'Preparing synthesizer...'}</p>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-400">Download &amp; Parse</span>
              <span className="text-indigo-400 font-bold">{initProgress.progress}%</span>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                style={{ width: `${initProgress.progress}%` }}
                className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-200 rounded-full"
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-500 text-center">
            Loading GeneralUser GS SoundFont (30MB) into AudioWorklet memory.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* 1. Header with branding, status, and actions */}
      <Header
        isSoundFontLoaded={isSoundFontLoaded}
        soundFonts={soundFonts}
        activeVoices={activeVoices}
        peakVoices={peakVoices}
        onOpenSoundFontModal={() => setIsSoundFontModalOpen(true)}
        onOpenDemoModal={() => setIsDemoModalOpen(true)}
        onOpenBenchmark={() => setIsBenchmarkOpen(true)}
        currentSongTitle={currentSongTitle}
      />

      {/* 2. Transport & Playback Bar */}
      <TransportBar
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        tempoBpm={tempoBpm}
        playbackRate={playbackRate}
        transpose={transpose}
        isLooping={isLooping}
        onTogglePlay={handleTogglePlay}
        onStop={handleStop}
        onSeek={handleSeek}
        onRateChange={handleRateChange}
        onTransposeChange={handleTransposeChange}
        onToggleLoop={handleToggleLoop}
      />

      {/* 3. Core Virtual Piano (Refinement 2: Brought forward as primary workspace element) */}
      <VirtualPiano
        selectedChannel={selectedChannel}
        onChannelSelect={setSelectedChannel}
      />

      {/* 4. Workstation Workspace (Tabs for Mixer, Tracks, and Combined Overview) */}
      <main className="flex-1 p-4 max-w-7xl mx-auto w-full space-y-4">
        {/* View Switcher Tabs */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('both')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                activeTab === 'both'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>Full Workstation</span>
            </button>
            <button
              onClick={() => setActiveTab('pianoroll')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                activeTab === 'pianoroll'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Music className="w-3.5 h-3.5" />
              <span>Piano Roll ({parsedNotes.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('mixer')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                activeTab === 'mixer'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>16-Channel Mixer</span>
            </button>
            <button
              onClick={() => setActiveTab('tracks')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                activeTab === 'tracks'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Track Inspector ({tracks.length})</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
            <span>Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">Space</kbd> to Play/Pause</span>
          </div>
        </div>

        {/* Dynamic Tab Panes */}
        {(activeTab === 'both' || activeTab === 'pianoroll') && (
          <PianoRoll
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            notes={parsedNotes}
            selectedChannel={selectedChannel}
          />
        )}

        {(activeTab === 'both' || activeTab === 'mixer') && (
          <MixerConsole
            channels={channels}
            selectedChannel={selectedChannel}
            onSelectChannel={setSelectedChannel}
          />
        )}

        {(activeTab === 'both' || activeTab === 'tracks') && (
          <TrackInspector tracks={tracks} />
        )}
      </main>

      {/* Modals & Dialogs */}
      <SoundFontModal
        isOpen={isSoundFontModalOpen}
        onClose={() => setIsSoundFontModalOpen(false)}
        soundFonts={soundFonts}
        isSoundFontLoaded={isSoundFontLoaded}
      />

      <DemoModal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
        onSongLoaded={(title) => setCurrentSongTitle(title)}
      />

      <BenchmarkPanel
        isOpen={isBenchmarkOpen}
        onClose={() => setIsBenchmarkOpen(false)}
      />
    </div>
  );
}
