import { mkdir, writeFile } from 'node:fs/promises';

const materials = {
  0: { name: 'air' },
  1: { name: 'stone', color: '#a5aaa1', durability: 1, decays_to: '6' },
  2: { name: 'wood', color: '#8b6748', durability: 0.28, decays_to: '7', span: 5 },
  3: { name: 'rubble', color: '#777e70', durability: 0.65, decays_to: '0', loose: true },
  4: { name: 'thatch', color: '#b5a572', durability: 0.1, decays_to: '0', span: 5 },
  5: { name: 'soil', color: '#646651', durability: 2, ground: true },
  6: { name: 'cracked stone', color: '#8b9185', durability: 0.75, decays_to: '3' },
  7: { name: 'rotten wood', color: '#65634a', durability: 0.13, decays_to: '0', span: 2 },
  8: { name: 'dressed stone', color: '#c1c1af', durability: 1.25, decays_to: '6' },
};

function builder(size) {
  const map = new Map();
  const put = (x, y, z, m = 1) => {
    if (x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2]) throw new Error('Out of bounds');
    const key = `${x},${y},${z}`;
    if (m) map.set(key, [x, y, z, m]); else map.delete(key);
  };
  const box = (x1, y1, z1, x2, y2, z2, m = 1) => {
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) put(x, y, z, m);
  };
  const walls = (x1, y1, z1, x2, y2, z2, m = 1) => {
    box(x1, y1, z1, x2, y2, z1, m); box(x1, y1, z2, x2, y2, z2, m);
    box(x1, y1, z1, x1, y2, z2, m); box(x2, y1, z1, x2, y2, z2, m);
  };
  // A bevelled, one-voxel terrain tile leaves space for the rubble apron.
  for (let x = 0; x < size[0]; x++) for (let z = 0; z < size[2]; z++) {
    if ((x < 2 || x > size[0] - 3) && (z < 2 || z > size[2] - 3)) continue;
    put(x, 0, z, 5);
  }
  return { put, box, walls, result: () => ({ version: 1, size, materials, voxels: [...map.values()].sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]) }) };
}

function tower() {
  const b = builder([28, 27, 28]); const { put, box, walls } = b;
  box(7, 1, 7, 20, 1, 20, 8);
  walls(8, 2, 8, 19, 20, 19);
  // Deep corner quoins and continuous string courses.
  for (const x of [8, 18]) for (const z of [8, 18]) box(x, 2, z, x + 1, 20, z + 1, 8);
  for (const y of [7, 14, 20]) walls(7, y, 7, 20, y, 20, 8);
  for (const y of [6, 13, 19]) box(9, y, 9, 18, y, 18, 2);
  // Arrow slits, widening to paired arched windows on the upper floor.
  for (const y of [9, 16]) for (const x of [11, 16]) {
    box(x, y, 8, x, y + 2, 8, 0); box(x, y, 19, x, y + 2, 19, 0);
    box(8, y, x, 8, y + 2, x, 0); box(19, y, x, 19, y + 2, x, 0);
    put(x, y - 1, 7, 8); put(20, y - 1, x, 8);
  }
  walls(8, 21, 8, 19, 21, 19, 8);
  for (let i = 8; i <= 19; i++) if ((i - 8) % 3 !== 2) {
    box(i, 22, 8, i, 23, 8, 8); box(i, 22, 19, i, 23, 19, 8);
    box(8, 22, i, 8, 23, i, 8); box(19, 22, i, 19, 23, i, 8);
  }
  box(12, 2, 19, 15, 5, 19, 0); box(13, 6, 19, 14, 6, 19, 0);
  for (let z = 20; z <= 23; z++) box(12, 1, z, 15, 1, z, 8);
  box(12, 2, 20, 15, 2, 20, 8);
  // Timber door and a little lean-to at the side.
  box(12, 2, 18, 15, 5, 18, 2);
  box(4, 1, 10, 7, 1, 17, 8);
  for (const z of [10, 17]) box(4, 2, z, 4, 5, z, 2);
  for (let x = 3; x < 8; x++) box(x, 5 + Math.floor((x - 3) / 2), 9, x, 5 + Math.floor((x - 3) / 2), 18, 2);
  // Low enclosing wall, piers, and a broken-up paved approach.
  walls(4, 1, 4, 23, 2, 23);
  box(11, 1, 23, 16, 2, 23, 0);
  for (const x of [4, 23]) for (const z of [4, 23]) box(x, 1, z, x, 3, z, 8);
  return b.result();
}

function chapel() {
  const b = builder([30, 25, 32]); const { box, walls, put } = b;
  box(7, 1, 6, 22, 1, 26, 8); walls(8, 2, 7, 21, 10, 25);
  for (const x of [8, 21]) for (const z of [7, 13, 19, 25]) {
    box(x === 8 ? 7 : 22, 2, z, x === 8 ? 7 : 22, 7, z, 8);
  }
  for (const z of [11, 17, 22]) for (const x of [8, 21]) box(x, 5, z, x, 8, z + 1, 0);
  box(13, 2, 25, 16, 6, 25, 0); box(14, 7, 25, 15, 7, 25, 0);
  for (let y = 11; y <= 16; y++) {
    const inset = y - 10;
    box(8 + inset, y, 7, 21 - inset, y, 7, 8); box(8 + inset, y, 25, 21 - inset, y, 25, 8);
  }
  for (let x = 7; x <= 22; x++) {
    const y = 10 + Math.min(x - 7, 22 - x);
    box(x, y, 6, x, y, 26, 4);
    for (const z of [6, 13, 20, 26]) put(x, y, z, 2);
  }
  // A small square bell tower at the far end.
  walls(11, 2, 5, 18, 19, 11, 8);
  for (const z of [5, 11]) box(13, 16, z, 16, 18, z, 0);
  for (const x of [11, 18]) box(x, 16, 7, x, 18, 9, 0);
  box(10, 20, 4, 19, 20, 12, 8);
  for (let y = 21; y <= 24; y++) box(11 + y - 21, y, 5 + y - 21, 18 - (y - 21), y, 11 - (y - 21), 2);
  box(13, 1, 26, 16, 1, 29, 8);
  return b.result();
}

function villa() {
  const b = builder([32, 18, 30]); const { box, walls } = b;
  box(4, 1, 4, 27, 1, 25, 8); box(10, 1, 10, 21, 1, 19, 5);
  walls(5, 2, 5, 26, 8, 24);
  box(14, 2, 24, 17, 5, 24, 0); box(15, 6, 24, 16, 6, 24, 0);
  for (const x of [9, 14, 20, 24]) box(x, 4, 5, x + 1, 6, 5, 0);
  for (const z of [9, 15, 20]) for (const x of [5, 26]) box(x, 4, z, x, 6, z + 1, 0);
  for (const x of [10, 15, 21]) for (const z of [10, 19]) {
    box(x, 2, z, x, 7, z, 8); box(x - 1, 2, z - 1, x + 1, 2, z + 1, 8); box(x - 1, 7, z - 1, x + 1, 7, z + 1, 8);
  }
  walls(10, 8, 10, 21, 8, 19, 8);
  for (let x = 4; x <= 27; x++) for (let z = 4; z <= 25; z++) {
    if (x > 10 && x < 21 && z > 10 && z < 19) continue;
    const d = Math.min(x - 4, 27 - x, z - 4, 25 - z);
    b.put(x, 9 + Math.min(d, 2), z, 2);
  }
  // Courtyard reflecting pool, with a raised stone rim.
  walls(13, 2, 13, 18, 2, 16, 8); box(14, 1, 14, 17, 1, 15, 3);
  return b.result();
}

function cottage() {
  const b = builder([26, 19, 26]); const { box, walls, put } = b;
  box(6, 1, 7, 19, 1, 19, 8); walls(7, 2, 8, 18, 4, 18);
  walls(7, 5, 8, 18, 8, 18, 2);
  for (const x of [7, 12, 18]) for (const z of [8, 18]) box(x, 2, z, x, 8, z, 2);
  for (const x of [7, 18]) box(x, 5, 11, x, 6, 13, 0);
  box(11, 2, 18, 13, 6, 18, 0); box(11, 2, 17, 13, 5, 17, 2);
  for (let x = 6; x <= 19; x++) {
    const y = 8 + Math.min(x - 6, 19 - x);
    box(x, y, 6, x, y, 20, 4);
    for (const z of [7, 14, 19]) put(x, y, z, 2);
    if (x > 7 && x < 18) for (const z of [8, 18]) box(x, 9, z, x, Math.max(9, y - 1), z, 2);
  }
  box(16, 2, 9, 18, 16, 11, 8); box(17, 16, 10, 17, 16, 10, 0);
  for (const z of [20, 23]) for (let x = 4; x <= 8; x++) {
    if (x % 2 === 0) box(x, 1, z, x, 3, z, 2); put(x, 2, z, 2);
  }
  box(11, 1, 19, 13, 1, 23, 8);
  return b.result();
}

const entries = [
  ['coastal-watchtower', 'Coastal watchtower', '12th century · Military', 'A limestone sentinel, timber floors and a sheltered lean-to. Built to outlast its keepers.', tower, ['Stone', 'Timber']],
  ['hillside-chapel', 'Hillside chapel', '13th century · Sacred', 'A thatched nave and a stone bell tower. Watch the roof give way to an open sky.', chapel, ['Stone', 'Thatch']],
  ['courtyard-villa', 'Courtyard villa', '2nd century · Domestic', 'A colonnaded courtyard wrapped in timber galleries. Long spans, quiet gardens.', villa, ['Columns', 'Timber']],
  ['forest-cottage', 'Forest cottage', '15th century · Vernacular', 'Timber walls on a low stone footing, beneath a steep thatched roof.', cottage, ['Timber', 'Thatch']],
];
await mkdir('public/examples', { recursive: true });
const structures = [];
for (const [id, name, period, description, generate, tags] of entries) {
  const data = generate();
  await writeFile(`public/examples/${id}.json`, JSON.stringify(data));
  structures.push({ id, name, period, description, file: `examples/${id}.json`, tags, dimensions: data.size, voxelCount: data.voxels.length });
  console.log(id, data.size, data.voxels.length);
}
await writeFile('public/examples/manifest.json', JSON.stringify({ structures }, null, 2));
