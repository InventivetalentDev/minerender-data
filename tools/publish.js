import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { run } from './runtime.js';
import { validateDirectory } from './validation.js';
import { assert, extractorIdentity, versionId } from './lib.js';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');

export async function publish(version, input, push = false) {
  versionId(version);
  input = path.resolve(input);
  const manifest = await validateDirectory(input, version);
  const identity = await extractorIdentity(root);
  assert(manifest.extractor.revision && manifest.extractor.revision === identity.revision
    && manifest.extractor.sha256 === identity.sha256, 'Re-extract using the committed current tooling before publishing');
  const git = (args, cwd = root) => run('git', args, { cwd });
  assert(!(await git(['status', '--porcelain'])).trim(), 'Commit tooling changes before publishing');
  if (push) await git(['fetch', 'origin', `+refs/heads/${version}:refs/remotes/origin/${version}`]).catch(async error => {
    const refs = await git(['ls-remote', '--heads', 'origin', `refs/heads/${version}`]);
    if (refs.trim()) throw error;
  });
  const hasRef = async ref => { try { await git(['show-ref', '--verify', '--quiet', ref]); return true; } catch { return false; } };
  const local = await hasRef(`refs/heads/${version}`), remote = await hasRef(`refs/remotes/origin/${version}`);
  if (local && remote) assert((await git(['rev-parse', version])).trim() === (await git(['rev-parse', `origin/${version}`])).trim(), `Local ${version} differs from origin; reconcile it before publishing`);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'minerender-data-publish-'));
  const checkout = path.join(temporary, 'checkout');
  let attached = false;
  try {
    if (local) { await git(['worktree', 'add', '--quiet', checkout, version]); attached = true; }
    else if (remote) { await git(['worktree', 'add', '--quiet', '-b', version, checkout, `origin/${version}`]); attached = true; }
    else {
      await git(['worktree', 'add', '--quiet', '--detach', checkout, 'HEAD']);
      attached = true;
      await git(['switch', '--orphan', version], checkout);
    }
    for (const file of await readdir(checkout)) if (file !== '.git') await rm(path.join(checkout, file), { recursive: true, force: true });
    for (const file of await readdir(input)) await cp(path.join(input, file), path.join(checkout, file));
    await git(['add', '--all'], checkout);
    if ((await git(['diff', '--cached', '--name-only'], checkout)).trim()) await git(['commit', '-m', `Extract Minecraft ${version}`], checkout);
    if (push) await git(['push', 'origin', `refs/heads/${version}:refs/heads/${version}`]);
    console.log(push ? `Published ${version}` : `Prepared ${version}; push with: git push origin ${version}`);
  } finally {
    if (attached) await git(['worktree', 'remove', '--force', checkout]);
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { version: { type: 'string' }, input: { type: 'string' }, push: { type: 'boolean', default: false } } });
    if (!values.version || !values.input) throw new Error('Usage: node tools/publish.js --version VERSION --input DIR [--push]');
    await publish(values.version, values.input, values.push);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
