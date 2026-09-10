import { readFile, writeFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('public/examples/manifest.json', 'utf8'));
const project = ([x, y, z]) => [(x - z) * 0.866, (x + z) * 0.5 - y];
const color = (hex, factor) => '#' + hex.slice(1).match(/../g).map(c => Math.min(255, Math.round(parseInt(c, 16) * factor)).toString(16).padStart(2, '0')).join('');
for (const entry of manifest.structures) {
  const { voxels, materials } = JSON.parse(await readFile(`public/${entry.file}`, 'utf8'));
  const occupied = new Set(voxels.map(v => v.slice(0, 3).join(',')));
  const polygons = []; const points = [];
  for (const [x, y, z, id] of voxels.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]))) {
    for (const [neighbor, vertices, shade] of [
      [[x + 1, y, z], [[x+1,y,z],[x+1,y,z+1],[x+1,y+1,z+1],[x+1,y+1,z]], 0.75],
      [[x, y, z + 1], [[x,y,z+1],[x+1,y,z+1],[x+1,y+1,z+1],[x,y+1,z+1]], 0.9],
      [[x, y + 1, z], [[x,y+1,z],[x+1,y+1,z],[x+1,y+1,z+1],[x,y+1,z+1]], 1.12],
    ]) {
      if (occupied.has(neighbor.join(','))) continue;
      const p = vertices.map(project); points.push(...p);
      polygons.push(`<polygon points="${p.map(v => v.map(n => n.toFixed(2)).join(',')).join(' ')}" fill="${color(materials[id].color, shade)}"/>`);
    }
  }
  const minX = Math.min(...points.map(p => p[0])) - 1, minY = Math.min(...points.map(p => p[1])) - 1;
  const width = Math.max(...points.map(p => p[0])) - minX + 1, height = Math.max(...points.map(p => p[1])) - minY + 1;
  await writeFile(`public/examples/${entry.id}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}">${polygons.join('')}</svg>`);
}
