import { parseStructure } from './schema.js';

export const DEFAULTS = Object.freeze({ steps: 12, stepYears: 100, seed: 1847, exposure: true, collapse: true, sediment: true, overgrowth: true, water: false, weathering: 1, sedimentRate: 0.45, growthRate: 0.65, rainfall: 0.6, span: 3, wind: 'NW' });
export function seededRandom(seed) {
  let a = 2166136261;
  for (const c of String(seed)) a = Math.imul(a ^ c.charCodeAt(0), 16777619);
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/** Coarse, deterministic CA. No mesh/Three.js dependencies: also runs offline in Node/Bun. */
export function simulate(input, options = {}, onProgress = () => {}) {
  const structure = parseStructure(input);
  const s = { ...DEFAULTS, ...options };
  for (const [key, min, max] of [['steps', 1, 30], ['stepYears', 10, 500], ['weathering', 0, 3], ['sedimentRate', 0, 2], ['growthRate', 0, 2], ['rainfall', 0, 2], ['span', 0, 10]]) {
    s[key] = clamp(Number.isFinite(Number(s[key])) ? Number(s[key]) : DEFAULTS[key], min, max);
  }
  s.steps = Math.round(s.steps); s.stepYears = Math.round(s.stepYears); s.span = Math.round(s.span);
  const random = seededRandom(s.seed);
  const [W, H, D] = structure.size; const layer = W * D;
  const key = (x, y, z) => x + z * W + y * layer;
  const xyz = k => [k % W, Math.floor(k / layer), Math.floor(k % layer / W)];
  const inside = (x, y, z) => x >= 0 && z >= 0 && y >= 0 && x < W && y < H && z < D;
  const grid = new Uint16Array(layer * H);
  const mats = structure.materials;
  const original = [];
  const footprint = [];
  for (const [x, y, z, m] of structure.voxels) {
    grid[key(x, y, z)] = m;
    if (!mats[m].ground && !mats[m].fixed && !mats[m].organic) { original.push(key(x, y, z)); footprint.push([x, z]); }
  }
  const findMat = predicate => Number(Object.keys(mats).find(id => id !== '0' && predicate(mats[id])) || 0);
  const rubble = findMat(m => m.loose && !m.fixed);
  const soil = findMat(m => m.ground);
  const addMaterial = m => {
    const existing = findMat(n => n.name === m.name);
    if (existing) return existing;
    let id = 1; while (mats[id]) id++;
    if (Object.keys(mats).length >= 256) return 0;
    mats[id] = m; return id;
  };
  const moss = s.overgrowth ? addMaterial({ name: 'moss', color: '#7f9259', durability: 0.12, decays_to: '0', organic: true, render: 'moss' }) : 0;
  const grass = s.overgrowth ? addMaterial({ name: 'wild grass', color: '#96a765', durability: 0.08, decays_to: '0', organic: true, render: 'tuft' }) : 0;
  const vine = s.overgrowth ? addMaterial({ name: 'ivy', color: '#5c784f', durability: 0.2, decays_to: '0', organic: true, render: 'vine' }) : 0;
  const distance = new Float32Array(layer).fill(1000);
  const uniqueFootprint = [...new Set(footprint.map(([x, z]) => x + z * W))];
  // Local distance apron; cost is bounded by a 15×15 kernel per occupied column.
  for (const c of uniqueFootprint) {
    const fx = c % W, fz = Math.floor(c / W);
    for (let dz = -7; dz <= 7; dz++) for (let dx = -7; dx <= 7; dx++) {
      const x = fx + dx, z = fz + dz;
      if (inside(x, 0, z)) distance[x + z * W] = Math.min(distance[x + z * W], Math.hypot(dx, dz));
    }
  }
  const initialGround = new Int16Array(layer).fill(-1);
  for (let k = 0; k < grid.length; k++) if (grid[k] && mats[grid[k]].ground) initialGround[k % layer] = Math.floor(k / layer);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const heightfield = () => {
    const h = new Int16Array(layer).fill(-1);
    for (let k = 0; k < grid.length; k++) if (grid[k] && !mats[grid[k]].organic) h[k % layer] = Math.floor(k / layer);
    return h;
  };
  const advance = m => Number(mats[m].decays_to ?? m);
  const frames = [];
  const timeScale = s.stepYears / 100;
  for (let step = 1; step <= s.steps; step++) {
    const before = grid.slice();
    const stats = { solid: 0, originalRemaining: 0, collapsed: 0, weathered: 0, deposited: 0, grown: 0 };
    const heights = heightfield();
    // 1. Exposure: sheltered blocks age much more slowly; height and wind favour roof loss.
    if (s.exposure) for (let k = 0; k < grid.length; k++) {
      const m = before[k]; if (!m || mats[m].ground || mats[m].fixed) continue;
      const [x, y, z] = xyz(k); let faces = 0, wind = 0;
      for (const [dx, dz] of dirs) {
        if (!inside(x + dx, y, z + dz) || !before[key(x + dx, y, z + dz)]) {
          faces++;
          if ((dx < 0 && s.wind.includes('W')) || (dx > 0 && s.wind.includes('E')) || (dz < 0 && s.wind.includes('N')) || (dz > 0 && s.wind.includes('S'))) wind += 0.13;
        }
      }
      const sky = heights[x + z * W] === y;
      const shelter = sky ? 1 : 0.38;
      const elevation = 0.35 + 0.65 * y / H;
      // Spatially coherent weak bands, instead of independent uniform holes.
      const band = 0.7 + 0.3 * Math.sin(x * 0.53 + z * 0.41 + Number(step) * 0.16);
      const exposure = (0.06 + faces * 0.085 + (sky ? 0.45 : 0) + wind) * shelter * elevation * band;
      const probability = 1 - Math.exp(-0.45 * s.weathering * timeScale * exposure / (mats[m].durability ?? 1));
      if (random() < probability) { const next = advance(m); grid[k] = next; if (next !== m) stats.weathered++; }
    }
    // Optional rain particles: walk downhill over the surface, dissolving on impact.
    if (s.water && s.rainfall > 0) {
      const drops = Math.floor(layer * 0.1 * s.rainfall * timeScale);
      for (let i = 0; i < drops; i++) {
        let x = Math.floor(random() * W), z = Math.floor(random() * D);
        for (let hop = 0; hop < 5; hop++) {
          const y = heights[x + z * W]; if (y < 0) break;
          const k = key(x, y, z), m = grid[k];
          if (m && !mats[m].ground && !mats[m].fixed && !mats[m].organic && random() < 0.15 / (mats[m].durability ?? 1)) {
            const next = advance(m); grid[k] = next; if (next !== m) stats.weathered++;
          }
          let dest = null, low = y;
          for (const [dx, dz] of dirs) if (inside(x + dx, 0, z + dz) && heights[x + dx + (z + dz) * W] < low) { low = heights[x + dx + (z + dz) * W]; dest = [x + dx, z + dz]; }
          if (!dest) break; [x, z] = dest;
        }
      }
    }
    // 2. Load-bearing support from the ground, with bounded lateral propagation per course.
    if (s.collapse) {
      const stable = new Uint8Array(grid.length);
      const spanLeft = new Int16Array(grid.length).fill(-1);
      for (let y = 0; y < H; y++) {
        const queue = [];
        for (let c = 0; c < layer; c++) {
          const k = c + y * layer, m = grid[k]; if (!m || mats[m].organic) continue;
          if (mats[m].fluid) continue;
          if (y === 0 || mats[m].ground || mats[m].fixed || stable[k - layer]) {
            stable[k] = 1; spanLeft[k] = mats[m].loose ? 0 : (mats[m].span ?? s.span); queue.push(k);
          }
        }
        for (let q = 0; q < queue.length; q++) {
          const k = queue[q]; if (spanLeft[k] <= 0 || mats[grid[k]].loose) continue;
          const [x, , z] = xyz(k);
          for (const [dx, dz] of dirs) {
            if (!inside(x + dx, y, z + dz)) continue;
            const n = key(x + dx, y, z + dz), m = grid[n];
            if (!m || mats[m].organic || mats[m].loose || mats[m].fluid) continue;
            const remaining = Math.min(spanLeft[k] - 1, mats[m].span ?? s.span);
            if (remaining > spanLeft[n]) { stable[n] = 1; spanLeft[n] = remaining; queue.push(n); }
          }
        }
      }
      // Drop connected unsupported fragments as rigid clusters, then let loose debris settle.
      const seen = new Uint8Array(grid.length);
      for (let k = 0; k < grid.length; k++) {
        if (!grid[k] || stable[k] || seen[k] || mats[grid[k]].organic || mats[grid[k]].fixed) continue;
        const cluster = [k]; seen[k] = 1;
        for (let i = 0; i < cluster.length; i++) {
          const [x, y, z] = xyz(cluster[i]);
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            if (!inside(x + dx, y + dy, z + dz)) continue;
            const n = key(x + dx, y + dy, z + dz);
            if (grid[n] && !stable[n] && !seen[n] && !mats[grid[n]].organic && !mats[grid[n]].fixed) { seen[n] = 1; cluster.push(n); }
          }
        }
        const contents = cluster.map(n => [n, grid[n]]);
        for (const n of cluster) grid[n] = 0;
        let fall = H;
        for (const n of cluster) {
          const [x, y, z] = xyz(n); let d = 0;
          while (y - d > 0 && (!grid[key(x, y - d - 1, z)] || mats[grid[key(x, y - d - 1, z)]].organic)) d++;
          fall = Math.min(fall, d);
        }
        for (const [n, m] of contents) {
          const target = n - fall * layer;
          const next = advance(m);
          const impactRubble = mats[next]?.loose && !mats[next]?.fixed ? next : rubble;
          grid[target] = fall > 1 && impactRubble && !/wood|thatch/i.test(mats[m].name) && random() < 0.8 ? impactRubble : m;
          if (fall) stats.collapsed++;
        }
      }
      for (let y = 1; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
        const k = key(x, y, z), m = grid[k]; if (!m || !mats[m].loose || mats[m].fixed) continue;
        let tx = x, tz = z, ty = y;
        while (ty > 0 && !grid[key(tx, ty - 1, tz)]) ty--;
        // A little talus spreading around the foot of the wall.
        const [dx, dz] = dirs[Math.floor(random() * 4)];
        if (ty > 0 && inside(tx + dx, ty, tz + dz) && !grid[key(tx + dx, ty, tz + dz)] && !grid[key(tx + dx, ty - 1, tz + dz)]) {
          tx += dx; tz += dz; while (ty > 0 && !grid[key(tx, ty - 1, tz)]) ty--;
        }
        if (tx !== x || ty !== y || tz !== z) { grid[k] = 0; grid[key(tx, ty, tz)] = m; stats.collapsed++; }
      }
    }
    // 3. Sediment grows a smooth low apron near the original footprint, never on roofs.
    if (s.sediment && soil && s.sedimentRate > 0) {
      for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
        const c = x + z * W; if (initialGround[c] < 0 || distance[c] > 6) continue;
        const bump = Math.exp(-distance[c] * distance[c] / 16);
        const target = Math.min(H - 1, initialGround[c] + step * timeScale * s.sedimentRate * 0.45 * bump);
        for (let y = initialGround[c] + 1; y <= Math.ceil(target); y++) {
          const k = key(x, y, z);
          if (grid[k] && (mats[grid[k]].fixed || !mats[grid[k]].organic)) continue;
          if (grid[k - layer] && random() < Math.min(1, target - y + 1) * 0.28 * s.sedimentRate * timeScale) { grid[k] = soil; stats.deposited++; }
        }
      }
    }
    // 4. Sky-lit plants and wall-clinging ivy. Decoration is non-load-bearing.
    if (s.overgrowth && s.growthRate > 0) {
      const h = heightfield();
      for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
        const y = h[x + z * W]; if (y < 0 || y >= H - 1 || distance[x + z * W] > 5) continue;
        const k = key(x, y, z), m = grid[k];
        if (mats[m].fluid) continue;
        const chance = s.growthRate * 0.075 * timeScale * (0.5 + step / s.steps) * (mats[m].ground || mats[m].loose ? 1 : 0.55);
        if (!grid[k + layer] && random() < chance) { const plant = mats[m].ground ? grass : moss; if (plant) { grid[k + layer] = plant; stats.grown++; } }
        if (y > initialGround[x + z * W] + 2 && random() < chance * 0.9) {
          const [dx, dz] = dirs[Math.floor(random() * 4)];
          if (!inside(x + dx, y, z + dz)) continue;
          for (let drop = 0; drop < 1 + Math.floor(random() * 4); drop++) {
            const vy = y - drop; if (vy < 1 || !grid[key(x, vy, z)]) break;
            const v = key(x + dx, vy, z + dz); if (grid[v]) break;
            if (vine) { grid[v] = vine; stats.grown++; }
          }
        }
      }
      // Remove plants whose substrate has disappeared in an earlier pass.
      for (let k = 0; k < grid.length; k++) if (grid[k] && mats[grid[k]].organic && !mats[grid[k]].fixed) {
        const [x, y, z] = xyz(k);
        let attached = y > 0 && grid[k - layer] && !mats[grid[k - layer]].organic;
        for (const [dx, dz] of dirs) if (inside(x + dx, y, z + dz)) { const m = grid[key(x + dx, y, z + dz)]; if (m && !mats[m].organic) attached = true; }
        if (!attached) grid[k] = 0;
      }
    }
    const set = [];
    for (let k = 0; k < grid.length; k++) {
      if (grid[k] !== before[k]) set.push([...xyz(k), grid[k]]);
      if (grid[k] && !mats[grid[k]].ground && !mats[grid[k]].fixed && !mats[grid[k]].organic) stats.solid++;
    }
    for (const k of original) if (grid[k] && !mats[grid[k]].ground && !mats[grid[k]].fixed && !mats[grid[k]].organic && !mats[grid[k]].loose) stats.originalRemaining++;
    frames.push({ t: step * s.stepYears, set, stats });
    onProgress(step / s.steps);
  }
  return { structure, step_years: s.stepYears, seed: s.seed, settings: s, frames };
}
