import { parseStructure } from '../schema.js';

export const ROLE = Object.freeze({ NONE: 0, BUILD: 1, TERRAIN: 2, AIR: 3 });
export const ROLE_COLORS = ['#c0c4b4', '#d8aa65', '#81916a', '#72bfd1'];
export const indexOf = ([x, y, z], [W, , D]) => (y * D + z) * W + x;
export const positionOf = (i, [W, , D]) => [i % W, Math.floor(i / (W * D)), Math.floor(i / W) % D];
const volumeOf = size => size.reduce((a, b) => a * b, 1);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const check = (test, message) => { if (!test) throw new Error(message); };

export function encodeRLE(values) {
  const out = [];
  for (const value of values) {
    const last = out.at(-1);
    if (last?.[1] === value) last[0]++; else out.push([1, value]);
  }
  return out;
}
export function decodeRLE(runs, length, validValue) {
  check(Array.isArray(runs) && runs.length <= length, 'Invalid RLE array.');
  const values = new Uint32Array(length); let offset = 0;
  for (const run of runs) {
    check(Array.isArray(run) && run.length === 2 && Number.isInteger(run[0]) && run[0] > 0 && offset + run[0] <= length && Number.isInteger(run[1]) && run[1] >= 0 && validValue(run[1]), 'Invalid RLE run or unknown palette ID.');
    values.fill(run[1], offset, offset + run[0]); offset += run[0];
  }
  check(offset === length, 'RLE does not cover the full region. Missing data is not air.');
  return values;
}
export function parseRegion(input) {
  if (typeof input === 'string') input = JSON.parse(input);
  check(input?.format === 'ruin-lab/vs-region' && input.version === 1, 'Expected a version-1 VS region JSON, not a .vcdbs save or Ruin Lab structure.');
  check(Array.isArray(input.size) && input.size.length === 3 && input.size.every(n => Number.isInteger(n) && n > 0 && n <= 128) && volumeOf(input.size) <= 1000000, 'Region dimensions must be 1–128, with at most 1,000,000 cells.');
  check(Array.isArray(input.origin) && input.origin.length === 3 && input.origin.every(n => Number.isSafeInteger(n) && n >= 0), 'Invalid world origin.');
  check(input.axisOrder === 'xzy', 'Unsupported axis order. Expected x-fastest, then z, then y.');
  check(input.palette && typeof input.palette === 'object' && !Array.isArray(input.palette) && own(input.palette, '0') && Object.keys(input.palette).length <= 65536, 'Invalid block-code palette.');
  for (const [id, value] of Object.entries(input.palette)) check(/^(0|[1-9]\d*)$/.test(id) && Number(id) <= 2147483647 && typeof value?.code === 'string' && value.code.length > 0 && value.code.length < 512, `Invalid palette entry ${id}.`);
  check(['air', 'game:air'].includes(input.palette[0].code), 'Palette ID 0 must be air.');
  const length = volumeOf(input.size);
  const solid = decodeRLE(input.layers?.solid, length, v => own(input.palette, v));
  const fluid = decodeRLE(input.layers?.fluid, length, v => own(input.palette, v));
  const data = structuredClone(input); // Retain opaque source chunks and unknown metadata verbatim.
  return { data, solid, fluid, size: [...input.size], origin: [...input.origin], volume: length };
}

/** Heuristics are suggestions, not player provenance. Natural terrain can be placed too. */
export function blockInfo(code) {
  const name = code.split(':').at(-1);
  const strong = /^(slantedroof|roof|chiseledblock|door-|trapdoor-|bed-|chest-|labeledchest|planks-|cobblestone-|stonebricks-|claybricks-|woodenfence|fencegate|glass-|glasspane-|window|stairs-|slab-|supportbeam|ladder-|firepit|forge|anvil|shelf|shelv|barrel|quern|helvehammer)/.test(name);
  const medium = /^(farmland|crop-|packeddirt|path-|torch-|lantern-|crock|vessel|pot-|log-(?!grown)|rockpolished|polishedrock|stonepath|stonequarry)/.test(name) || code.startsWith('stonequarry');
  const plant = /^(leaves|tallgrass|flower-|tallplant|fern|mushroom|vine|lichen)/.test(name);
  const soil = /^(soil-|peat-|muddygravel|sand-|gravel-|mud-)/.test(name);
  const wood = /wood|planks|log-|ladder|door-|bed-|chest-|barrel|shelf|fence|beam/.test(name);
  const rock = /sandstone|granite|slate|limestone|chalk|basalt|andesite|peridotite|marble|shale/.test(name);
  let color = '#9c9887';
  if (name.includes('sandstone')) color = '#bea780';
  else if (name.includes('slate')) color = '#737b80';
  else if (name.includes('granite')) color = '#a0a09c';
  else if (/limestone|chalk|marble/.test(name)) color = '#c2bdab';
  else if (rock) color = '#7c8079';
  else if (soil) color = /normal|sparse/.test(name) ? '#7c8757' : '#887b5b';
  else if (wood) color = '#967452';
  else if (plant) color = '#7a925b';
  else if (/water|ice|glass/.test(name)) color = '#7da9ac';
  else if (/roof/.test(name)) color = '#8b8580';
  else if (/chiseled/.test(name)) color = '#baa887';
  return { name, confidence: strong ? 0.95 : medium ? 0.6 : 0, color, soil, wood, plant };
}
export function defaultSettings(region) {
  return { bounds: { min: [0, 0, 0], max: region.size.map(n => n - 1) }, sensitivity: 0.75, margin: 3, shell: 2, foundation: 3 };
}
export function validateSettings(settings, region) {
  check(settings?.bounds && ['min', 'max'].every(k => Array.isArray(settings.bounds[k]) && settings.bounds[k].length === 3 && settings.bounds[k].every((n, a) => Number.isInteger(n) && n >= 0 && n < region.size[a])), 'Selection bounds are outside the loaded region.');
  check(settings.bounds.min.every((n, a) => n <= settings.bounds.max[a]), 'Minimum bounds must not exceed maximum bounds.');
  for (const [key, max] of [['sensitivity', 1], ['margin', 12], ['shell', 12], ['foundation', 16]]) check(Number.isFinite(settings[key]) && settings[key] >= 0 && settings[key] <= max && (key === 'sensitivity' || Number.isInteger(settings[key])), `Invalid ${key} setting.`);
  return structuredClone(settings);
}
export function inBounds(pos, bounds) { return pos.every((n, a) => n >= bounds.min[a] && n <= bounds.max[a]); }
function neighbors(i, size) {
  const [W, H, D] = size, [x, y, z] = positionOf(i, size); const out = [];
  if (x > 0) out.push(i - 1); if (x < W - 1) out.push(i + 1);
  if (z > 0) out.push(i - W); if (z < D - 1) out.push(i + W);
  if (y > 0) out.push(i - W * D); if (y < H - 1) out.push(i + W * D);
  return out;
}
function distances(region, seeds, max, allowed) {
  const d = new Uint8Array(region.volume).fill(255), queue = new Int32Array(region.volume); let head = 0, tail = 0;
  for (const i of seeds) if (d[i] === 255) { d[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++]; if (d[i] >= max) continue;
    for (const n of neighbors(i, region.size)) if (d[n] === 255 && allowed[n]) { d[n] = d[i] + 1; queue[tail++] = n; }
  }
  return d;
}
export function validateRole(region, index, role) {
  check(Number.isInteger(index) && index >= 0 && index < region.volume && [0, 1, 2, 3].includes(role), 'Invalid manual selection cell.');
  const occupied = region.solid[index] || region.fluid[index];
  check(role !== ROLE.AIR || !occupied, 'Intentional air can only mark an observed empty cell. This tool does not excavate.');
  check(![ROLE.BUILD, ROLE.TERRAIN].includes(role) || occupied, 'Construction/terrain needs an existing solid or fluid cell.');
}

export function computeSelection(region, settings, overrides = new Map()) {
  validateSettings(settings, region);
  const roles = new Uint8Array(region.volume), allowed = new Uint8Array(region.volume), build = [], air = [];
  const info = Object.fromEntries(Object.entries(region.data.palette).map(([id, m]) => [id, blockInfo(m.code)]));
  for (let i = 0; i < region.volume; i++) {
    if (!inBounds(positionOf(i, region.size), settings.bounds)) continue;
    allowed[i] = 1;
    if (region.solid[i] && info[region.solid[i]].confidence >= settings.sensitivity && info[region.solid[i]].confidence > 0) roles[i] = ROLE.BUILD;
    if (overrides.has(i)) { validateRole(region, i, overrides.get(i)); roles[i] = overrides.get(i); }
    if (roles[i] === ROLE.BUILD) build.push(i);
    if (roles[i] === ROLE.AIR) air.push(i);
  }
  const nearBuild = distances(region, build, settings.margin, allowed);
  const nearAir = distances(region, air, settings.shell, allowed);
  for (let i = 0; i < region.volume; i++) {
    if (!allowed[i] || roles[i] || !(region.solid[i] || region.fluid[i])) continue;
    if (nearBuild[i] <= settings.margin || nearAir[i] <= settings.shell) roles[i] = ROLE.TERRAIN;
  }
  const layer = region.size[0] * region.size[2];
  for (const i of build) for (let d = 1; d <= settings.foundation; d++) {
    const n = i - d * layer;
    if (n < 0 || !allowed[n]) break;
    if (!roles[n] && (region.solid[n] || region.fluid[n])) roles[n] = ROLE.TERRAIN;
  }
  // Explicit admin choices always win; bounds still act as a hard clipping mask.
  for (const [i, role] of overrides) { validateRole(region, i, role); if (allowed[i]) roles[i] = role; }
  const counts = [0, 0, 0, 0]; for (const r of roles) counts[r]++;
  return { roles, counts };
}

/** Flood only observed dry air; preview first. A clipped flood is never called a room. */
export function suggestAir(region, seed, bounds, reach = 8, limit = 12000) {
  check(Number.isInteger(seed) && seed >= 0 && seed < region.volume, 'Choose a cell within the region.');
  check(!region.solid[seed] && !region.fluid[seed], 'Choose an empty cell on the slice.');
  check(inBounds(positionOf(seed, region.size), bounds), 'Choose a cell inside the selection bounds.');
  check(Number.isInteger(reach) && reach >= 1 && reach <= 24, 'Air reach must be 1–24 cells.');
  const seen = new Uint8Array(region.volume), cells = [seed], depth = [0]; seen[seed] = 1;
  let clipped = false, atBoundary = false;
  for (let head = 0; head < cells.length; head++) {
    const i = cells[head]; const pos = positionOf(i, region.size);
    if (pos.some((n, a) => n === bounds.min[a] || n === bounds.max[a])) atBoundary = true;
    for (const n of neighbors(i, region.size)) {
      if (seen[n] || region.solid[n] || region.fluid[n] || !inBounds(positionOf(n, region.size), bounds)) continue;
      if (depth[head] >= reach || cells.length >= limit) { clipped = true; continue; }
      seen[n] = 1; cells.push(n); depth.push(depth[head] + 1);
    }
  }
  return { cells, clipped, atBoundary, warning: clipped || atBoundary ? 'Open or clipped space: this may include outdoors or a cave. Review before accepting.' : 'Bounded dry-air component found. Natural caves are still possible; review before accepting.' };
}

export function serializeProject(region, settings, overrides) {
  const selection = computeSelection(region, settings, overrides);
  return { format: 'ruin-lab/vs-extraction-project', version: 1, region: region.data,
    selection: { algorithm: 'material-distance-v1', settings: structuredClone(settings), overrides: [...overrides].sort((a, b) => a[0] - b[0]), mask: encodeRLE(selection.roles) } };
}
export function parseProject(input) {
  if (typeof input === 'string') input = JSON.parse(input);
  check(input?.format === 'ruin-lab/vs-extraction-project' && input.version === 1 && input.selection?.algorithm === 'material-distance-v1', 'Unsupported extraction project version.');
  const region = parseRegion(input.region), settings = validateSettings(input.selection.settings, region), overrides = new Map();
  check(Array.isArray(input.selection.overrides) && input.selection.overrides.length <= region.volume, 'Invalid manual overrides.');
  for (const pair of input.selection.overrides) {
    check(Array.isArray(pair) && pair.length === 2 && !overrides.has(pair[0]), 'Duplicate or invalid override.');
    validateRole(region, pair[0], pair[1]); overrides.set(...pair);
  }
  const mask = decodeRLE(input.selection.mask, region.volume, v => v <= 3);
  const computed = computeSelection(region, settings, overrides).roles;
  check(mask.every((r, i) => r === computed[i]), 'Saved selection does not match its settings. Refusing silent changes.');
  return { region, settings, overrides };
}

/** Flatten to the artistic ruiner, not a VS schematic. The full project is the master. */
export function exportRuiner(region, roles) {
  check(roles.length === region.volume, 'Invalid selection size.');
  const materials = { 0: { name: 'air' } }, mapping = new Map(), voxels = [], selectedAir = [], omittedFluids = [];
  const getMaterial = (id, role, isFluid) => {
    const key = `${id}:${role}:${isFluid}`;
    if (mapping.has(key)) return mapping.get(key);
    const info = blockInfo(region.data.palette[id].code), fixed = role === ROLE.TERRAIN || isFluid;
    const next = Object.keys(materials).length;
    check(next < 253, 'Selection has too many material/role combinations for Ruin Lab (maximum 252). Narrow the bounds; the full project can still be saved.');
    materials[next] = { name: info.name, color: info.color, durability: info.wood ? 0.3 : info.plant ? 0.12 : 1,
      vsCode: region.data.palette[id].code, extractionRole: role === ROLE.BUILD ? 'construction' : 'terrain',
      ...(fixed ? { fixed: true } : { decays_to: '0' }), ...(isFluid ? { fluid: true } : {}),
      ...(fixed && info.soil && !isFluid ? { ground: true } : {}) };
    mapping.set(key, next); return next;
  };
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]; if (!role) continue;
    validateRole(region, i, role);
    const pos = positionOf(i, region.size);
    if (role === ROLE.AIR) { selectedAir.push(pos); continue; }
    const solid = region.solid[i], fluid = region.fluid[i];
    if (solid) voxels.push([...pos, getMaterial(solid, role, false)]);
    else if (fluid) voxels.push([...pos, getMaterial(fluid, role, true)]);
    if (solid && fluid) omittedFluids.push([...pos, region.data.palette[fluid].code]);
  }
  check(voxels.length > 0, 'Select at least one solid/fluid cell before exporting to Ruin Lab.');
  check(voxels.length <= 150000, 'Too many selected voxels for Ruin Lab (150,000 maximum). Save the project or narrow the selection.');
  // Preserve geology in rubble transitions, sharing a variant only where the source color matches.
  const rubbleByColor = new Map();
  for (const material of Object.values(materials)) {
    if (!material.fixed && material.decays_to && material.durability === 1) {
      let id = rubbleByColor.get(material.color);
      if (!id && Object.keys(materials).length < 253) {
        id = Object.keys(materials).length; materials[id] = { name: `${material.name} rubble`, color: material.color, loose: true, durability: 0.6, decays_to: '0' }; rubbleByColor.set(material.color, id);
      }
      if (id) material.decays_to = String(id);
    }
  }
  return parseStructure({ version: 1, size: [...region.size], materials, voxels,
    extraction: { format: 'ruin-lab/vs-selection', version: 1, origin: [...region.origin], sourceName: String(region.data.name || 'VS extraction'),
      originalSelectedAir: selectedAir, omittedCoexistingFluids: omittedFluids,
      warnings: ['Approximate single-layer simulation, not a Vintage Story schematic.', 'Retain the extraction project for original blocks, fluid layers, air intent, and opaque source data.', 'Original selected air is provenance, not a constraint on future collapse or sediment.'] } });
}
