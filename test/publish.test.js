import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASETS, extractorIdentity, writeJson } from '../tools/lib.js';
import { UnsupportedRulesVersionError } from '../tools/rules.js';
import { run } from '../tools/runtime.js';

const root = fileURLToPath(new URL('../', import.meta.url));

async function dataset(directory, repository, version) {
  await mkdir(directory);
  const dyeNames = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
    'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  const data = {
    itemDefaults: { 'minecraft:stick': { 'minecraft:max_stack_size': 64 } },
    potionColors: { effects: { 'minecraft:speed': 3402751 }, potions: {
      'minecraft:swiftness': [{ id: 'minecraft:speed', amplifier: 0 }]
    } },
    blockStates: { 'minecraft:water': {
      level: { type: 'int', valueType: 'Integer', values: [0, 1], default: 0 }
    } },
    fluids: { 'minecraft:water': { kind: 'water', renderModel: false, levelProperty: 'level' } },
    dyes: Object.fromEntries(dyeNames.map((name, id) => [name, {
      id, textureDiffuseColor: id, fireworkColor: id, textColor: id
    }]))
  };
  const datasets = {};
  for (const [name, value] of Object.entries(data)) datasets[name] = {
    ...await writeJson(directory, DATASETS[name], value),
    provenance: { kind: 'vanilla-runtime', registry: name }
  };
  const metadata = { sha1: '3'.repeat(40), url: 'https://example.test/version.json' };
  const reason = new UnsupportedRulesVersionError(version).message;
  const manifest = {
    schemaVersion: 1, minecraftVersion: version, dataVersion: 1,
    extractor: await extractorIdentity(repository),
    source: {
      metadata,
      client: { sha1: '1'.repeat(40), url: 'https://example.test/client.jar' },
      mappings: { sha1: '2'.repeat(40), url: 'https://example.test/client.txt' },
      remapper: { version: '2.0.18', sha1: '59bd788e0a1bd339256711dee40015a62cdf3cd2' }
    },
    datasets, unavailable: { blockTints: reason, legacyBlocks: reason },
    validation: { itemSamples: 5, potionColors: 1, effectMixtures: 1 }
  };
  await writeJson(directory, 'version.json', { id: version, ...metadata });
  await writeJson(directory, 'manifest.json', manifest);
  const files = ['manifest.json', 'version.json', ...Object.values(datasets).map(entry => entry.file)].sort();
  await writeJson(directory, '_list.json', { directories: [], files });
  return { manifest, files: [...files, '_list.json'].sort() };
}

test('publishing keeps tooling separate and never overwrites a diverged version branch', async t => {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minerender-data-publish-test-')));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const repository = path.join(temporary, 'repository'), origin = path.join(temporary, 'origin.git');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(temporary, 'empty-config'), GIT_CONFIG_NOSYSTEM: '1' };
  await mkdir(repository);
  for (const file of ['tools', 'sources', 'package.json', '.gitignore']) {
    await cp(path.join(root, file), path.join(repository, file), { recursive: true });
  }
  const git = args => run('git', args, { cwd: repository, env });
  await git(['init', '--initial-branch=main']);
  await git(['config', 'user.name', 'Dataset test']);
  await git(['config', 'user.email', 'dataset@example.test']);
  await git(['config', 'commit.gpgsign', 'false']);
  await git(['add', '--all']);
  await git(['commit', '-m', 'Tooling fixture']);
  await git(['init', '--bare', '--initial-branch=main', origin]);
  await git(['remote', 'add', 'origin', origin]);
  await git(['push', 'origin', 'main']);
  const main = (await git(['rev-parse', 'main'])).trim();
  const version = '1.99.0', input = path.join(temporary, 'data');
  const fixture = await dataset(input, repository, version);
  const publish = requested => run(process.execPath, ['tools/publish.js', '--version', requested,
    '--input', input, '--push'], { cwd: repository, env });
  const remoteHead = async () => (await git(['--git-dir', origin, 'rev-parse', `refs/heads/${version}`])).trim();

  await publish(version);
  const published = (await git(['rev-parse', version])).trim();
  assert.equal(await remoteHead(), published);
  assert.deepEqual((await git(['ls-tree', '-r', '--name-only', version])).trim().split('\n').sort(), fixture.files);
  assert.equal((await git(['rev-list', '--parents', '-n', '1', version])).trim(), published);
  assert.equal((await git(['rev-parse', 'main'])).trim(), main);
  assert.equal((await git(['branch', '--show-current'])).trim(), 'main');
  assert.equal((await git(['status', '--porcelain'])).trim(), '');
  assert.equal((await git(['worktree', 'list', '--porcelain'])).match(/^worktree /gm).length, 1);

  await publish(version);
  assert.equal((await git(['rev-parse', version])).trim(), published);
  assert.equal(await remoteHead(), published);
  await assert.rejects(publish('1.99.1'), /Published dataset version mismatch/);
  await writeJson(input, 'manifest.json', { ...fixture.manifest, extractor: { ...fixture.manifest.extractor, revision: '0'.repeat(40) } });
  await assert.rejects(publish(version), /Re-extract using the committed current tooling/);
  await writeJson(input, 'manifest.json', fixture.manifest);
  assert.equal(await remoteHead(), published);

  const tree = (await git(['rev-parse', `${version}^{tree}`])).trim();
  const concurrent = (await git(['commit-tree', tree, '-p', published, '-m', 'Concurrent update'])).trim();
  await git(['push', 'origin', `${concurrent}:refs/heads/${version}`]);
  await assert.rejects(publish(version), /differs from origin; reconcile it before publishing/);
  assert.equal(await remoteHead(), concurrent);
  assert.equal((await git(['rev-parse', version])).trim(), published);
  assert.equal((await git(['rev-parse', 'main'])).trim(), main);
  assert.equal((await git(['status', '--porcelain'])).trim(), '');
});
