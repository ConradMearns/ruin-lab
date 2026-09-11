import { encodeRLE } from './model.js';

/** Entirely synthetic; no player save data is distributed with the demo. */
export function createDemoRegion() {
  const size = [40, 30, 40], [W, H, D] = size;
  const solid = new Uint32Array(W * H * D), fluid = new Uint32Array(solid.length);
  const set = (x, y, z, id) => { solid[(y * D + z) * W + x] = id; };
  const box = (x1, y1, z1, x2, y2, z2, id) => { for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) set(x, y, z, id); };
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const h = Math.min(23, 5 + Math.floor(Math.max(0, 23 - z) * 0.72 + Math.sin(x * 0.18) * 1.3));
    for (let y = 0; y <= h; y++) set(x, y, z, y === h ? 2 : 1);
  }
  // Rectangular house with its back wall and cellar sunk into the hillside.
  box(13, 6, 17, 27, 12, 29, 3); box(14, 7, 18, 26, 11, 28, 0);
  box(14, 12, 18, 26, 12, 28, 4);
  box(15, 3, 15, 24, 5, 24, 0); // Cellar remains natural sandstone, including its carved shell.
  box(19, 6, 22, 21, 6, 24, 0);
  for (let y = 6; y <= 9; y++) box(19, y, 23 + y - 6, 21, y, 23 + y - 6, 4);
  box(19, 7, 29, 21, 9, 29, 0); box(20, 7, 29, 20, 8, 29, 6);
  for (const x of [16, 24]) box(x, 9, 29, x + 1, 10, 29, 7);
  for (const z of [21, 25]) box(27, 9, z, 27, 10, z + 1, 7);
  for (let x = 12; x <= 28; x++) {
    const y = 12 + Math.min(x - 12, 28 - x);
    box(x, y, 16, x, y, 30, 5);
    if (y > 13) { box(x, 13, 17, x, y - 1, 17, 4); box(x, 13, 29, x, y - 1, 29, 4); }
  }
  box(25, 12, 18, 26, 21, 19, 3);
  box(15, 3, 17, 16, 3, 17, 8); box(15, 7, 20, 16, 7, 20, 8);
  for (let x = 4; x < 11; x++) for (let z = 28; z < 34; z++) set(x, 6, z, 9);
  for (let z = 27; z < 39; z++) for (let x = 1; x < 4; x++) fluid[(6 * D + z) * W + x] = 10;
  // Nearby cave demonstrates why connected-air fill must be bounded and reviewed.
  box(3, 3, 4, 9, 5, 11, 0);
  const palette = {
    0: { code: 'game:air' }, 1: { code: 'game:rock-sandstone' }, 2: { code: 'game:soil-medium-normal' },
    3: { code: 'game:cobblestone-sandstone' }, 4: { code: 'game:planks-oak' },
    5: { code: 'game:slantedroofing-slate-east-free' }, 6: { code: 'game:door-oak' },
    7: { code: 'game:glass-clear' }, 8: { code: 'game:chest-oak' }, 9: { code: 'game:farmland-moist-medium' }, 10: { code: 'game:water-still-7' },
  };
  return { format: 'ruin-lab/vs-region', version: 1, name: 'Sandstone hillside / demonstration', origin: [0, 0, 0], size, axisOrder: 'xzy', palette,
    layers: { solid: encodeRLE(solid), fluid: encodeRLE(fluid) }, source: { synthetic: true, gameVersion: 'Synthetic example' }, sourceChunks: [],
    warnings: ['Synthetic region, not extracted from a player save.', 'The cellar is at local X 15–24, Y 3–5, Z 15–24.'] };
}
