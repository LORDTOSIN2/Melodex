# Melodex: Technical Investigation & Architecture Proposal
**A Modern Browser-Based MIDI Playback, Synthesis & Musical Workstation**

---

## Executive Summary

**Melodex** is designed to transcend standard browser MIDI players by unifying high-fidelity General MIDI / SoundFont synthesis, sample-accurate playback scheduling, a professional multi-track / multi-channel mixer, a responsive interactive virtual piano, and a canvas-accelerated piano roll. Crucially, the architecture is designed from day one with an **abstracted musical event pipeline** that separates raw MIDI tick data from acoustic playback, mixer transformation, and future notation systems such as **Movable-Do Tonic Solfa**.

This proposal presents the results of an independent technical evaluation across synthesizer technologies, SoundFont parsing pipelines, sequencing architectures, UI visualization approaches, and browser-specific constraints.

---

## 1. Analysis of Reference MIDI Software & Best-in-Class Capabilities

| Reference Application | Key Architectural Strengths | Limitations & Gaps Melodex Will Address |
| :--- | :--- | :--- |
| **vanBasco's MIDI Player** | Lightweight real-time channel activity meters; fast mute/solo matrix; pitch transpose and tempo controls in real time. | Outdated Windows 95 UI paradigm; relies on OS GM synth (Microsoft GS Wavetable); no custom SoundFont loading; rigid channel-to-track assumption. |
| **Karaboss** | Robust MIDI sequencer integration; detailed track event inspection; SoundFont management; lyrics/karaoke synchronization. | Heavy desktop dependency (.NET/WPF); synchronous UI blocking on large MIDI files; monolithic coupling between sequencer and audio output. |
| **Karakara / KaraFun** | Smooth real-time visualization; high-performance lyric rendering; track routing. | Primarily optimized for vocals/karaoke rather than instrument editing, deep mixing, or musical theory visualization. |
| **SynthFont / VMS (VirtualMIDISynth)** | Comprehensive SF2/SF3 soundfont bank routing, polyphony management, envelope/filter generator adjustments, per-preset overrides. | Complex desktop-only audio driver configuration; not accessible on the web. |
| **Sekaiju (Open Source MIDI Sequencer)** | True multi-track MIDI event list; independent track vs. channel architecture; fine-grained CC (Continuous Controller) editing. | Raw Win32 UI; no built-in high-quality modern synthesizer engine without external MIDI hardware. |
| **Modern DAWs (Logic Pro / Ableton / Reaper)** | Non-destructive audio/MIDI pipelines; lookahead audio scheduling; flexible bus routing; responsive multi-tier zoomable piano rolls. | Overly complex for swift playback and visualization; heavy licensing and installation footprint. |

### Core Lessons for Melodex:
1. **Tracks ≠ Channels**: A Standard MIDI File (SMF Format 0 or 1) may have 1 track with 16 channels, or 32 tracks sharing channel 1 (piano right/left hand, orchestral parts). Melodex must decouple **Track State** (metadata, mute/solo, track-level events) from **Channel State** (program change, CC7 volume, CC10 pan, CC91 reverb, pitch bend, 16 GM channels where Ch 10 = Percussion).
2. **Non-Destructive Playback Transformations**: Transposition and tempo modulation must occur in the scheduling pipeline as live transformations without mutating the underlying canonical sequence data.
3. **Low-Latency Visual Sync**: Audio clocks (hardware crystal) and display refresh rates (requestAnimationFrame, 60–144Hz) diverge. Audio events must drive visualization timestamps via lookahead queues to guarantee frame-perfect key highlights without audio stutter.

---

## 2. Browser-Compatible MIDI Synthesizers & SoundFont Options

### Synthesizer Engine Evaluation

| Engine / Library | SoundFont Support | Synthesis Quality & Feature Completeness | Audio Architecture | Performance & Polyphony | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SpessaSynth** | Native **SF2 & SF3** (Ogg/Vorbis sample decompression). Full GM/GS/XG spec. | **Exceptional.** Accurately computes SoundFont generators: lowpass filters (fc, resonance), dual envelopes (DAHDSR for vol & mod), LFOs (vibrato/tremolo), chorus, reverb, and stereo panning. | Pure Web Audio API + AudioWorklet processor. Direct byte buffer decoding. | High (handles 128+ voices comfortably; built-in voice stealing and sample rate optimization). | **Top Synthesizer Choice (Tier 1)** |
| **TinySoundFont (WASM / C ported)** | SF2 only. | Good, but basic filters and envelopes compared to full SF2.04 specification. | C compiled to WebAssembly via Emscripten; streaming to Web Audio ScriptProcessor/AudioWorklet. | Ultra-lightweight CPU footprint, but lacks SF3 support and advanced CC modulation. | Viable fallback / secondary engine. |
| **WebAudioFont** | Custom pre-rendered JSON / JS soundbanks. | Medium. Instruments are pre-baked audio samples, missing dynamic multi-velocity layers and real-time SF2 filter modulation. | Web Audio BufferSourceNodes. | High, but requires converting SoundFonts into split JS files before loading. | Not recommended for arbitrary user SF2/SF3 file loading. |
| **Tone.js (with Soundfont-player)** | Pre-sliced MP3/WAV multi-samples. | Clean synth APIs, but not a General MIDI / SoundFont engine. Instrument switching requires downloading separate sample maps. | Standard Web Audio node graph. | Good for web audio effects and sequencing, not designed for full GM SF2 playback. | Great for ancillary effects, not core SF2 engine. |
| **Fluidsynth (via WASM / libopenmpt)** | SF2 and SF3. | Studio quality (the industry benchmark for SoundFont rendering). | C/C++ WASM compilation, AudioWorklet ring buffer. | High fidelity, but heavy WASM binary (~2MB+) and non-trivial threading/memory compilation complexities in browser sandboxes. | Excellent long-term upgrade path; complex for immediate phase. |

### SoundFont Format Investigation (SF2 vs. SF3)
- **SF2 (SoundFont 2.04)**: Standard RIFF container holding raw 16-bit PCM uncompressed samples (`sdta` chunk) and structural presets/instruments/zones (`pdta` chunk).
  - *Pros*: Zero CPU overhead for sample decoding; fast random access to sample data.
  - *Cons*: Large file sizes (a complete General MIDI bank ranges from 30MB to 140MB+; e.g., FluidR3_GM is ~140MB, GeneralUser GS is ~30MB, TimGM6mb is ~6MB).
- **SF3 (SoundFont 3.0)**: Compressed SoundFont format popularized by MuseScore, storing audio samples as Ogg Vorbis compressed streams.
  - *Pros*: Significant file size reduction (often 70–80% smaller than SF2, allowing high-quality 25MB banks equivalent to 120MB SF2).
  - *Cons*: Requires an asynchronous Vorbis audio decoder (either native browser `AudioContext.decodeAudioData` or WASM vorbis decoder) before or during voice caching.
- **Melodex SoundFont Strategy**:
  1. **Built-in Compact SoundBank**: Bundle a high-quality lightweight GM bank (e.g., TimGM6mb / Compact GS ~6MB, or high-efficiency GeneralUser GS compressed format) loaded on startup for zero-friction instant playback.
  2. **Custom SoundFont Drag-and-Drop**: Support user loading of `.sf2` and `.sf3` files via `FileReader` / `ArrayBuffer`.
  3. **Preset & Bank Routing**: Support standard MIDI Bank Select (CC0 MSB, CC32 LSB) and Program Change (0–127), with Bank 128 / Channel 10 dedicated to standard GM drum kits (Standard, Room, Power, Electronic, TR-808, Jazz, Brush, Orchestra).

---

## 3. Comparative Architecture Approaches

### Approach A: Pure Library-Based (e.g. pre-packaged all-in-one player)
- **Concept**: Wrap an existing monolithic open-source web MIDI player widget into a React component.
- **Advantages**: Fast initial prototype; minimal low-level audio coding.
- **Disadvantages**:
  - Rigid user interface; difficult to isolate mixer channels from tracks.
  - Inflexible scheduling prevents future custom visualizations (e.g. tonic solfa syllable overlay).
  - Poor extensibility for piano roll editing and quantization.
- **Verdict**: Unsuitable for Melodex's long-term workstation vision.

### Approach B: Hybrid Architecture (Recommended)
- **Concept**:
  - Leverage **SpessaSynth / TinySoundFont AudioWorklet** for high-precision SoundFont synthesis and low-level voice DSP.
  - Build **Custom Domain Engines** for:
    1. **Canonical Musical Event Graph & Parser** (`@tonejs/midi` or custom SMF parser producing a normalized event representation).
    2. **Lookahead Micro-Scheduler** (`AudioContext.currentTime` based scheduling with Web Worker clock to resist tab throttling).
    3. **Mixer Routing Matrix** (Track-to-Channel mapping, non-destructive mute/solo, tempo scale factor, key pitch transposition offset, volume/pan gain nodes).
    4. **Visualization Dispatch Pipeline** (Broadcast channel note-on/note-off states via RAF to Virtual Piano and Canvas Piano Roll).
    5. **Abstract Notation Adapter Layer** (Preparing event payloads for standard pitch and Movable-Do Tonic Solfa).
- **Advantages**:
  - Maximum audio quality and SoundFont fidelity without reinventing low-level filter math or RIFF parsing.
  - Total control over UI, mixer routing, sequencer, and note representations.
  - Decoupled modules allow swapping synthesis backends (e.g., from Web Audio to WASM Fluidsynth or Web MIDI hardware output) without touching the sequencer or UI.
- **Verdict**: **The optimal architecture for Melodex.**

### Approach C: Completely Custom Engine
- **Concept**: Hand-code the entire SF2 RIFF parser, sample interpolators (linear/cubic hermite), DAHDSR envelope generators, biquad resonant filters, SMF parser, and sequencer from scratch.
- **Advantages**: Complete independence and zero external dependencies.
- **Disadvantages**:
  - Months of DSP engineering to debug voice-stealing clicks, filter resonance stability, loop-point crossfading, and Vorbis decoding.
  - High risk of audio dropouts and performance degradation in JavaScript.
- **Verdict**: Inefficient; creates unnecessary technical debt when proven audio synthesis cores already exist.

---

## 4. Architectural System Design

```
+---------------------------------------------------------------------------------------+
|                                    MELODEX WORKSTATION                                |
+---------------------------------------------------------------------------------------+
                                           |
                   +-----------------------+-----------------------+
                   |                                               |
                   v                                               v
        [ MIDI File / SMF Import ]                      [ User SoundFont (.sf2/.sf3) ]
                   |                                               |
                   v                                               v
     +---------------------------+                   +---------------------------+
     |   Canonical Event Model   |                   |     SoundFont Manager     |
     |  - Tracks (1..N)          |                   |  - Preset/Bank Registry   |
     |  - Tempo & TimeSig Maps   |                   |  - Sample Cache           |
     |  - Note Events (Tick-base)|                   |  - Instrument Zone Config |
     +---------------------------+                   +---------------------------+
                   |                                               |
                   v                                               |
     +---------------------------+                                 |
     |   Non-Destructive Filter  |                                 |
     |  - Tempo Scale (0.25x-2x) |                                 |
     |  - Pitch Transpose (-12..)|                                 |
     |  - Track Mute/Solo Matrix |                                 |
     +---------------------------+                                 |
                   |                                               |
                   v                                               |
     +---------------------------+                                 |
     |   Micro-Scheduler (Worker)|                                 |
     |  - Lookahead Window (50ms)|                                 |
     |  - Tick -> Seconds Math   |                                 |
     +---------------------------+                                 |
                   |                                               |
         +---------+---------+                                     |
         |                   |                                     |
         v                   v                                     v
+------------------+  +------------------+            +-------------------------+
| Visual Dispatch  |  | Synth Dispatch   | ---------> |  Audio Synthesis Core   |
| (RAF Broadcast)  |  | (Audio Timings)  |            |  - SpessaSynth / Engine |
+------------------+  +------------------+            |  - 16 MIDI Channels     |
         |                                            |  - Voice Stealing       |
    +----+----+                                       |  - Master FX (Rev/Chor) |
    |         |                                       +-------------------------+
    v         v                                                    |
+-------+ +----------+                                             v
|Piano  | |Piano Roll|                                    +---------------------+
|Virtual| |(Canvas)  |                                    | Web Audio Output    |
+-------+ +----------+                                    | (AudioContext)      |
    |                                                     +---------------------+
    v
+---------------------------+
| Future Solfa / Notation   |
| (Movable-Do Tonality Hub) |
+---------------------------+
```

### Key Subsystems:
1. **Canonical Musical Event Model**:
   - Stores time in integer ticks (PPQ / Pulses Per Quarter Note, typically 480 or 960).
   - Preserves original track separation, channel assignments, CC events, pitch bends, and tempo markers.
2. **Transform / Playback Pipeline**:
   - `currentTimeInTicks = f(elapsedAudioContextTime, tempoMap, userTempoRatio)`.
   - Dynamic transposition: Note On `pitch = note.pitch + userTransposeOffset` (clamped 0..127, percussion Ch 10 immune to pitch transposition).
   - Track-level mute & solo evaluation: `isAudible = (!anySolo || track.solo) && !track.muted`.
3. **SoundFont & Synthesis Core**:
   - Implements 16 MIDI channels with standard CC responders:
     - CC 7 (Channel Volume) & CC 11 (Expression).
     - CC 10 (Pan: 0=Left, 64=Center, 127=Right).
     - CC 64 (Sustain / Damper Pedal with authentic voice release hold).
     - CC 91 (Reverb Send) & CC 93 (Chorus Send).
     - Pitch Bend (14-bit with default ±2 semitone or RPN configured range).
4. **Virtual Piano & Visual Dispatch**:
   - Visual state manager dispatches active notes to components running on `requestAnimationFrame`.
   - Renders 88 keys (A0 to C8) with smooth responsive width scaling, octave labels, track-color coding, and dual interaction (click/touch + computer keyboard input).
5. **Canvas-Accelerated Piano Roll**:
   - HTML5 2D Canvas rendering for high frame-rate note streaming and editing.
   - Grid subdivision (1/4, 1/8, 1/16, 1/32 notes), playhead tracking, note bounding-box selection, and interactive dragging.

---

## 5. Sheet Music & Notation Investigation

### Evaluation of Candidates
1. **OpenSheetMusicDisplay (OSMD)**:
   - *Strengths*: Highly accurate MusicXML rendering based on VexFlow.
   - *Weakness for MIDI*: Requires converting raw MIDI tick streams into structured MusicXML (quantization, voice splitting, beaming, key signature inference). MIDI-to-MusicXML conversion in the browser is notoriously prone to unreadable notation without complex voice-leading heuristics.
2. **VexFlow (Direct API)**:
   - *Strengths*: Flexible canvas/SVG score generation.
   - *Weakness*: Low-level score compiler; requires explicit calculation of stave widths, accidental allocations, and beat grouping.
3. **AlphaTab**:
   - *Strengths*: Excellent for guitar tabs and linear MIDI playback sync, lightweight.
   - *Weakness*: Best suited for guitar/rock tablature; less idiomatic for complex multi-stave orchestral arrangements.

### Recommendation on Priority 5:
- **Phase 1 Decision: Defer deep notation, provide clean architectural hooks.**
- Expose an `exportScoreData()` hook and tonality analyzer in Melodex that quantizes note ticks into measures and beats, ready for plug-and-play rendering once the core player, mixer, soundfont synth, and virtual piano are world-class.

---

## 6. Architecture for Future Tonic Solfa (Movable-Do) Integration

To ensure the architecture is naturally prepared for Tonic Solfa:
1. **Tonality Analyzer**:
   - Detects or allows user selection of the **Key Center** (e.g., C Major, F# Minor, Eb Mixolydian).
   - Computes scale degree offsets relative to Do:
     - Major: Do (0), Re (2), Mi (4), Fa (5), Sol (7), La (9), Ti (11).
     - Chromatics / Accidentals: Di / Ra, Ri / Me, Fi / Se, Si / Le, Li / Te.
2. **Decoupled Event Presentation**:
   - Every note event provides:
     ```typescript
     interface VisualNoteEvent {
       midiNote: number;         // 60 = Middle C
       pitchName: string;        // "C4"
       solfaSyllable?: string;   // "d", "r", "m", "f", "s", "l", "t" (computed from active Key)
       octaveMark?: string;      // d' (high), d, (low)
       trackId: string;
       channel: number;
       velocity: number;
     }
     ```
3. **Virtual Keyboard Solfa Overlay**:
   - Virtual piano keys display dual labels: standard pitch (`C4`, `D4`) and Solfa notation (`d`, `r`, `m`) reflecting the chosen root key.
4. **Acoustic Solfege SoundFont Compatibility**:
   - Instrument channel mapping will support future solfege voice presets (e.g. vocal sample banks articulating "do, re, mi").

---

## 7. Browser Constraints, Limitations & Practical Solutions

| Browser Constraint | Impact | Engineered Solution in Melodex |
| :--- | :--- | :--- |
| **AudioContext Autoplay Policy** | Modern browsers suspend `AudioContext` until a direct user gesture (click/touch). | Clean "Click to Initialize Audio / Play" state machine; audio graph warmup on first interaction. |
| **Timer Throttling in Inactive Tabs** | `setInterval` / `setTimeout` throttle to 1000ms when tab is minimized or backgrounded, causing playback stutter. | Use a dedicated **Web Worker clock** for tick generation combined with Web Audio's native hardware crystal clock (`audioContext.currentTime`). |
| **Large SoundFont Memory Usage** | Loading 100MB+ SF2 files can cause memory spikes and GC pauses. | Progressive ArrayBuffer slicing; fast typed array views; store loaded custom SoundFonts in browser `IndexedDB` for instant persistent reload without re-uploading. |
| **Garbage Collection Stutter** | Allocating new JavaScript objects for every MIDI event inside high-frequency audio callbacks triggers GC pauses. | Pre-allocated reusable event pools and fixed-size typed array ring buffers for audio scheduling. |
| **Touch / Mouse Latency on Virtual Piano** | Playing the virtual piano interactively must respond instantaneously (<15ms). | Direct voice triggering via `audioContext.currentTime` without queuing through the sequence scheduler. |

---

## 8. Implementation Roadmap & Milestones

### Phase 1: High-Performance SoundFont Synthesizer & Audio Engine (Current Foundation)
- Web Audio API graph setup with master bus, channel strips, reverb, and chorus.
- Integrated high-fidelity SoundFont parser supporting SF2/SF3 with default embedded General MIDI bank.
- 16 MIDI channel management with GM instrument preset selection, percussion routing (Ch 10), CC handling (volume, pan, sustain, expression).
- Interactive polyphonic real-time synthesis tested with virtual keyboard.

### Phase 2: MIDI File Processing & Lookahead Sequencer
- Multi-track Standard MIDI File (SMF Format 0 & 1) parser extracting tracks, channels, tempo map, time signatures, and markers.
- Non-destructive playback transformations: real-time tempo multiplier (0.25x – 2.0x) and real-time key transposition (-12 to +12 semitones).
- Transport controls: Play, Pause, Stop, Seek / Scrubber, Loop Range (A-B markers).
- Accurate audio-to-visual synchronization queue.

### Phase 3: Professional Workstation Mixer & Instrument Controller
- 16-channel / multi-track mixer console with volume faders, VU activity meters, pan pots, mute, solo, and instrument replacement dropdowns.
- Channel activity LED monitors and polyphony counter.
- SoundFont manager dialog for loading user `.sf2` / `.sf3` files and switching soundbanks.

### Phase 4: Virtual Piano & Musical Visualization
- 88-key interactive virtual piano with zoom/scroll (25, 49, 61, 76, or 88 keys visible).
- Real-time multi-color note highlighting mapped to active tracks/channels.
- Computer keyboard musical typing (ASDF... layout) and mouse/touch glissando support.
- Pitch names, octave indicators, and **Movable-Do Tonic Solfa overlay** toggle.

### Phase 5: Interactive Piano Roll Sequencer
- Multi-track canvas-accelerated piano roll view displaying all notes across time and pitch.
- Note inspection, zoom (horizontal time zoom, vertical pitch zoom), and playhead cursor tracking.
- Foundation for note editing, duration adjustments, and quantization.

---

## 9. Dependency Recommendations

To guarantee long-term stability, performance, and compliance with the React 19 / Vite build setup:
- **Audio & SoundFont**: `spessasynth_lib` or custom high-performance Web Audio SoundFont engine utilizing AudioWorklet and typed arrays for zero-dependency portability.
- **MIDI Parsing**: Robust pure-TypeScript SMF parser (`@tonejs/midi` or self-contained binary SMF parser) to ensure zero native dependencies and synchronous parsing.
- **Icons & UI**: `lucide-react` (already installed), Tailwind CSS v4 (already configured), `motion` (already installed).
- **Storage**: Browser `IndexedDB` for local caching of large custom user SoundFonts.

---

## 10. Conclusion & Recommended Next Step
The **Hybrid Architecture (Approach B)** provides the ideal balance: world-class audio synthesis, unmatched flexibility for custom visualizations (including the unique Tonic Solfa integration), and true desktop-grade responsiveness in the browser.

We are ready to build Phase 1 and Phase 2 immediately, delivering a fully operational, beautiful Melodex application.
