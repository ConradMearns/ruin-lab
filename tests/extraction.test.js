import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoRegion } from '../src/extraction/demo.js';
import { ROLE, parseRegion, encodeRLE, decodeRLE, defaultSettings, computeSelection, indexOf, positionOf, suggestAir, serializeProject, parseProject, exportRuiner } from '../src/extraction/model.js';
import { parseStructure, replayFrame, parseTimelapse } from '../src/schema.js';
import { simulate } from '../src/engine.js';

const demo = () => parseRegion(createDemoRegion());
const key = (region, p) => indexOf(p, region.size);

test('full-volume RLE preserves air and both layers; unknown data is never air', () => {
  const region = demo();
  assert.deepEqual(decodeRLE(encodeRLE(region.solid), region.volume, () => true), region.solid);
  assert.ok(region.fluid.some(id => id));
  assert.equal(region.solid[key(region, [20, 4, 20])], 0);
  for (let i = 0; i < region.volume; i += 123) assert.equal(indexOf(positionOf(i, region.size), region.size), i);
  const short = createDemoRegion(); short.layers.solid.pop(); assert.throws(() => parseRegion(short), /full region/);
  const unknown = createDemoRegion(); unknown.layers.solid[0][1] = 999; assert.throws(() => parseRegion(unknown), /unknown palette/);
  const badAxis = createDemoRegion(); badAxis.axisOrder = 'xyz'; assert.throws(() => parseRegion(badAxis), /axis order/);
  const tooBig = createDemoRegion(); tooBig.size = [128, 128, 128]; assert.throws(() => parseRegion(tooBig), /1,000,000/);
});

test('construction suggestions do not select natural rock or infer intentional air', () => {
  const region = demo(), settings = { ...defaultSettings(region), margin: 0, shell: 0, foundation: 0 };
  const result = computeSelection(region, settings);
  assert.ok(result.counts[ROLE.BUILD] > 0); assert.equal(result.counts[ROLE.AIR], 0); assert.equal(result.counts[ROLE.TERRAIN], 0);
  assert.equal(result.roles[key(region, [1, 1, 1])], ROLE.NONE);
  assert.ok(computeSelection(region, { ...settings, sensitivity: 0.5 }).counts[ROLE.BUILD] > result.counts[ROLE.BUILD]);
});

test('manual choices stay locked while settings change; bounds clip without deleting locks', () => {
  const region = demo(), settings = defaultSettings(region);
  const build = computeSelection(region, settings).roles.findIndex(r => r === ROLE.BUILD);
  const rock = key(region, [1, 1, 1]), air = key(region, [20, 4, 20]);
  const overrides = new Map([[build, ROLE.NONE], [rock, ROLE.BUILD], [air, ROLE.AIR]]);
  const expanded = { ...settings, margin: 12, sensitivity: 0.5 };
  const result = computeSelection(region, expanded, overrides);
  assert.equal(result.roles[build], ROLE.NONE); assert.equal(result.roles[rock], ROLE.BUILD); assert.equal(result.roles[air], ROLE.AIR);
  const clipped = structuredClone(expanded); clipped.bounds.min = [10, 0, 0];
  assert.equal(computeSelection(region, clipped, overrides).roles[rock], ROLE.NONE);
  assert.equal(computeSelection(region, expanded, overrides).roles[rock], ROLE.BUILD);
  assert.throws(() => computeSelection(region, settings, new Map([[rock, ROLE.AIR]])), /observed empty/);
  assert.throws(() => computeSelection(region, settings, new Map([[air, ROLE.BUILD]])), /existing solid/);
});

test('air suggestions are bounded, report clipping, and do not change the region', () => {
  const region = demo(), settings = defaultSettings(region), copy = region.solid.slice();
  const seed = key(region, [20, 4, 20]);
  const result = suggestAir(region, seed, settings.bounds, 3);
  assert.ok(result.cells.length > 1); assert.ok(result.clipped);
  for (const i of result.cells) { assert.equal(region.solid[i], 0); assert.equal(region.fluid[i], 0); }
  assert.deepEqual(region.solid, copy);
  const limited = suggestAir(region, seed, settings.bounds, 24, 5); assert.equal(limited.cells.length, 5); assert.ok(limited.clipped);
  const open = suggestAir(region, key(region, [39, 29, 39]), settings.bounds, 2); assert.ok(open.atBoundary);
  assert.throws(() => suggestAir(region, key(region, [1, 1, 1]), settings.bounds), /empty cell/);
});

test('rock shell expands around deliberately marked cellar air and preserves geology', () => {
  const region = demo(), settings = { ...defaultSettings(region), margin: 0, foundation: 0, shell: 0 };
  const overrides = new Map([[key(region, [15, 4, 15]), ROLE.AIR]]);
  const before = computeSelection(region, settings, overrides);
  const after = computeSelection(region, { ...settings, shell: 3 }, overrides);
  assert.ok(after.counts[ROLE.TERRAIN] > before.counts[ROLE.TERRAIN]);
  const wall = key(region, [14, 4, 15]); assert.equal(after.roles[wall], ROLE.TERRAIN);
  assert.equal(region.data.palette[region.solid[wall]].code, 'game:rock-sandstone');
});

test('project round trip retains opaque records, palette mappings, air and overrides', () => {
  const raw = createDemoRegion(); raw.sourceChunks = [{ rawBase64: 'cHJpdmF0ZQ==', unknown: [1, 2, 3] }]; raw.sourceMappings = { items: { 999: 'test:opaque-item' } };
  const region = parseRegion(raw), settings = defaultSettings(region), overrides = new Map([[key(region, [20, 4, 20]), ROLE.AIR]]);
  const project = serializeProject(region, settings, overrides), reopened = parseProject(JSON.stringify(project));
  assert.deepEqual(reopened.region.data, raw); assert.deepEqual(reopened.overrides, overrides);
  assert.deepEqual(serializeProject(reopened.region, reopened.settings, reopened.overrides), project);
  const tampered = structuredClone(project); tampered.selection.mask = encodeRLE(new Uint8Array(region.volume));
  assert.throws(() => parseProject(tampered), /does not match/);
  const duplicate = structuredClone(project); duplicate.selection.overrides.push(duplicate.selection.overrides[0]); assert.throws(() => parseProject(duplicate), /Duplicate/);
});

test('ruiner export preserves source roles, explicit air metadata, fixed terrain, and fluid-loss accounting', () => {
  const raw = createDemoRegion(), r = parseRegion(raw);
  const occupied = key(r, [13, 6, 17]); const solidFluid = r.fluid.slice(); solidFluid[occupied] = 10; raw.layers.fluid = encodeRLE(solidFluid);
  const region = parseRegion(raw), settings = defaultSettings(region), air = key(region, [20, 4, 20]);
  const roles = computeSelection(region, settings, new Map([[air, ROLE.AIR]])).roles;
  const exported = exportRuiner(region, roles), parsed = parseStructure(JSON.stringify(exported));
  assert.ok(exported.extraction.originalSelectedAir.some(p => p.join(',') === '20,4,20'));
  assert.ok(exported.extraction.omittedCoexistingFluids.some(p => p.slice(0, 3).join(',') === '13,6,17'));
  assert.deepEqual(parsed, exported);
  assert.ok(Object.values(exported.materials).some(m => m.fixed && m.vsCode === 'game:rock-sandstone'));
  assert.equal(exported.sourceChunks, undefined); assert.equal(exported.sourceMappings, undefined);
  const history = simulate(exported, { steps: 4, weathering: 3, water: true });
  assert.deepEqual(parseTimelapse(JSON.stringify(history)).structure.extraction, exported.extraction);
  const final = new Map(replayFrame(history.structure, history.frames, 4).map(v => [v.slice(0, 3).join(','), v[3]]));
  for (const v of exported.voxels) if (exported.materials[v[3]].fixed) assert.equal(final.get(v.slice(0, 3).join(',')), v[3]);
});

test('fixed non-ground geology supports walls, never moves/decays, and is not sediment material', () => {
  const input = { version: 1, size: [5, 8, 5], materials: {
    0: { name: 'air' }, 1: { name: 'sandstone context', color: '#baa787', fixed: true, durability: 0.001, decays_to: '0' },
    2: { name: 'wall', color: '#aaaaaa' }, 3: { name: 'loose context', color: '#888888', fixed: true, loose: true },
  }, voxels: [[1, 3, 1, 1], [1, 4, 1, 2], [3, 5, 3, 3]] };
  const result = simulate(input, { steps: 5, water: true, rainfall: 2, weathering: 3, overgrowth: false });
  assert.deepEqual(replayFrame(result.structure, result.frames, 5), input.voxels);
  assert.ok(result.frames.every(f => f.stats.deposited === 0));
});
