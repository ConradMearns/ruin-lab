import '../style.css';
import './style.css';
import * as THREE from 'three';
import { VoxelViewer } from '../viewer.js';
import { hydrateIcons } from '../icons.js';
import { createDemoRegion } from './demo.js';
import { ROLE, ROLE_COLORS, parseRegion, parseProject, defaultSettings, computeSelection, blockInfo, indexOf, positionOf, inBounds, suggestAir, serializeProject, exportRuiner } from './model.js';

const $ = id => document.getElementById(id);
const number = n => n.toLocaleString('en-US');
let region, settings, overrides = new Map(), selection, viewer, boundsHelper;
let tool = 'inspect', selectedCell = null, airPreview = null, previewSet = new Set(), exportOnly = false;
let undoStack = [], redoStack = [], dirty = false, drawing = false, strokeBefore = null, lastPaint = -1;
let debounce, toastTimer, sliceGeometry;
const canvas = $('slice-canvas'), ctx = canvas.getContext('2d');
const infoCache = new Map();
hydrateIcons();

function notify(text, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = text; $('toast').className = `toast${error ? ' error' : ''}`; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 6500 : 4000);
}
function info(id) { if (!infoCache.has(id)) infoCache.set(id, blockInfo(region.data.palette[id].code)); return infoCache.get(id); }
function state() { return { settings: structuredClone(settings), overrides: [...overrides] }; }
function remember(previous) { undoStack.push(previous); if (undoStack.length > 40) undoStack.shift(); redoStack = []; dirty = true; updateHistory(); }
function updateHistory() { $('undo').disabled = undoStack.length === 0; $('redo').disabled = redoStack.length === 0; }
function clearAirPreview() { airPreview = null; previewSet.clear(); $('air-preview').hidden = true; }
function restore(saved) { settings = structuredClone(saved.settings); overrides = new Map(saved.overrides); clearAirPreview(); writeControls(); recalculate(); dirty = true; updateHistory(); }
function mutate(fn) {
  const previous = state();
  try {
    fn();
    if (JSON.stringify(previous) === JSON.stringify(state())) return;
    clearAirPreview(); recalculate(); remember(previous);
  } catch (error) {
    settings = previous.settings; overrides = new Map(previous.overrides); writeControls(); notify(error.message, true);
  }
}
function recalculate() {
  clearTimeout(debounce);
  selection = computeSelection(region, settings, overrides);
  for (const [id, role] of [['build-count', ROLE.BUILD], ['terrain-count', ROLE.TERRAIN], ['air-count', ROLE.AIR]]) $(id).textContent = number(selection.counts[role]);
  $('locked-count').textContent = number(overrides.size);
  const solids = selection.counts[1] + selection.counts[2];
  $('selection-status').textContent = `${number(solids)} occupied cells selected · ${number(selection.counts[3])} intentional air cells`;
  $('selection-warning').textContent = solids > 150000 ? 'Over the ruiner’s 150,000-voxel limit. Narrow bounds; projects can still be saved.' : 'Automatic suggestions need human review. No per-block provenance is available.';
  $('export-ruiner').disabled = solids === 0 || solids > 150000;
  drawSlice(); render3D(); updateInspector();
}
function writeControls() {
  for (const key of ['sensitivity', 'margin', 'shell', 'foundation']) $(key).value = settings[key];
  for (let a = 0; a < 3; a++) for (const kind of ['min', 'max']) $(`bound-${kind}-${a}`).value = settings.bounds[kind][a];
  updateLabels();
}
function updateLabels() {
  $('sensitivity-value').textContent = Number($('sensitivity').value) > 0.6 ? 'Conservative' : 'Broader clues';
  for (const id of ['margin', 'shell', 'foundation', 'air-reach']) $(`${id}-value`).textContent = `${$(id).value} blocks`;
  $('brush-value').textContent = `${$('brush').value} ${$('brush').value === '1' ? 'cell' : 'cells'}`;
  const axis = Number($('slice-axis').value); $('slice-value').textContent = `${'XYZ'[axis]} = ${$('slice').value}`;
  document.querySelectorAll('input[type=range]').forEach(input => {
    const percent = (input.value - input.min) / (input.max - input.min || 1) * 100;
    input.style.background = `linear-gradient(to right,#9eb583 ${percent}%,#e0e6d5 ${percent}%)`;
  });
}
function makeBoundsControls() {
  $('bounds-controls').replaceChildren();
  for (let a = 0; a < 3; a++) {
    const row = document.createElement('div'); row.className = 'bounds-row';
    const axis = document.createElement('span'); axis.textContent = 'XYZ'[a]; row.appendChild(axis);
    for (const kind of ['min', 'max']) {
      const input = document.createElement('input'); input.type = 'number'; input.id = `bound-${kind}-${a}`; input.min = 0; input.max = region.size[a] - 1; input.step = 1; input.value = settings.bounds[kind][a]; input.setAttribute('aria-label', `${'XYZ'[a]} ${kind} selection bound`);
      input.addEventListener('change', () => mutate(() => { if (!input.value.trim()) throw new Error('Enter a bound.'); settings.bounds[kind][a] = Number(input.value); })); row.appendChild(input);
    }
    $('bounds-controls').appendChild(row);
  }
}
function load(data) {
  // Validate before replacing the current project, so failed imports don't destroy work.
  const parsed = data?.format === 'ruin-lab/vs-extraction-project' ? parseProject(data) : { region: parseRegion(data), settings: null, overrides: new Map() };
  region = parsed.region; settings = parsed.settings || defaultSettings(region); overrides = parsed.overrides;
  undoStack = []; redoStack = []; dirty = false; selectedCell = null; clearAirPreview(); infoCache.clear(); updateHistory();
  $('region-name').textContent = String(region.data.name || 'Untitled region');
  $('source-summary').textContent = `${region.size.join(' × ')} blocks · origin ${region.origin.join(', ')} · ${region.data.source?.gameVersion || 'unknown version'}`;
  const synthetic = region.data.source?.synthetic === true;
  $('source-badge').textContent = synthetic ? 'SYNTHETIC / SAFE TO SHARE' : 'PRIVATE WORLD DATA / LOCAL ONLY'; $('source-badge').classList.toggle('private', !synthetic);
  $('slice-axis').value = '1'; $('slice').max = region.size[1] - 1; $('slice').value = synthetic ? 4 : Math.min(16, region.size[1] - 1);
  $('cutaway').checked = false;
  for (let a = 0; a < 3; a++) { const input = $(`cell-${'xyz'[a]}`); input.max = region.size[a] - 1; input.value = Math.floor(region.size[a] / 2); }
  if (synthetic) { $('cell-x').value = 20; $('cell-y').value = 4; $('cell-z').value = 20; }
  makeBoundsControls(); writeControls(); recalculate(); viewer?.fit();
}

function drawSlice() {
  if (!region) return;
  const rect = canvas.getBoundingClientRect(); const scale = Math.min(devicePixelRatio, 2);
  const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale); ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const axis = Number($('slice-axis').value), slice = Number($('slice').value);
  const axes = axis === 1 ? [0, 2] : axis === 2 ? [0, 1] : [2, 1];
  const cols = region.size[axes[0]], rows = region.size[axes[1]], unit = Math.min((width - 24) / cols, (height - 24) / rows);
  const ox = (width - cols * unit) / 2, oy = (height - rows * unit) / 2;
  sliceGeometry = { axis, slice, axes, cols, rows, unit, ox, oy, flip: axis !== 1 };
  ctx.fillStyle = '#e9eddf'; ctx.fillRect(0, 0, width, height);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const p = [0, 0, 0]; p[axis] = slice; p[axes[0]] = col; p[axes[1]] = axis === 1 ? row : rows - 1 - row;
    const i = indexOf(p, region.size), id = region.solid[i] || region.fluid[i], role = overrides.has(i) && drawing ? overrides.get(i) : selection.roles[i];
    const x = ox + col * unit, y = oy + row * unit;
    ctx.globalAlpha = inBounds(p, settings.bounds) ? 1 : 0.2;
    ctx.fillStyle = id ? info(id).color : '#f8faf1'; ctx.fillRect(x, y, unit, unit);
    if (role && $('overlay').checked) { ctx.globalAlpha *= role === ROLE.AIR ? 0.75 : 0.65; ctx.fillStyle = ROLE_COLORS[role]; ctx.fillRect(x, y, unit, unit); }
    if (previewSet.has(i)) { ctx.globalAlpha = 0.85; ctx.fillStyle = '#b38ccc'; ctx.fillRect(x, y, unit, unit); }
    ctx.globalAlpha = 1;
    if (unit > 4) { ctx.strokeStyle = '#455c3016'; ctx.lineWidth = 0.5; ctx.strokeRect(x, y, unit, unit); }
    if (overrides.has(i) && unit > 5) { ctx.fillStyle = '#324e38'; ctx.fillRect(x + 1, y + 1, Math.max(1, unit * 0.18), Math.max(1, unit * 0.18)); }
    if (i === selectedCell) { ctx.strokeStyle = '#263f2f'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, unit - 2, unit - 2); }
  }
  ctx.globalAlpha = 1; ctx.fillStyle = '#849573'; ctx.font = '8px monospace';
  ctx.fillText(`${'XYZ'[axes[0]]} →`, ox, 9); ctx.fillText(`${'XYZ'[axes[1]]} ${axis === 1 ? '↓' : '↑'}`, Math.max(2, ox - 11), height - 3);
}
function cellAt(event) {
  const g = sliceGeometry; if (!g) return null;
  const r = canvas.getBoundingClientRect(), col = Math.floor((event.clientX - r.left - g.ox) / g.unit), row = Math.floor((event.clientY - r.top - g.oy) / g.unit);
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return null;
  const p = [0, 0, 0]; p[g.axis] = g.slice; p[g.axes[0]] = col; p[g.axes[1]] = g.flip ? g.rows - 1 - row : row;
  return indexOf(p, region.size);
}
function inspect(index) {
  selectedCell = index; const pos = positionOf(index, region.size);
  for (let a = 0; a < 3; a++) $(`cell-${'xyz'[a]}`).value = pos[a];
  updateInspector(); drawSlice();
}
function updateInspector() {
  if (selectedCell === null) { $('cell-code').textContent = 'Choose a cell'; $('cell-position').textContent = 'Click the slice to inspect a block or empty space.'; $('cell-role').textContent = ''; $('cell-fluid').textContent = ''; return; }
  const p = positionOf(selectedCell, region.size), solid = region.solid[selectedCell], fluid = region.fluid[selectedCell];
  $('cell-code').textContent = region.data.palette[solid].code;
  $('cell-position').textContent = `Local ${p.join(', ')} · World ${p.map((n, a) => n + region.origin[a]).join(', ')}`;
  $('cell-role').textContent = `${['Unselected', 'Construction', 'Terrain context', 'Intentional air'][selection.roles[selectedCell]]}${overrides.has(selectedCell) ? ' · manually locked' : ' · automatic'}`;
  $('cell-fluid').textContent = fluid ? `Fluid layer: ${region.data.palette[fluid].code}` : 'Fluid layer: empty';
}
function paint(index) {
  if (index === null || index === lastPaint) return; lastPaint = index;
  const center = positionOf(index, region.size), axis = Number($('slice-axis').value), axes = axis === 1 ? [0, 2] : axis === 2 ? [0, 1] : [2, 1];
  const radius = (Number($('brush').value) - 1) / 2;
  for (let a = -radius; a <= radius; a++) for (let b = -radius; b <= radius; b++) {
    const p = [...center]; p[axes[0]] += a; p[axes[1]] += b;
    if (!inBounds(p, settings.bounds) || p.some((n, k) => n < 0 || n >= region.size[k])) continue;
    const i = indexOf(p, region.size), occupied = region.solid[i] || region.fluid[i];
    if (tool === 'auto') overrides.delete(i);
    else {
      const role = Number(tool);
      if ((role === ROLE.AIR && occupied) || ([ROLE.BUILD, ROLE.TERRAIN].includes(role) && !occupied)) continue;
      overrides.set(i, role);
    }
  }
  inspect(index);
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const i = cellAt(event); if (i === null) return;
  if (tool === 'inspect') { inspect(i); return; }
  event.preventDefault(); clearAirPreview(); drawing = true; strokeBefore = state(); lastPaint = -1; canvas.setPointerCapture(event.pointerId); paint(i);
});
canvas.addEventListener('pointermove', event => { if (drawing) paint(cellAt(event)); });
function finishStroke() {
  if (!drawing) return;
  drawing = false; if (JSON.stringify(strokeBefore.overrides) !== JSON.stringify([...overrides])) remember(strokeBefore);
  strokeBefore = null; recalculate();
}
canvas.addEventListener('pointerup', finishStroke); canvas.addEventListener('pointercancel', finishStroke);
new ResizeObserver(() => drawSlice()).observe(canvas.parentElement);

function render3D() {
  if (!viewer || !region) return;
  const [W, H, D] = region.size, axis = Number($('slice-axis').value), level = Number($('slice').value), cut = $('cutaway').checked, overlay = $('overlay').checked;
  const visible = new Uint8Array(region.volume);
  for (let i = 0; i < region.volume; i++) {
    if (cut && positionOf(i, region.size)[axis] > level) continue;
    if (exportOnly && !selection.roles[i]) continue;
    if (region.solid[i] || region.fluid[i] || selection.roles[i] === ROLE.AIR) visible[i] = 1;
  }
  const materials = { 0: { name: 'air' } }, mapping = new Map(), voxels = [];
  const category = i => selection.roles[i];
  for (let i = 0; i < region.volume; i++) {
    if (!visible[i]) continue;
    const p = positionOf(i, region.size), [x, y, z] = p, role = selection.roles[i], id = region.solid[i] || region.fluid[i];
    const ns = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, z > 0 ? i - W : -1, z < D - 1 ? i + W : -1, y > 0 ? i - W * D : -1, y < H - 1 ? i + W * D : -1];
    // Cull fully enclosed voxels, but retain surfaces at classification boundaries for ghosting.
    if (ns.every(n => n >= 0 && visible[n] && category(n) === role)) continue;
    const key = `${id}:${role}`;
    if (!mapping.has(key)) {
      const m = Object.keys(materials).length, ghost = role === ROLE.NONE;
      materials[m] = { name: role === ROLE.AIR ? 'selected air' : info(id).name,
        color: overlay && role ? ROLE_COLORS[role] : id ? info(id).color : ROLE_COLORS[3],
        previewOpacity: ghost ? 0.13 : role === ROLE.AIR ? 0.36 : region.fluid[i] && !region.solid[i] ? 0.65 : 1,
        ...(role === ROLE.AIR ? { previewScale: 0.91 } : {}) };
      mapping.set(key, m);
    }
    voxels.push([...p, mapping.get(key)]);
  }
  viewer.setStructure({ size: region.size, materials, voxels }, voxels);
  if (boundsHelper) { viewer.scene.remove(boundsHelper); boundsHelper.geometry.dispose(); boundsHelper.material.dispose(); }
  const min = settings.bounds.min, max = settings.bounds.max;
  boundsHelper = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(min[0] - W / 2, min[1] - 0.5, min[2] - D / 2), new THREE.Vector3(max[0] - W / 2 + 1, max[1] + 0.5, max[2] - D / 2 + 1)), '#a5b48e');
  boundsHelper.material.transparent = true; boundsHelper.material.opacity = 0.45; viewer.scene.add(boundsHelper); viewer.invalidate();
  $('viewport-note').textContent = exportOnly ? 'Only selected cells. Air is shown in translucent blue.' : 'Unselected surroundings are ghosted. The box is the hard selection limit.';
}

function downloadJSON(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const stem = () => String(region.data.name || 'extraction').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 70);
const canReplace = () => !dirty || confirm('You have unsaved selection changes. Replace this project?');
$('load-region').addEventListener('click', () => $('region-file').click());
$('region-file').addEventListener('change', async () => {
  const file = $('region-file').files[0]; if (!file) return;
  try { if (file.size > 50000000) throw new Error('Maximum JSON file size is 50 MB.'); const data = JSON.parse(await file.text()); if (canReplace()) { load(data); notify('Region opened locally. Review the construction suggestions and bounds.'); } }
  catch (error) { notify(`Could not open file: ${error.message}`, true); }
  $('region-file').value = '';
});
$('load-demo').addEventListener('click', () => { if (canReplace()) load(createDemoRegion()); });
$('reset-bounds').addEventListener('click', () => mutate(() => { settings.bounds = defaultSettings(region).bounds; writeControls(); }));
for (const id of ['sensitivity', 'margin', 'shell', 'foundation']) {
  $(id).addEventListener('input', updateLabels);
  $(id).addEventListener('change', () => mutate(() => { settings[id] = Number($(id).value); }));
}
for (const id of ['brush', 'air-reach']) $(id).addEventListener('input', () => { updateLabels(); if (id === 'air-reach') { clearAirPreview(); drawSlice(); } });
$('slice-axis').addEventListener('change', () => { const axis = Number($('slice-axis').value); $('slice').max = region.size[axis] - 1; $('slice').value = selectedCell === null ? Math.floor(region.size[axis] / 2) : positionOf(selectedCell, region.size)[axis]; updateLabels(); drawSlice(); render3D(); });
$('slice').addEventListener('input', () => { updateLabels(); drawSlice(); if ($('cutaway').checked) { clearTimeout(debounce); debounce = setTimeout(render3D, 100); } });
for (const [id, delta] of [['slice-down', -1], ['slice-up', 1]]) $(id).addEventListener('click', () => { $('slice').value = Math.max(0, Math.min(Number($('slice').max), Number($('slice').value) + delta)); updateLabels(); drawSlice(); if ($('cutaway').checked) render3D(); });
$('cutaway').addEventListener('change', render3D);
$('overlay').addEventListener('change', () => { drawSlice(); render3D(); });
for (const [id, value] of [['show-context', false], ['show-export', true]]) $(id).addEventListener('click', () => { exportOnly = value; $('show-context').classList.toggle('active', !value); $('show-export').classList.toggle('active', value); render3D(); });
$('fit').addEventListener('click', () => viewer?.fit()); $('top-view').addEventListener('click', () => viewer?.fit('top'));
document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => { tool = button.dataset.tool; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b === button)); }));
$('undo').addEventListener('click', () => { if (undoStack.length) { redoStack.push(state()); restore(undoStack.pop()); } });
$('redo').addEventListener('click', () => { if (redoStack.length) { undoStack.push(state()); restore(redoStack.pop()); } });
$('inspect-coordinate').addEventListener('click', () => {
  const pos = [...'xyz'].map(a => Number($(`cell-${a}`).value));
  if (pos.some((n, a) => !Number.isInteger(n) || n < 0 || n >= region.size[a])) { notify('Coordinates must be inside the loaded region.', true); return; }
  $('slice').value = pos[Number($('slice-axis').value)]; updateLabels(); inspect(indexOf(pos, region.size)); if ($('cutaway').checked) render3D();
});
$('suggest-air').addEventListener('click', () => {
  try {
    if (selectedCell === null) throw new Error('Inspect a dry-air cell on the slice first.');
    airPreview = suggestAir(region, selectedCell, settings.bounds, Number($('air-reach').value)); previewSet = new Set(airPreview.cells);
    $('air-warning').textContent = `${number(airPreview.cells.length)} cells (purple). ${airPreview.warning}`; $('air-preview').hidden = false; drawSlice();
  } catch (error) { notify(error.message, true); }
});
$('accept-air').addEventListener('click', () => { if (!airPreview) return; const cells = airPreview.cells.filter(i => !overrides.has(i)); mutate(() => { for (const i of cells) overrides.set(i, ROLE.AIR); }); notify(`${number(cells.length)} empty cells marked. Existing manual locks were preserved.`); });
$('cancel-air').addEventListener('click', () => { clearAirPreview(); drawSlice(); });
$('save-project').addEventListener('click', () => { try { downloadJSON(serializeProject(region, settings, overrides), `${stem()}.vsproject.json`); dirty = false; notify('Project saved with full region data and editable selection. Keep it private.'); } catch (error) { notify(error.message, true); } });
$('export-ruiner').addEventListener('click', () => { try { const result = exportRuiner(region, selection.roles); downloadJSON(result, `${stem()}.ruiner.json`); notify('Simulation snapshot exported. Import it in the Observatory; keep the full project too.'); } catch (error) { notify(error.message, true); } });
$('help').addEventListener('click', () => $('studio-help').showModal()); $('close-help').addEventListener('click', () => $('studio-help').close());
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
try { viewer = new VoxelViewer($('studio-viewer')); viewer.onError = text => notify(text, true); } catch { $('webgl-error').hidden = false; }
load(createDemoRegion());
