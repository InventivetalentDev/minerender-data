import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const DATASETS = {
  itemDefaults: 'item-defaults.json', potionColors: 'potion-colors.json',
  blockStates: 'block-states.json', fluids: 'fluids.json', dyes: 'dyes.json',
  blockTints: 'block-tints.json', legacyBlocks: 'legacy-blocks.json'
};

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function stableStringify(value) {
  const sort = entry => Array.isArray(entry) ? entry.map(sort)
    : entry && typeof entry === 'object' ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, sort(entry[key])])) : entry;
  return JSON.stringify(sort(value), null, 2) + '\n';
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function object(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return Object.entries(value);
}

export function identifier(id) {
  assert(typeof id === 'string' && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)
    && !id.split(/[:/]/).some(part => !part || part === '.' || part === '..'), `Invalid identifier: ${id}`);
}

export function versionId(version) {
  assert(typeof version === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(version), `Invalid version: ${version}`);
  assert(!['main', 'master', 'HEAD', 'latest', 'release', 'snapshot'].includes(version), `Use an exact Minecraft version: ${version}`);
  return version;
}

export async function extractorIdentity(root) {
  root = await realpath(root);
  const files = [];
  for (const directory of ['tools', 'sources']) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) files.push(path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).replaceAll(path.sep, '/'));
    }
  }
  const hashes = {};
  for (const file of files.sort()) hashes[file] = sha256(await readFile(path.join(root, file)));
  let revision = null;
  try {
    if (execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === root) {
      revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    }
  } catch { /* The content hash also identifies an uncommitted extractor. */ }
  return { revision, sha256: sha256(stableStringify(hashes)) };
}

export async function writeJson(directory, file, value) {
  const bytes = stableStringify(value);
  await writeFile(path.join(directory, file), bytes);
  return { file, sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) };
}
