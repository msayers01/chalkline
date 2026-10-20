import { fixtures } from '@chalkline/ir/fixtures';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS, renderWithPreset, type PresetId } from '../../src/index.js';

/**
 * Byte-exact .tex for every preset and fixture. Update with
 * `pnpm test:snap -u` only when the output change is intended, and say in the
 * PR which output changed and why.
 */
const presets = Object.keys(BUILT_IN_PRESETS) as PresetId[];

describe('.tex snapshots', () => {
  for (const preset of presets) {
    for (const [name, build] of Object.entries(fixtures)) {
      it(`${preset} / ${name}`, async () => {
        const { tex } = renderWithPreset(build(), preset);
        await expect(tex).toMatchFileSnapshot(`__snapshots__/${preset}/${name}.tex`);
      });
    }
  }

  it('lecture-notes / calculus with school and teacher conventions', async () => {
    const { tex } = renderWithPreset(fixtures.calculus(), 'lecture-notes', {
      school: { paperSize: 'a4', decimalSeparator: 'comma' },
      teacher: {
        font: 'pagella',
        vectors: 'bold',
        differentialD: 'upright',
        multiplicationSign: 'cdot',
        equationNumbers: 'all',
      },
    });
    await expect(tex).toMatchFileSnapshot('__snapshots__/lecture-notes/calculus.conventions.tex');
  });
});
