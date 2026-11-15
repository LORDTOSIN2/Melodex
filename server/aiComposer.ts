/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { AiComposeRequest, AiComposeResponse, SymbolicArrangement } from '../src/types/midi.ts';

const MODEL_NAME = 'gemini-4-hydrogen';

const ARRANGEMENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: {
      type: Type.STRING,
      description: 'Short descriptive song or arrangement title.'
    },
    bpm: {
      type: Type.INTEGER,
      description: 'Tempo in beats per minute (40 to 220).'
    },
    timeSignatureNumerator: {
      type: Type.INTEGER,
      description: 'Beats per bar, usually 4 (or 3, 5, 6).'
    },
    timeSignatureDenominator: {
      type: Type.INTEGER,
      description: 'Beat unit, usually 4 (or 8).'
    },
    musicalKey: {
      type: Type.STRING,
      description: 'Musical key center, e.g. "C Major", "A Minor", "Eb Major".'
    },
    totalBars: {
      type: Type.INTEGER,
      description: 'Total number of bars in the arrangement (4 to 32).'
    },
    tracks: {
      type: Type.ARRAY,
      description: 'List of MIDI instrument or drum tracks.',
      items: {
        type: Type.OBJECT,
        properties: {
          name: {
            type: Type.STRING,
            description: 'Track display name, e.g. "Rhodes Piano", "Finger Bass", "Drum Kit".'
          },
          channel: {
            type: Type.INTEGER,
            description: 'MIDI channel 0-15. MUST be 9 for drums/percussion, and unique 0-8 or 10-15 for melodic tracks.'
          },
          program: {
            type: Type.INTEGER,
            description: 'General MIDI program 0-127 (use 0 for drums). Examples: 0=Grand Piano, 4=Rhodes EP, 16=Drawbar Organ, 24=Nylon Guitar, 27=Clean Electric Guitar, 32=Acoustic Bass, 33=Finger Bass, 36=Slap Bass 1, 48=String Ensemble, 56=Trumpet, 65=Alto Sax, 73=Flute, 80=Square Lead, 81=Saw Lead, 89=Warm Pad.'
          },
          isDrum: {
            type: Type.BOOLEAN,
            description: 'True if this is a percussion/drum track on channel 9, false for melodic instruments.'
          },
          volume: {
            type: Type.INTEGER,
            description: 'Track mix level 1-127 (typically 80-115).'
          },
          pan: {
            type: Type.INTEGER,
            description: 'Stereo pan 0-127 (64 is center, <64 left, >64 right).'
          },
          notes: {
            type: Type.ARRAY,
            description: 'Ordered list of musical notes in beat units.',
            items: {
              type: Type.OBJECT,
              properties: {
                pitch: {
                  type: Type.INTEGER,
                  description: 'MIDI pitch 0-127 (60=C4, 62=D4, 64=E4, 65=F4, 67=G4, 69=A4, 71=B4; bass typically 28-55; chords 48-76). For drums (channel 9): 36=Kick, 38=Snare, 42=Closed Hi-Hat, 46=Open Hi-Hat, 39=Hand Clap, 49=Crash, 51=Ride, 45/47/50=Toms.'
                },
                startBeat: {
                  type: Type.NUMBER,
                  description: 'Beat onset from 0.0 (e.g. Bar 1 Beat 1 = 0, Beat 2 = 1.0, Bar 2 Beat 1 in 4/4 = 4.0).'
                },
                durationBeats: {
                  type: Type.NUMBER,
                  description: 'Duration in beats (0.25=16th, 0.5=8th, 1.0=quarter, 2.0=half, 4.0=whole).'
                },
                velocity: {
                  type: Type.INTEGER,
                  description: 'Note velocity 1-127 (use dynamic variation, e.g. 65-115).'
                }
              },
              required: ['pitch', 'startBeat', 'durationBeats', 'velocity']
            }
          }
        },
        required: ['name', 'channel', 'program', 'isDrum', 'volume', 'pan', 'notes']
      }
    }
  },
  required: [
    'title',
    'bpm',
    'timeSignatureNumerator',
    'timeSignatureDenominator',
    'musicalKey',
    'totalBars',
    'tracks'
  ]
};

const SYSTEM_INSTRUCTION = `You are Melodex AI Composer, a skilled MIDI arranger and musician.
You output strictly valid JSON conforming to the SymbolicArrangement schema using beat-based timing.

Musical & Technical Rules:
1. Beat Grid Math:
   - Beat 0.0 is the very start of Bar 1.
   - In 4/4 time, Bar N starts at beat (N - 1) * 4.0. In 3/4 time, Bar N starts at (N - 1) * 3.0.
   - Keep all notes within [0, totalBars * beatsPerBar).
2. General MIDI Channels & Programs:
   - Drums/percussion MUST use channel 9, isDrum: true, program: 0.
   - Drum pitches: 36=Bass Drum, 38=Snare, 42=Closed Hi-Hat, 46=Open Hi-Hat, 39=Clap, 49=Crash, 51=Ride, 45=Low Tom, 47=Mid Tom, 50=High Tom.
   - Melodic tracks MUST NOT use channel 9. Give each melodic track its own channel (0-8, 10-15).
   - Common GM Programs: 0 Acoustic Grand Piano, 4 Rhodes EP, 16 Drawbar Organ, 24 Nylon Guitar, 27 Clean Guitar, 29 Overdriven Guitar, 32 Acoustic Bass, 33 Finger Bass, 36 Slap Bass, 48 String Ensemble, 56 Trumpet, 65 Alto Sax, 66 Tenor Sax, 73 Flute, 81 Saw Lead, 89 Warm Pad.
3. Musicality & Arrangement Quality:
   - Use clear harmonic progressions (e.g., I-V-vi-IV, ii-V-I, i-VI-III-VII) with voice-led chords, a rhythmic bassline locked with the kick drum, expressive melody phrasing with rests, and dynamic velocities (accents vs ghost notes).
   - Ensure every bar from Bar 1 through totalBars has cohesive musical content unless intentionally dropping out for arrangement contrast.
   - Never leave a track empty.`;

function buildPrompt(req: AiComposeRequest): string {
  if (req.mode === 'add_track' && req.songSummary) {
    const s = req.songSummary;
    const beatsPerBar = s.timeSignatureNumerator * (4 / s.timeSignatureDenominator);
    const targetBars = Math.min(s.totalBars, 16);
    const trackList = s.existingTracks
      .map((t) => `- ${t.name} (ch ${t.channels.join(',')}, GM prog ${t.program}, ${t.noteCount} notes)`)
      .join('\n');

    return `TASK: Compose 1 or 2 NEW complementary MIDI tracks/stems to layer onto an existing MIDI arrangement.
Keep the exact tempo (${s.bpm} BPM) and time signature (${s.timeSignatureNumerator}/${s.timeSignatureDenominator}, ${beatsPerBar} beats/bar).
Compose notes across ${targetBars} bars (total beats: 0 to ${targetBars * beatsPerBar}).
Do NOT reuse already occupied melodic channels: [${s.usedChannels.join(', ')}] (unless adding drums on channel 9 when appropriate).

Existing Song Context ("${s.fileName}"):
- BPM: ${s.bpm}
- Time Signature: ${s.timeSignatureNumerator}/${s.timeSignatureDenominator}
- Total Bars in Song: ${s.totalBars} (compose across Bars 1 to ${targetBars})
- Existing Tracks:
${trackList || '(none)'}

Bar-by-bar Harmonic Pitch Digest:
${s.barDigest.slice(0, targetBars).join('\n')}

User Request for New Track(s):
"${req.prompt}"

Return ONLY the newly composed track(s) in the tracks array, harmonizing cleanly with the pitch digest above.`;
  }

  const bpmHint = req.bpm ? `${req.bpm} BPM` : 'appropriate BPM for the style';
  const keyHint = req.musicalKey || 'appropriate key';
  const barsHint = req.totalBars || 8;
  const tsHint = req.timeSignature || '4/4';

  return `TASK: Compose a complete, playable multi-track MIDI arrangement from scratch.
Specifications:
- User Prompt: "${req.prompt}"
- Target Tempo: ${bpmHint}
- Target Key: ${keyHint}
- Time Signature: ${tsHint}
- Length: ${barsHint} bars

Include well-balanced tracks appropriate for the prompt (for example: Drums on ch 9, Bass, Chords/Harmony, and Lead Melody). Ensure all tracks span the full ${barsHint} bars cleanly.`;
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable =
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('500') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('fetch');
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

export async function composeMidiWithGemini(req: AiComposeRequest): Promise<AiComposeResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server environment.');
  }

  if (!req.prompt || !req.prompt.trim()) {
    throw new Error('Please enter a musical prompt describing what you want to create.');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });

  const userPrompt = buildPrompt(req);

  const response = await callWithRetry(() =>
    ai.models.generateContent({
      model: MODEL_NAME,
      contents: userPrompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: ARRANGEMENT_SCHEMA,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.MEDIUM
        }
      }
    })
  );

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('The AI model returned an empty response. Please try again.');
  }

  let arrangement: SymbolicArrangement;
  try {
    arrangement = JSON.parse(rawText) as SymbolicArrangement;
  } catch {
    throw new Error('Failed to parse AI musical arrangement JSON.');
  }

  if (!Array.isArray(arrangement.tracks) || arrangement.tracks.length === 0) {
    throw new Error('The AI arrangement did not contain any instrument tracks.');
  }

  return {
    arrangement,
    modelUsed: MODEL_NAME
  };
}
