#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { simulate } from '../src/engine.js';
import { parseStructure } from '../src/schema.js';

const [input, output, settingsPath] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: bun scripts/simulate.mjs structure.json timelapse.json [settings.json]');
  process.exitCode = 1;
} else {
  try {
    const structure = parseStructure(await readFile(input, 'utf8'));
    const settings = settingsPath ? JSON.parse(await readFile(settingsPath, 'utf8')) : {};
    const start = performance.now();
    const result = simulate(structure, settings);
    await writeFile(output, JSON.stringify(result, null, 2));
    console.log(`${result.frames.length} keyframes / ${result.frames.at(-1).t} years / seed ${result.seed} → ${output} (${Math.round(performance.now() - start)} ms)`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
