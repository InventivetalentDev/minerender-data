import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { download, DEFAULT_CACHE, loadVersion } from './download.js';
import { versionId } from './lib.js';
import { run } from './runtime.js';

export function unpublishedReleases(manifest, published, after) {
  return manifest.versions.filter(entry => entry.type === 'release' && Date.parse(entry.releaseTime) > Date.parse(after)
    && !published.has(entry.id)).sort((a, b) => Date.parse(a.releaseTime) - Date.parse(b.releaseTime)).slice(0, 10).map(entry => versionId(entry.id));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { version: { type: 'string' }, verify: { type: 'boolean', default: false } } });
    if (values.version && values.verify) throw new Error('Choose --version or --verify');
    const config = JSON.parse(await readFile(new URL('../versions.json', import.meta.url), 'utf8'));
    let versions;
    if (values.version) versions = [versionId(values.version)];
    else if (values.verify) versions = config.verify.map(versionId);
    else {
      const manifest = JSON.parse(await download('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', path.join(DEFAULT_CACHE, 'manifest.json'), null, false, true));
      const refs = await run('git', ['ls-remote', '--heads', 'origin']);
      const published = new Set(refs.trim().split('\n').map(line => line.split('refs/heads/')[1]));
      versions = unpublishedReleases(manifest, published, config.automaticReleasesAfter);
    }
    const include = [];
    for (const version of versions) {
      const { metadata } = await loadVersion(version, DEFAULT_CACHE);
      include.push({ version, java: String(Math.max(21, metadata.javaVersion?.majorVersion ?? 21)) });
    }
    console.log(JSON.stringify({ include }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
