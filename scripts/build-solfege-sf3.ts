import fs from 'node:fs';
import path from 'node:path';
import {
  BasicInstrument,
  BasicPreset,
  BasicSoundBank,
  Generator,
  SoundBankLoader
} from 'spessasynth_core';

const INPUT_PATH = path.resolve('QDSolfege-v3_1.sf3');
const OUTPUT_PATH = path.resolve('public/soundfonts/QDSolfege-movable.sf3');

interface SyllableSpec {
  degree: number;
  suffix: string;
  presetName: string;
}

const SYLLABLES: SyllableSpec[] = [
  { degree: 0, suffix: 'Do', presetName: 'Solfa Do' },
  { degree: 2, suffix: 'Re', presetName: 'Solfa Re' },
  { degree: 4, suffix: 'Mi', presetName: 'Solfa Mi' },
  { degree: 5, suffix: 'Fa', presetName: 'Solfa Fa' },
  { degree: 7, suffix: 'Sol', presetName: 'Solfa Sol' },
  { degree: 9, suffix: 'La', presetName: 'Solfa La' },
  { degree: 11, suffix: 'Si', presetName: 'Solfa Ti (Si)' }
];

function buildMovableSolfegeSf3() {
  const raw = fs.readFileSync(INPUT_PATH);
  const srcBuf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const srcBank = SoundBankLoader.fromArrayBuffer(srcBuf);

  const baseInst = srcBank.instruments.find((inst) => inst.name.includes('diyes')) ?? srcBank.instruments[0];
  if (!baseInst) {
    throw new Error('Could not find base solfege instrument in QDSolfege-v3_1.sf3');
  }

  const outBank = new BasicSoundBank();
  outBank.soundBankInfo = {
    ...srcBank.soundBankInfo,
    name: 'QDSolfege V3.1 (Movable-Do Layered)',
    product: 'QDSolfege HEDSounds (Melodex Movable-Do Layout)',
    comment:
      'Repackaged from QDSolfege V3.1 by Ziya Mete Demircan (HEDSounds) into 7 Movable-Do full-range syllable presets (Programs 0,2,4,5,7,9,11).'
  };
  outBank.defaultModulators = [...srcBank.defaultModulators];
  outBank.addSamples(...srcBank.samples);

  for (const spec of SYLLABLES) {
    // Match sample names like "solfej02-3Do", "solfej02-4Sol", "solfej02-2Si"
    const matchingZones = baseInst.zones
      .filter((z) => z.sample.name.endsWith(spec.suffix))
      .sort((a, b) => a.keyRange.min - b.keyRange.min);

    if (matchingZones.length === 0) {
      throw new Error(`No sample zones found for syllable ${spec.suffix}`);
    }

    const inst = new BasicInstrument();
    inst.name = `QDSolfa-${spec.suffix}`;
    inst.globalZone.generators = baseInst.globalZone.generators.map(
      (g) => new Generator(g.type, g.value, false)
    );
    inst.globalZone.modulators = [...baseInst.globalZone.modulators];

    for (let i = 0; i < matchingZones.length; i++) {
      const srcZone = matchingZones[i];
      const prevCenter = i > 0 ? matchingZones[i - 1].keyRange.min : 0;
      const currCenter = srcZone.keyRange.min;
      const nextCenter = i < matchingZones.length - 1 ? matchingZones[i + 1].keyRange.min : 127;

      const minKey = i === 0 ? 0 : Math.floor((prevCenter + currCenter) / 2) + 1;
      const maxKey =
        i === matchingZones.length - 1 ? 127 : Math.floor((currCenter + nextCenter) / 2);

      const outZone = inst.createZone(srcZone.sample);
      outZone.keyRange = { min: minKey, max: maxKey };
      outZone.velRange = { min: 0, max: 127 };
      outZone.generators = srcZone.generators.map(
        (g) => new Generator(g.type, g.value, false)
      );
      outZone.modulators = [...srcZone.modulators];
    }

    const preset = new BasicPreset(outBank);
    preset.name = spec.presetName;
    preset.bankMSB = 0;
    preset.bankLSB = 0;
    preset.program = spec.degree;
    preset.isGMGSDrum = false;

    const pZone = preset.createZone(inst);
    pZone.keyRange = { min: 0, max: 127 };
    pZone.velRange = { min: 0, max: 127 };

    outBank.addInstruments(inst);
    outBank.addPresets(preset);
  }

  outBank.flush();
  const outputBinary = outBank.writeSF2({
    software: 'Melodex Movable-Do Packager (SpessaSynth)'
  });

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, Buffer.from(outputBinary));

  const verifyBuf = fs.readFileSync(OUTPUT_PATH);
  const verified = SoundBankLoader.fromArrayBuffer(
    verifyBuf.buffer.slice(verifyBuf.byteOffset, verifyBuf.byteOffset + verifyBuf.byteLength)
  );

  console.log(
    `Generated ${OUTPUT_PATH} (${(verifyBuf.byteLength / (1024 * 1024)).toFixed(2)} MB, ${verified.presets.length} presets, ${verified.samples.length} samples)`
  );
  for (const p of verified.presets) {
    const ranges = p.zones[0].instrument.zones.map(
      (z) => `${z.sample.name}[${z.keyRange.min}-${z.keyRange.max}]`
    );
    console.log(`  Prog ${String(p.program).padStart(2, '0')} (${p.name}): ${ranges.join(', ')}`);
  }
}

buildMovableSolfegeSf3();
