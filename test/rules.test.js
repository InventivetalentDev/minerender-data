import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRules, UnsupportedRulesVersionError } from '../tools/rules.js';

test('unreviewed versions do not inherit preview or legacy rules', async () => {
  await assert.rejects(buildRules('1.21.6', {}), error =>
    error instanceof UnsupportedRulesVersionError && error.version === '1.21.6');
});

test('tint formulas reject changed property ranges', async () => {
  await assert.rejects(buildRules('1.21.11', {
    'minecraft:redstone_wire': { power: { values: [0, 1] } }
  }), /redstone_wire requires power values/);
  await assert.rejects(buildRules('1.21.5', {
    'minecraft:melon_stem': { age: { values: [0, 1] } }
  }), /melon_stem requires age values/);
});

test('legacy mappings reject missing target blocks', async () => {
  await assert.rejects(buildRules('1.21.11', {}), /0:0 refers to an unknown block: minecraft:air/);
});
