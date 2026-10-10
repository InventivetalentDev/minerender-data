import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

export class UnsupportedRulesVersionError extends Error {
  constructor(version) {
    super(`Preview rules and legacy mappings have not been reviewed for Minecraft ${version}`);
    this.name = 'UnsupportedRulesVersionError';
    this.version = version;
  }
}

async function readSource(name, provenance) {
  const content = await readFile(new URL(`../sources/${name}`, import.meta.url));
  const sha256 = createHash('sha256').update(content).digest('hex');
  if (sha256 !== provenance.sha256) throw new Error(`${name}: source checksum does not match provenance`);
  return JSON.parse(content);
}

function checkProperty(block, states, property, expected) {
  const values = states[property]?.values;
  if (!Array.isArray(values) || values.length !== expected.length || expected.some(value => !values.includes(value))) {
    throw new Error(`block-tints: ${block} requires ${property} values ${expected.join(', ')}`);
  }
}

function buildBlockTints(source, blockStates) {
  const included = {};
  const excluded = [];
  for (const [block, rule] of Object.entries(source).sort(([a], [b]) => a.localeCompare(b))) {
    if (!ID.test(block) || !rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`block-tints: invalid rule for ${block}`);
    }
    const keys = rule.source === 'constant' ? ['source', 'color', 'untinted'] : ['source', 'untinted'];
    if (Object.keys(rule).some(key => !keys.includes(key)) || !['constant', 'grass', 'redstone', 'stem'].includes(rule.source)) {
      throw new Error(`block-tints: invalid source or fields for ${block}`);
    }
    if (rule.source === 'constant' && (!Number.isInteger(rule.color) || rule.color < 0 || rule.color > 0xffffff)) {
      throw new Error(`block-tints: invalid RGB color for ${block}`);
    }
    if (rule.untinted !== undefined && (!Array.isArray(rule.untinted) || rule.untinted.some(value => !Number.isInteger(value) || value < 0))) {
      throw new Error(`block-tints: invalid untinted indices for ${block}`);
    }
    if (!Object.hasOwn(blockStates, block)) {
      excluded.push(block);
      continue;
    }
    if (rule.source === 'redstone') checkProperty(block, blockStates[block], 'power', Array.from({ length: 16 }, (_, i) => i));
    if (rule.source === 'stem') checkProperty(block, blockStates[block], 'age', Array.from({ length: 8 }, (_, i) => i));
    included[block] = rule;
  }
  return { included, excluded };
}

function buildLegacyBlocks(source, blockStates, corrections) {
  const blocks = { ...source.blocks };
  for (const [key, correction] of Object.entries(corrections)) {
    if (blocks[key] !== correction.from) throw new Error(`legacy-blocks: correction source changed for ${key}`);
    blocks[key] = correction.to;
  }
  for (const [key, state] of Object.entries(blocks)) {
    if (!/^\d+:(?:[0-9]|1[0-5])$/.test(key) || typeof state !== 'string') throw new Error(`legacy-blocks: invalid entry ${key}`);
    const match = /^([a-z0-9_.-]+:[a-z0-9_./-]+)(?:\[([^\]]+)\])?$/.exec(state);
    if (!match || !Object.hasOwn(blockStates, match[1])) throw new Error(`legacy-blocks: ${key} refers to an unknown block: ${state}`);
    const seen = new Set();
    for (const field of match[2]?.split(',') ?? []) {
      const property = /^([a-z0-9_]+)=([a-z0-9_]+)$/.exec(field);
      if (!property || seen.has(property[1])) throw new Error(`legacy-blocks: ${key} has an invalid or duplicate property: ${field}`);
      seen.add(property[1]);
      const values = blockStates[match[1]][property[1]]?.values;
      if (!Array.isArray(values) || !values.map(String).includes(property[2])) {
        throw new Error(`legacy-blocks: ${key} has an unsupported property value: ${state}`);
      }
    }
  }
  return { blocks };
}

// Registry facts validate the reviewed rules; they do not extend their supported versions.
export async function buildRules(version, blockStates) {
  const source = JSON.parse(await readFile(new URL('../sources/provenance.json', import.meta.url), 'utf8'));
  for (const name of ['block-tints.json', 'legacy-blocks.json']) {
    if (!source[name].reviewedTargets.includes(version)) throw new UnsupportedRulesVersionError(version);
  }
  const [tints, legacy] = await Promise.all([
    readSource('block-tints.json', source['block-tints.json']),
    readSource('legacy-blocks.json', source['legacy-blocks.json'])
  ]);
  const blockTints = buildBlockTints(tints, blockStates);
  const corrections = source['legacy-blocks.json'].targetCorrections[version];
  if (!corrections) throw new Error(`legacy-blocks: missing target profile for ${version}`);
  const legacyBlocks = buildLegacyBlocks(legacy, blockStates, corrections);
  const provenance = Object.fromEntries([
    ['blockTints', 'block-tints.json'], ['legacyBlocks', 'legacy-blocks.json']
  ].map(([key, name]) => [key, {
    kind: source[name].kind,
    source: source[name].source,
    sourceSha256: source[name].sha256,
    targetVersion: version,
    description: source[name].description
  }]));
  provenance.blockTints.excludedAbsentBlocks = blockTints.excluded;
  Object.assign(provenance.legacyBlocks, {
    upstream: source['legacy-blocks.json'].upstream,
    sourceFormat: source['legacy-blocks.json'].sourceFormat,
    sourceMaxMinecraftVersion: source['legacy-blocks.json'].sourceMaxMinecraftVersion,
    corrections
  });
  return { blockTints: blockTints.included, legacyBlocks, provenance };
}
