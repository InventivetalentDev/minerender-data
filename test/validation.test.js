import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DATASETS, stableStringify, versionId, writeJson } from '../tools/lib.js';
import { effectColor, validateRuntime, validateDirectory } from '../tools/validation.js';
import { unpublishedReleases } from '../tools/versions.js';

function fixture() {
  return {
    metadata: { minecraftVersion: '1.99', dataVersion: 1 },
    itemDefaults: { 'minecraft:stone': { 'minecraft:max_stack_size': 64 } },
    potionColors: { effects: { 'minecraft:red': 0xff0000, 'minecraft:blue': 0x0000ff }, potions: { 'minecraft:empty': [] } },
    blockStates: { 'minecraft:water': { level: { type: 'int', valueType: 'int', default: 0, values: [0, 1] } } },
    fluids: { 'minecraft:water': { kind: 'water', levelProperty: 'level', renderModel: false } },
    dyes: Object.fromEntries(Array.from({ length: 16 }, (_, id) => [`dye_${id}`, { id, textureDiffuseColor: 0, fireworkColor: 0, textColor: 0 }]))
  };
}

test('runtime validation rejects wrong versions, invalid defaults, and broken references', () => {
  const data = fixture();
  validateRuntime(data, '1.99');
  assert.throws(() => validateRuntime(data, '1.21.11'), /version/);
  data.blockStates['minecraft:water'].level.default = 2;
  assert.throws(() => validateRuntime(data, '1.99'), /property default/);
  data.blockStates['minecraft:water'].level.default = 0;
  data.fluids['minecraft:water'].levelProperty = 'missing';
  assert.throws(() => validateRuntime(data, '1.99'), /level property/);
});

test('potion averages preserve amplifier weighting, invisible effects, and empty mixtures', () => {
  const colors = fixture().potionColors.effects;
  assert.equal(effectColor([{ id: 'minecraft:red', amplifier: 1 }, { id: 'minecraft:blue', amplifier: 0 }], colors), 0xaa0055);
  assert.equal(effectColor([{ id: 'minecraft:blue', amplifier: 9, show_particles: false }], colors), null);
  assert.equal(effectColor([], colors), null);
});

test('publication validation rejects tampering, version mismatches, and undeclared datasets', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'minerender-data-validation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = fixture(), datasets = {};
  for (const [name, file] of Object.entries(DATASETS)) if (data[name]) datasets[name] = await writeJson(directory, file, data[name]);
  const version = { id: '1.99', sha1: 'a'.repeat(40), url: 'https://example.com/version.json' };
  const manifest = { schemaVersion: 1, minecraftVersion: '1.99', dataVersion: 1,
    source: { client: { sha1: 'b'.repeat(40), url: 'https://example.com/client.jar' }, metadata: { sha1: version.sha1, url: version.url } },
    extractor: { revision: null, sha256: 'c'.repeat(64) }, datasets,
    unavailable: { blockTints: 'Not reviewed', legacyBlocks: 'Not reviewed' } };
  await writeJson(directory, 'version.json', version);
  await writeJson(directory, 'manifest.json', manifest);
  await writeJson(directory, '_list.json', { directories: [], files: ['manifest.json', 'version.json', ...Object.values(datasets).map(entry => entry.file)].sort() });
  await validateDirectory(directory, '1.99');
  await assert.rejects(validateDirectory(directory, '1.21.11'), /version mismatch/);
  const filename = path.join(directory, 'item-defaults.json'), original = await readFile(filename);
  await writeFile(filename, '{}');
  await assert.rejects(validateDirectory(directory), /checksum/);
  await writeFile(filename, original);
  delete manifest.unavailable.blockTints;
  await writeJson(directory, 'manifest.json', manifest);
  await assert.rejects(validateDirectory(directory), /Unreported dataset/);
});

test('version discovery skips published and historical releases, and excludes snapshots', () => {
  const entry = (id, type, releaseTime) => ({ id, type, releaseTime });
  const versions = [entry('1.21.11', 'release', '2025-12-01'), entry('26.4', 'release', '2026-12-01'),
    entry('26.5', 'release', '2027-01-01'), entry('26w50a', 'snapshot', '2026-12-15')];
  assert.deepEqual(unpublishedReleases({ versions }, new Set(['26.4']), '2026-10-10'), ['26.5']);
  for (const invalid of ['main', 'release', 'latest', '../1.21.11', '1.21.11\nmain', '--force']) assert.throws(() => versionId(invalid));
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
});
