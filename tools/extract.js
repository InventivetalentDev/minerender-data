import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { prepareRuntime, run } from './runtime.js';
import { exists } from './download.js';
import { DATASETS, extractorIdentity, versionId, writeJson } from './lib.js';
import { validateRuntime, validateFixtures, validateDirectory } from './validation.js';
import { buildRules, UnsupportedRulesVersionError } from './rules.js';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');

export async function extract(version, output, options = {}) {
  versionId(version);
  output = path.resolve(output);
  if (await exists(output)) throw new Error(`Output directory already exists: ${output}`);
  const runtime = await prepareRuntime(version, options);
  await mkdir(path.dirname(output), { recursive: true });
  const scratch = await mkdtemp(`${output}.tmp-`);
  try {
    console.log(`Extracting Minecraft ${version} from its client registry...`);
    const rawFile = path.join(scratch, 'raw.json'), fixturesFile = path.join(scratch, 'fixtures.json');
    await run(runtime.java, ['-Djava.awt.headless=true', '--class-path', [runtime.jar, ...runtime.libraries].join(path.delimiter),
      path.join(root, 'tools', 'Extract.java'), rawFile, fixturesFile], { cwd: scratch });
    const data = JSON.parse(await readFile(rawFile, 'utf8'));
    const fixtures = JSON.parse(await readFile(fixturesFile, 'utf8'));
    validateRuntime(data, version);
    const checks = validateFixtures(data, fixtures);
    let rules, unavailable = {};
    try { rules = await buildRules(version, data.blockStates); }
    catch (error) {
      if (!(error instanceof UnsupportedRulesVersionError)) throw error;
      unavailable = { blockTints: error.message, legacyBlocks: error.message };
    }
    const destination = path.join(scratch, 'dataset');
    await mkdir(destination);
    const datasets = {};
    for (const [name, file] of Object.entries(DATASETS)) {
      const value = data[name] ?? rules?.[name];
      if (value === undefined) continue;
      datasets[name] = {
        ...await writeJson(destination, file, value),
        provenance: rules?.provenance[name] ?? { kind: 'vanilla-runtime', registry: name }
      };
    }
    const manifest = {
      schemaVersion: 1, minecraftVersion: version, dataVersion: data.metadata.dataVersion,
      extractor: await extractorIdentity(root),
      source: { ...runtime.source, metadata: { sha1: runtime.entry.sha1, url: runtime.entry.url } },
      datasets, unavailable, validation: checks
    };
    await writeJson(destination, 'version.json', runtime.entry);
    await writeJson(destination, 'manifest.json', manifest);
    await writeJson(destination, '_list.json', { directories: [], files: ['manifest.json', 'version.json', ...Object.values(datasets).map(entry => entry.file)].sort() });
    await validateDirectory(destination, version);
    if (options.fixtures) {
      await mkdir(path.dirname(path.resolve(options.fixtures)), { recursive: true });
      await writeFile(options.fixtures, await readFile(fixturesFile));
    }
    await rename(destination, output);
    console.log(`${version}: ${Object.keys(datasets).length} datasets, ${Object.keys(data.itemDefaults).length} items, ${Object.keys(data.blockStates).length} blocks; ${checks.itemSamples} native item samples checked → ${output}`);
    return manifest;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      version: { type: 'string' }, output: { type: 'string' }, cache: { type: 'string' }, fixtures: { type: 'string' }, offline: { type: 'boolean', default: false }
    } });
    if (!values.version || !values.output) throw new Error('Usage: node tools/extract.js --version VERSION --output DIR [--cache DIR] [--offline] [--fixtures FILE]');
    await extract(values.version, values.output, values);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
