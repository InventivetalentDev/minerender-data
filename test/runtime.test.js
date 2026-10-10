import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { download, exists, loadVersion, sha1 } from '../tools/download.js';
import { allowedLibrary, run } from '../tools/runtime.js';

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'minerender-data-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('downloads reject corrupt bytes before caching them', async t => {
  const directory = await temporary(t);
  const file = path.join(directory, 'nested', 'asset');
  const bytes = Buffer.from('verified asset');
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes));
  await assert.rejects(download('https://example.test/asset', file, '0'.repeat(40)), /SHA-1 mismatch/);
  assert.equal(await exists(file), false);
  await download('https://example.test/asset', file, sha1(bytes));
  assert.deepEqual(await readFile(file), bytes);
});

test('offline cache reads verify hashes and never request missing files', async t => {
  const directory = await temporary(t);
  const file = path.join(directory, 'asset');
  const bytes = Buffer.from('cached asset');
  await writeFile(file, bytes);
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  assert.deepEqual(await download('https://example.test/asset', file, sha1(bytes), true), bytes);
  await assert.rejects(download('https://example.test/asset', file, '0'.repeat(40), true), /SHA-1 mismatch/);
  await assert.rejects(download('https://example.test/missing', path.join(directory, 'missing'), sha1(bytes), true), /Offline cache miss/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('cached metadata must match its requested version and manifest hash', async t => {
  const cache = await temporary(t);
  const version = '1.21.5';
  const metadata = Buffer.from(JSON.stringify({ id: version }));
  const entry = { id: version, sha1: sha1(metadata), url: 'https://example.test/version.json' };
  await mkdir(path.join(cache, version));
  await writeFile(path.join(cache, 'manifest.json'), JSON.stringify({ versions: [entry] }));
  const metadataFile = path.join(cache, version, `${entry.sha1}.json`);
  await writeFile(metadataFile, metadata);
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  assert.equal((await loadVersion(version, cache, true)).metadata.id, version);
  await assert.rejects(loadVersion('1.21.11', cache, true), /Version not found/);
  await assert.rejects(loadVersion('latest', cache, true), /Version not found/);
  await assert.rejects(loadVersion('../1.21.5', cache, true), /Invalid Minecraft version/);
  await writeFile(metadataFile, JSON.stringify({ id: '1.21.11' }));
  await assert.rejects(loadVersion(version, cache, true), /SHA-1 mismatch/);
  const mismatched = Buffer.from(JSON.stringify({ id: '1.21.11' }));
  entry.sha1 = sha1(mismatched);
  await writeFile(path.join(cache, 'manifest.json'), JSON.stringify({ versions: [entry] }));
  await writeFile(path.join(cache, version, `${entry.sha1}.json`), mismatched);
  await assert.rejects(loadVersion(version, cache, true), /Version metadata mismatch/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('library rules apply in order for this platform', () => {
  const name = { darwin: 'osx', win32: 'windows', linux: 'linux' }[process.platform];
  assert.equal(allowedLibrary({}), true);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow', os: { name: 'unmatched-os' } }] }), false);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow' }, { action: 'disallow', os: { name } }] }), false);
  assert.equal(allowedLibrary({ rules: [{ action: 'disallow' }, { action: 'allow', os: { name } }] }), true);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow', os: { arch: 'unmatched-architecture' } }] }), false);
  assert.equal(allowedLibrary({ rules: [{ action: 'allow', features: { is_demo_user: true } }] }), false);
});

test('process failures retain the exit status and diagnostic output', async t => {
  assert.equal(await run(process.execPath, ['-e', 'process.stdout.write("done")']), 'done');
  await assert.rejects(run(process.execPath, ['-e', 'process.stderr.write("broken input"); process.exit(2)']), /exited with code 2: broken input/);
  await assert.rejects(run(path.join(await temporary(t), 'missing'), []), /Cannot run/);
});
