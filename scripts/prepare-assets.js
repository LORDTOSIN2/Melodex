/**
 * Pre-build script to ensure AudioWorklet processor and GeneralUser SoundFont
 * are present in public/ for deployment (e.g. Vercel, Netlify, Cloud Run).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const publicDir = path.join(rootDir, 'public');
const soundfontsDir = path.join(publicDir, 'soundfonts');
const demoMidisDir = path.join(publicDir, 'demo-midis');

// Ensure directories exist
fs.mkdirSync(soundfontsDir, { recursive: true });
fs.mkdirSync(demoMidisDir, { recursive: true });

// 1. Copy spessasynth AudioWorklet processor
const processorSrc = path.join(rootDir, 'node_modules', 'spessasynth_lib', 'dist', 'spessasynth_processor.min.js');
const processorDest = path.join(publicDir, 'spessasynth_processor.min.js');
if (fs.existsSync(processorSrc) && !fs.existsSync(processorDest)) {
  fs.copyFileSync(processorSrc, processorDest);
  console.log('[Melodex Build] Copied spessasynth_processor.min.js to public/');
}

// 2. Copy GeneralUser.sf2 soundfont
const sfSrc = path.join(rootDir, 'node_modules', 'generaluser', 'GeneralUser.sf2');
const sfDest = path.join(soundfontsDir, 'GeneralUser.sf2');
if (fs.existsSync(sfSrc) && !fs.existsSync(sfDest)) {
  fs.copyFileSync(sfSrc, sfDest);
  console.log('[Melodex Build] Copied GeneralUser.sf2 to public/soundfonts/');
}

// 3. Copy demo MIDIs
const demoSrcDir = path.join(rootDir, 'node_modules', 'generaluser', 'demo-MIDIs');
if (fs.existsSync(demoSrcDir)) {
  const files = fs.readdirSync(demoSrcDir);
  for (const file of files) {
    if (file.endsWith('.mid')) {
      const dest = path.join(demoMidisDir, file);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(path.join(demoSrcDir, file), dest);
      }
    }
  }
}
const guTestSrc = path.join(rootDir, 'node_modules', 'generaluser', 'GUTest.mid');
if (fs.existsSync(guTestSrc)) {
  const guTestDest = path.join(demoMidisDir, 'GUTest.mid');
  if (!fs.existsSync(guTestDest)) {
    fs.copyFileSync(guTestSrc, guTestDest);
  }
}

console.log('[Melodex Build] Pre-build asset preparation complete.');
