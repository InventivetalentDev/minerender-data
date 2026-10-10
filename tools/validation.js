import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { assert, object, identifier, versionId, DATASETS, sha256, stableStringify } from './lib.js';
import { buildRules, UnsupportedRulesVersionError } from './rules.js';

const integer = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const color = value => integer(value, 0, 0xffffff);

export function validateRuntime(data, version) {
  assert(data.metadata?.minecraftVersion === version, `Extracted version does not match ${version}`);
  assert(integer(data.metadata.dataVersion, 0, 2147483647), 'Missing numeric Minecraft data version');
  for (const [id, components] of object(data.itemDefaults, 'Item defaults')) {
    identifier(id);
    for (const [component, value] of object(components, `Components of ${id}`)) {
      assert(['minecraft:max_stack_size', 'minecraft:max_damage', 'minecraft:damage', 'minecraft:enchantment_glint_override'].includes(component), `Unexpected default component: ${component}`);
      assert(component === 'minecraft:enchantment_glint_override' ? typeof value === 'boolean'
        : integer(value, component === 'minecraft:damage' ? 0 : 1, component === 'minecraft:max_stack_size' ? 99 : 2147483647), `Invalid ${component} on ${id}`);
    }
    assert(Object.hasOwn(components, 'minecraft:max_stack_size'), `Missing maximum stack size: ${id}`);
  }
  const { effects, potions } = data.potionColors;
  for (const [id, value] of object(effects, 'Effect colors')) { identifier(id); assert(color(value), `Invalid effect color: ${id}`); }
  for (const [id, values] of object(potions, 'Potions')) {
    identifier(id);
    assert(Array.isArray(values), `Invalid effects: ${id}`);
    for (const effect of values) {
      assert(Object.hasOwn(effects, effect.id) && integer(effect.amplifier, 0, 255), `Invalid potion effect: ${id}`);
    }
  }
  for (const [id, properties] of object(data.blockStates, 'Block states')) {
    identifier(id);
    for (const [name, property] of object(properties, `Properties of ${id}`)) {
      assert(/^[a-z0-9_]+$/.test(name), `Invalid property: ${id}/${name}`);
      assert(['boolean', 'int', 'enum'].includes(property.type) && typeof property.valueType === 'string', `Invalid property type: ${id}/${name}`);
      assert(Array.isArray(property.values) && property.values.length > 0 && property.values.includes(property.default), `Invalid property default: ${id}/${name}`);
      const expected = property.type === 'int' ? 'number' : property.type === 'boolean' ? 'boolean' : 'string';
      assert(property.values.every(value => typeof value === expected && (expected !== 'number' || Number.isInteger(value)))
        && new Set(property.values).size === property.values.length, `Invalid property values: ${id}/${name}`);
    }
  }
  for (const [id, rule] of object(data.fluids, 'Fluid blocks')) {
    assert(Object.hasOwn(data.blockStates, id) && ['water', 'lava'].includes(rule.kind) && typeof rule.renderModel === 'boolean', `Invalid fluid rule: ${id}`);
    if (rule.levelProperty !== undefined) assert(Object.hasOwn(data.blockStates[id], rule.levelProperty), `Unknown fluid level property: ${id}`);
  }
  const dyes = object(data.dyes, 'Dyes');
  assert(dyes.length === 16 && new Set(dyes.map(([, dye]) => dye.id)).size === 16, 'Expected 16 distinct dyes');
  for (const [name, dye] of dyes) assert(integer(dye.id, 0, 15) && [dye.textureDiffuseColor, dye.fireworkColor, dye.textColor].every(color), `Invalid dye: ${name}`);
  for (const values of [data.itemDefaults, effects, potions, data.blockStates, data.fluids]) assert(Object.keys(values).length > 0, 'Extracted dataset is empty');
}

export function effectColor(effects, colors) {
  let weight = 0, red = 0, green = 0, blue = 0;
  for (const effect of effects) {
    if (effect.show_particles === false) continue;
    const value = colors[effect.id], contribution = effect.amplifier + 1;
    assert(color(value), `Unknown effect color: ${effect.id}`);
    weight += contribution;
    red += (value >> 16 & 255) * contribution;
    green += (value >> 8 & 255) * contribution;
    blue += (value & 255) * contribution;
  }
  return weight ? Math.floor(red / weight) << 16 | Math.floor(green / weight) << 8 | Math.floor(blue / weight) : null;
}

export function validateFixtures(data, fixture) {
  assert(fixture.minecraftVersion === data.metadata.minecraftVersion, 'Native fixture version mismatch');
  let stacks = 0;
  assert(Object.keys(fixture.items).length === Object.keys(data.itemDefaults).length, 'Incomplete native item fixtures');
  for (const [id, samples] of object(fixture.items, 'Item fixtures')) {
    const defaults = data.itemDefaults[id];
    assert(defaults && Array.isArray(samples) && samples.length, `Invalid item fixture: ${id}`);
    const maximum = defaults['minecraft:max_damage'] ?? 0;
    const expected = [1, 8, 16, 32, 64].map(count => ({ count, damage: defaults['minecraft:damage'] ?? 0 }));
    if (maximum > 0) expected.push({ count: 1, damage: Math.floor(maximum / 2) }, { count: 1, damage: maximum });
    assert(samples.length === expected.length, `Incomplete native stack samples: ${id}`);
    for (const [index, sample] of samples.entries()) {
      if (id === 'minecraft:air') continue;
      assert(sample.maxStackSize === defaults['minecraft:max_stack_size'] && sample.maxDamage === (defaults['minecraft:max_damage'] ?? 0), `Native item defaults differ: ${id}`);
      assert(sample.count === expected[index].count && sample.damage === expected[index].damage, `Native stack count or damage differs: ${id}`);
      if (maximum > 0) {
        const damageFraction = Math.fround(Math.fround(Math.fround(sample.damage) * 13) / Math.fround(maximum));
        const width = Math.max(0, Math.min(13, Math.round(Math.fround(13 - damageFraction))));
        assert(sample.barVisible === (sample.damage > 0) && sample.barWidth === width, `Native durability bar differs: ${id}`);
      }
      stacks++;
    }
  }
  assert(Object.keys(fixture.potions).length === Object.keys(data.potionColors.potions).length, 'Incomplete native potion fixtures');
  for (const [id, expected] of object(fixture.potions, 'Potion fixtures')) {
    assert(effectColor(data.potionColors.potions[id], data.potionColors.effects) === expected, `Native potion color differs: ${id}`);
  }
  for (const entry of fixture.effectMixtures) assert(effectColor(entry.effects, data.potionColors.effects) === entry.color, 'Native mixed-effect color differs');
  return { itemSamples: stacks, potionColors: Object.keys(fixture.potions).length, effectMixtures: fixture.effectMixtures.length };
}

export async function validateDirectory(directory, expectedVersion) {
  const files = (await readdir(directory, { withFileTypes: true }));
  assert(files.every(file => file.isFile() && file.name.endsWith('.json')), 'Dataset directory must contain only JSON files');
  const read = async file => JSON.parse(await readFile(path.join(directory, file), 'utf8'));
  const manifest = await read('manifest.json');
  versionId(manifest.minecraftVersion);
  if (expectedVersion) assert(manifest.minecraftVersion === expectedVersion, 'Published dataset version mismatch');
  assert(manifest.schemaVersion === 1, 'Unsupported dataset schema');
  assert(manifest.source?.client?.sha1?.match(/^[a-f0-9]{40}$/) && manifest.extractor?.sha256?.match(/^[a-f0-9]{64}$/), 'Missing dataset provenance');
  const version = await read('version.json');
  assert(version.id === manifest.minecraftVersion && version.sha1 === manifest.source.metadata?.sha1
    && version.url === manifest.source.metadata?.url && /^[a-f0-9]{40}$/.test(version.sha1), 'Mojang version metadata mismatch');
  for (const name of ['client', 'metadata', 'mappings']) {
    const source = manifest.source[name];
    if (name === 'mappings' && source === undefined) continue;
    assert(source && /^[a-f0-9]{40}$/.test(source.sha1) && typeof source.url === 'string' && source.url.startsWith('https://'), `Invalid ${name} provenance`);
  }
  if (manifest.source.mappings) assert(typeof manifest.source.remapper?.version === 'string'
    && /^[a-f0-9]{40}$/.test(manifest.source.remapper.sha1), 'Missing remapper provenance');
  const unavailable = Object.fromEntries(object(manifest.unavailable, 'Unavailable datasets'));
  for (const [name, reason] of Object.entries(unavailable)) {
    assert(Object.hasOwn(DATASETS, name) && typeof reason === 'string' && reason.length > 0
      && !Object.hasOwn(manifest.datasets, name), `Invalid unavailable dataset: ${name}`);
  }
  for (const name of Object.keys(DATASETS)) assert(Object.hasOwn(manifest.datasets, name) || Object.hasOwn(unavailable, name), `Unreported dataset: ${name}`);
  const allowed = new Set(['manifest.json', 'version.json', '_list.json']);
  const runtime = { metadata: { minecraftVersion: manifest.minecraftVersion, dataVersion: manifest.dataVersion } };
  for (const [name, entry] of object(manifest.datasets, 'Dataset manifest')) {
    assert(DATASETS[name] === entry.file, `Unexpected dataset: ${name}`);
    assert(!allowed.has(entry.file), `Duplicate dataset file: ${entry.file}`);
    allowed.add(entry.file);
    const bytes = await readFile(path.join(directory, entry.file));
    assert(sha256(bytes) === entry.sha256 && bytes.length === entry.bytes, `Dataset checksum mismatch: ${entry.file}`);
    runtime[name] = JSON.parse(bytes);
  }
  assert(files.length === allowed.size && files.every(file => allowed.has(file.name)), 'Unlisted dataset files');
  const list = await read('_list.json');
  assert(Array.isArray(list.directories) && list.directories.length === 0 && JSON.stringify(list.files) === JSON.stringify([...allowed].filter(file => file !== '_list.json').sort()), 'Invalid directory index');
  validateRuntime(runtime, manifest.minecraftVersion);
  let rules;
  try { rules = await buildRules(manifest.minecraftVersion, runtime.blockStates); }
  catch (error) { if (!(error instanceof UnsupportedRulesVersionError)) throw error; }
  for (const name of ['blockTints', 'legacyBlocks']) {
    assert(rules ? stableStringify(runtime[name]) === stableStringify(rules[name]) : !Object.hasOwn(runtime, name), `Unreviewed or mismatched dataset: ${name}`);
    if (rules) assert(stableStringify(manifest.datasets[name].provenance) === stableStringify(rules.provenance[name]), `Reviewed provenance mismatch: ${name}`);
  }
  return manifest;
}
