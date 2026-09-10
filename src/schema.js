const MAX_VOXELS = 150000;
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const integer = (n) => Number.isInteger(n) && n >= 0;

/** Validate the version-1 interchange format. Coordinates are X, Y (up), Z. */
export function parseStructure(input) {
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { throw new Error('This file is not valid JSON.'); }
  }
  if (!input || input.version !== 1) throw new Error('Expected a voxel structure with version: 1.');
  const { size, materials, voxels } = input;
  if (!Array.isArray(size) || size.length !== 3 || size.some(n => !integer(n) || n < 1 || n > 128) || size.reduce((a, b) => a * b, 1) > 2000000) throw new Error('Size must contain three integers from 1 to 128 (maximum volume 2,000,000).');
  if (!materials || typeof materials !== 'object' || Array.isArray(materials) || !own(materials, '0')) throw new Error('Materials must include material 0 (air).');
  if (Object.keys(materials).length > 256) throw new Error('A structure can have at most 256 materials.');
  const normalized = {};
  for (const [id, m] of Object.entries(materials)) {
    if (!/^(0|[1-9]\d*)$/.test(id) || Number(id) > 65535 || !m || typeof m !== 'object' || typeof m.name !== 'string' || !m.name.trim()) throw new Error(`Invalid material ${id}: use numeric IDs and a name.`);
    if (id !== '0' && (typeof m.color !== 'string' || !/^#[\da-f]{6}$/i.test(m.color))) throw new Error(`Material ${id} needs a six-digit hex color, e.g. #8a8a85.`);
    if (m.durability !== undefined && (!Number.isFinite(m.durability) || m.durability <= 0)) throw new Error(`Material ${id}: durability must be greater than zero.`);
    if (m.span !== undefined && (!integer(m.span) || m.span > 128)) throw new Error(`Material ${id}: span must be an integer from 0 to 128.`);
    for (const flag of ['ground', 'loose', 'organic']) if (m[flag] !== undefined && typeof m[flag] !== 'boolean') throw new Error(`Material ${id}: ${flag} must be a boolean.`);
    normalized[id] = { ...m, ...(m.decays_to !== undefined ? { decays_to: String(m.decays_to) } : {}) };
  }
  for (const [id, m] of Object.entries(normalized)) {
    if (m.decays_to !== undefined && !own(normalized, m.decays_to)) throw new Error(`Material ${id} decays to unknown material ${m.decays_to}.`);
  }
  if (!Array.isArray(voxels) || voxels.length > MAX_VOXELS) throw new Error(`Voxels must be an array of at most ${MAX_VOXELS.toLocaleString()} entries.`);
  const seen = new Set();
  const clean = [];
  for (let i = 0; i < voxels.length; i++) {
    const v = validateVoxel(voxels[i], size, normalized, `Voxel ${i}`);
    const key = v.slice(0, 3).join(',');
    if (seen.has(key)) throw new Error(`Duplicate voxel at [${key}].`);
    seen.add(key);
    if (v[3] !== 0) clean.push(v);
  }
  return { version: 1, size: [...size], materials: normalized, voxels: clean };
}

function validateVoxel(v, size, materials, label) {
  if (!Array.isArray(v) || v.length !== 4 || v.slice(0, 3).some((n, axis) => !integer(n) || n >= size[axis])) throw new Error(`${label}: expected an in-bounds [x, y, z, material] tuple.`);
  if (!(typeof v[3] === 'number' || typeof v[3] === 'string') || !own(materials, String(v[3]))) throw new Error(`${label}: unknown material ${v[3]}.`);
  return [v[0], v[1], v[2], Number(v[3])];
}

export function parseTimelapse(input) {
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { throw new Error('This file is not valid JSON.'); }
  }
  if (!input || !input.structure) throw new Error('A timelapse must contain a structure.');
  const structure = parseStructure(input.structure);
  if (!Number.isFinite(input.step_years) || input.step_years <= 0) throw new Error('step_years must be positive.');
  if (!Array.isArray(input.frames) || input.frames.length > 100) throw new Error('Expected up to 100 timelapse frames.');
  let previous = 0;
  let total = 0;
  const frames = input.frames.map((frame, i) => {
    if (!Number.isFinite(frame.t) || frame.t <= previous) throw new Error(`Frame ${i}: times must be positive and strictly increasing.`);
    previous = frame.t;
    if (!Array.isArray(frame.set) || (total += frame.set.length) > 2000000) throw new Error('Too many frame updates (maximum 2,000,000).');
    const seen = new Set();
    const set = frame.set.map(v => {
      const clean = validateVoxel(v, structure.size, structure.materials, `Frame ${i}`);
      const key = clean.slice(0, 3).join(',');
      if (seen.has(key)) throw new Error(`Frame ${i}: duplicate update at [${key}].`);
      seen.add(key); return clean;
    });
    return { t: frame.t, set };
  });
  return { structure, step_years: input.step_years, frames, ...(input.seed !== undefined ? { seed: input.seed } : {}), ...(input.settings ? { settings: input.settings } : {}) };
}

/** Index 0 is the original; index N includes the first N patches. */
export function replayFrame(structure, frames, frameIndex) {
  const map = new Map(structure.voxels.map(v => [v.slice(0, 3).join(','), [...v]]));
  for (let i = 0; i < Math.min(frameIndex, frames.length); i++) {
    for (const v of frames[i].set) {
      const key = v.slice(0, 3).join(',');
      if (Number(v[3]) === 0) map.delete(key); else map.set(key, [...v]);
    }
  }
  return [...map.values()];
}
