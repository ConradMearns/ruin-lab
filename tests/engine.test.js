import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulate } from '../src/engine.js';
import { parseStructure, parseTimelapse, replayFrame } from '../src/schema.js';
const tower = JSON.parse(readFileSync(new URL('../public/examples/coastal-watchtower.json', import.meta.url)));
const off = { exposure: false, collapse: false, sediment: false, overgrowth: false, water: false, steps: 3 };
const tiny = (voxels, extra = {}) => ({ version: 1, size: [6, 8, 6], materials: { 0: { name: 'air' }, 1: { name: 'stone', color: '#888888', durability: 1, decays_to: '3' }, 3: { name: 'rubble', color: '#777777', loose: true, durability: 0.6, decays_to: '0' }, 5: { name: 'soil', color: '#665544', durability: 2, ground: true }, ...extra }, voxels });

test('all examples validate', () => {
  for (const id of ['coastal-watchtower', 'hillside-chapel', 'courtyard-villa', 'forest-cottage']) {
    const s = parseStructure(JSON.parse(readFileSync(new URL(`../public/examples/${id}.json`, import.meta.url))));
    assert.ok(s.voxels.length > 1000);
  }
});
test('fixed seed is deterministic and does not mutate input', () => {
  const before = structuredClone(tower);
  const a = simulate(tower, { seed: 42 }); const b = simulate(tower, { seed: 42 });
  assert.deepEqual(a, b); assert.deepEqual(tower, before);
  assert.notDeepEqual(a.frames, simulate(tower, { seed: 43 }).frames);
});
test('disabled passes produce no changes', () => {
  const result = simulate(tower, off);
  assert.ok(result.frames.every(frame => frame.set.length === 0));
  assert.deepEqual(replayFrame(result.structure, result.frames, 3), tower.voxels);
});
test('exported patches validate and all replayed frames remain in bounds', () => {
  const result = simulate(tower, { water: true, steps: 20, weathering: 2, growthRate: 1.5 });
  const parsed = parseTimelapse(JSON.stringify(result));
  assert.equal(parsed.frames.length, 20);
  for (let i = 0; i <= 20; i++) {
    const voxels = replayFrame(parsed.structure, parsed.frames, i);
    assert.doesNotThrow(() => parseStructure({ ...parsed.structure, voxels }));
    if (i) {
      const previous = new Map(replayFrame(parsed.structure, parsed.frames, i - 1).map(v => [v.slice(0, 3).join(','), v[3]]));
      for (const v of parsed.frames[i - 1].set) assert.notEqual(previous.get(v.slice(0, 3).join(',')) || 0, v[3]);
    }
  }
});
test('ground is preserved under aggressive weather', () => {
  const result = simulate(tower, { steps: 30, weathering: 3, water: true, rainfall: 2 });
  const final = new Map(replayFrame(result.structure, result.frames, 30).map(v => [v.slice(0, 3).join(','), v[3]]));
  for (const v of tower.voxels.filter(v => tower.materials[v[3]].ground)) assert.equal(final.get(v.slice(0, 3).join(',')), v[3]);
});
test('floating cluster falls, supported courses remain', () => {
  const s = tiny([[1, 0, 1, 5], [1, 1, 1, 1], [1, 2, 1, 1], [4, 5, 4, 1], [4, 6, 4, 1]]);
  const result = simulate(s, { ...off, collapse: true, steps: 1 });
  const voxels = replayFrame(result.structure, result.frames, 1);
  assert.ok(voxels.some(v => v[0] === 1 && v[1] === 2 && v[2] === 1));
  assert.ok(!voxels.some(v => v[0] === 4 && v[1] >= 5));
  assert.ok(result.frames[0].stats.collapsed >= 2);
});
test('loose material falls down a column', () => {
  const s = tiny([[2, 0, 2, 5], [2, 6, 2, 3]]);
  const result = simulate(s, { ...off, collapse: true, steps: 1 });
  const rubble = replayFrame(result.structure, result.frames, 1).find(v => v[3] === 3);
  assert.ok(rubble && rubble[1] < 2);
});
test('material graphs can have cycles or no decay edge without hanging', () => {
  const s = tiny([[1, 1, 1, 1]], { 1: { name: 'stone', color: '#888888', durability: 0.01, decays_to: '1' } });
  const result = simulate(s, { ...off, exposure: true, steps: 5 });
  assert.equal(result.frames.flatMap(f => f.set).length, 0);
});
test('generated plants are serialized with the original palette', () => {
  const result = simulate(tower, { ...off, overgrowth: true, growthRate: 2, steps: 12 });
  assert.ok(Object.values(result.structure.materials).some(m => m.organic));
  assert.ok(result.frames.some(f => f.stats.grown > 0));
  assert.deepEqual(result.structure.voxels, tower.voxels);
});
test('numeric string voxel IDs normalize', () => { assert.equal(parseStructure(tiny([[0, 0, 0, '1']])).voxels[0][3], 1); });
test('schema rejects duplicates, invalid bounds, palette and material graphs', () => {
  assert.throws(() => parseStructure(tiny([[0, 0, 0, 1], [0, 0, 0, 1]])), /Duplicate/);
  assert.throws(() => parseStructure(tiny([[6, 0, 0, 1]])), /in-bounds/);
  assert.throws(() => parseStructure(tiny([[0, -1, 0, 1]])), /in-bounds/);
  assert.throws(() => parseStructure(tiny([[0, 0, 0, 9]])), /unknown material/);
  assert.throws(() => parseStructure(tiny([], { 1: { name: 'bad', color: 'red' } })), /hex color/);
  assert.throws(() => parseStructure(tiny([], { 1: { name: 'bad', color: '#888888', durability: 0 } })), /durability/);
  assert.throws(() => parseStructure(tiny([], { 1: { name: 'bad', color: '#888888', decays_to: '99' } })), /unknown material/);
});
test('timelapse import requires ordered frames and unique in-bounds patches', () => {
  const structure = tiny([[0, 0, 0, 1]]);
  assert.throws(() => parseTimelapse({ structure, step_years: 100, frames: [{ t: 100, set: [] }, { t: 99, set: [] }] }), /increasing/);
  assert.throws(() => parseTimelapse({ structure, step_years: 100, frames: [{ t: 100, set: [[0, 0, 0, 0], [0, 0, 0, 1]] }] }), /duplicate/);
  const result = parseTimelapse({ structure, step_years: 100, frames: [{ t: 100, set: [[0, 0, 0, 0], [1, 1, 1, 1]] }] });
  assert.deepEqual(replayFrame(result.structure, result.frames, 1), [[1, 1, 1, 1]]);
});
