/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { composeMidiWithGemini } from '../../server/aiComposer.ts';
import type { AiComposeRequest } from '../../src/types/midi.ts';

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (data: unknown) => void;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const payload = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as AiComposeRequest;
    const result = await composeMidiWithGemini(payload);
    res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to generate MIDI arrangement.';
    console.error('[Vercel AI Compose Error]:', err);
    res.status(500).json({ error: message });
  }
}
