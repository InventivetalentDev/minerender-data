import { parseArgs } from 'node:util';
import { validateDirectory } from './validation.js';

try {
  const { values } = parseArgs({ options: { input: { type: 'string' }, version: { type: 'string' } } });
  if (!values.input) throw new Error('Usage: node tools/validate.js --input DIR [--version VERSION]');
  const manifest = await validateDirectory(values.input, values.version);
  console.log(`${manifest.minecraftVersion}: ${Object.keys(manifest.datasets).length} datasets verified`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
