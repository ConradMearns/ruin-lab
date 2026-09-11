import './style.css';
import './floor-controls.css';
import { icon, hydrateIcons } from './icons.js';
import { VoxelViewer } from './viewer.js';
import { DEFAULTS } from './engine.js';
import { openMaterialEditor } from './material-editor.js';
import { parseStructure, parseTimelapse, replayFrame } from './schema.js';

const $ = id => document.getElementById(id);
const base = import.meta.env.BASE_URL;
const escapeHTML = str => String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = n => n.toLocaleString('en-US');
const passKeys = ['exposure', 'collapse', 'sediment', 'overgrowth', 'water'];
const numberKeys = ['weathering', 'sedimentRate', 'growthRate', 'rainfall', 'span', 'steps', 'stepYears'];
let viewer, manifest = [], original, timelapse, currentVoxels = [], frame = 0, playing = null, worker = null, loadVersion = 0, busy = false, activeName = 'Coastal watchtower', activeId = 'coastal-watchtower';
let toastTimer, pendingLoad = null;
hydrateIcons();

function toast(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').className = `toast${error ? ' error' : ''}`; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 7000 : 4000);
}
function setBusy(value, label) {
  busy = value;
  $('simulate-button').disabled = value || !original;
  $('materials-button').disabled = value || !original;
  $('export-button').disabled = value || !timelapse;
  $('export-structure').disabled = value || !original;
  $('play-button').disabled = value || !timelapse?.frames.length;
  $('timeline').disabled = value || !timelapse;
  if (label) $('simulation-summary').textContent = label;
}
function updateRange(input) {
  const range = Number(input.max) - Number(input.min);
  const percent = range > 0 ? (Number(input.value) - Number(input.min)) / range * 100 : 0;
  input.style.background = `linear-gradient(to right, #9eb583 ${percent}%, #e0e6d5 ${percent}%)`;
}
function readSettings() {
  const settings = {};
  for (const key of passKeys) settings[key] = $(key).checked;
  for (const key of numberKeys) settings[key] = Number($(key).value);
  settings.seed = $('seed').value || '1847'; settings.wind = $('wind').value;
  return settings;
}
function writeSettings(settings) {
  for (const key of passKeys) if (typeof settings[key] === 'boolean') $(key).checked = settings[key];
  for (const key of [...numberKeys, 'seed', 'wind']) if (settings[key] !== undefined) {
    const el = $(key);
    if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === String(settings[key]))) continue;
    el.value = settings[key];
  }
  updateSettingsUI();
}
function updateSettingsUI(markDirty = false) {
  $('weathering-value').textContent = `${Number($('weathering').value).toFixed(1)}×`;
  $('rainfall-value').textContent = `${Number($('rainfall').value).toFixed(1)}×`;
  const descriptor = v => Number(v) === 0 ? 'None' : Number(v) < 0.5 ? 'Low' : Number(v) <= 0.9 ? 'Balanced' : 'Abundant';
  $('sedimentRate-value').textContent = descriptor($('sedimentRate').value);
  $('growthRate-value').textContent = descriptor($('growthRate').value);
  $('rainfall-control').hidden = !$('water').checked;
  for (const key of passKeys) $(key).closest('.pass').classList.toggle('disabled', !$(key).checked);
  document.querySelectorAll('.settings-panel input[type=range]').forEach(updateRange);
  const years = Number($('steps').value) * Number($('stepYears').value);
  if (!busy) $('simulation-summary').textContent = markDirty ? 'Conditions changed. Simulate to apply.' : `${years % 100 === 0 ? `${years / 100} centuries` : `${number(years)} years`}. One possible future.`;
}
function stopPlayback() {
  clearInterval(playing); playing = null; $('play-button').innerHTML = icon('play'); $('play-button').title = 'Play timelapse'; $('play-button').setAttribute('aria-label', 'Play timelapse');
}
function play() {
  if (!timelapse || !timelapse.frames.length || busy) return;
  if (playing) { stopPlayback(); return; }
  if (frame >= timelapse.frames.length) setFrame(0);
  $('play-button').innerHTML = icon('pause'); $('play-button').title = 'Pause timelapse'; $('play-button').setAttribute('aria-label', 'Pause timelapse');
  playing = setInterval(() => { setFrame(frame + 1); if (frame >= timelapse.frames.length) stopPlayback(); }, Number($('playback-speed').value));
}
function configureTimeline() {
  const frames = timelapse?.frames || [];
  $('timeline').max = frames.length;
  $('frame-count').textContent = `${frames.length} KEYFRAMES`;
  $('step-label').textContent = `${timelapse?.step_years || 100} years / step`;
  const ticks = []; const count = Math.min(6, frames.length);
  for (let i = 0; i <= count; i++) {
    const index = count ? Math.round(i / count * frames.length) : 0;
    const t = index === 0 ? 0 : frames[index - 1].t;
    ticks.push(`<span>${number(t)}</span>`);
  }
  $('timeline-ticks').innerHTML = ticks.join('');
}
function setFrame(index, reset = false) {
  if (!timelapse) return;
  frame = Math.max(0, Math.min(index, timelapse.frames.length));
  const current = frame ? timelapse.frames[frame - 1] : null;
  currentVoxels = replayFrame(timelapse.structure, timelapse.frames, frame);
  viewer?.setStructure(timelapse.structure, currentVoxels, reset);
  $('timeline').value = frame;
  updateRange($('timeline'));
  $('current-year').textContent = number(current?.t || 0);
  $('timeline').setAttribute('aria-valuetext', `${current?.t || 0} years, frame ${frame}`);
  const label = !frame ? 'Original structure' : `Year ${number(current.t)}`;
  $('view-status').textContent = label;
  const changed = current ? current.set.length : 0;
  $('patch-count').textContent = frame ? `${number(changed)} updates this step` : 'No changes yet';
  const progress = frame / (timelapse.frames.length || 1);
  $('phase-label').textContent = !frame ? 'Before the elements' : progress < 0.3 ? 'The first traces of time' : progress < 0.65 ? 'A changing silhouette' : progress < 1 ? 'Returning to the earth' : 'One possible future';
}
function cancelSimulation() { if (worker) { worker.terminate(); worker = null; } stopPlayback(); }
function runSimulation({ keepOriginal = false, silent = false } = {}) {
  if (!original) return;
  cancelSimulation();
  setBusy(true, 'Reading the weather…');
  const settings = readSettings();
  const start = performance.now();
  try { worker = new Worker(new URL('./simulation.worker.js', import.meta.url), { type: 'module' }); }
  catch (error) { setBusy(false); toast(`Could not start simulation: ${error.message}`, true); return; }
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') { $('simulation-summary').textContent = `Simulating… ${Math.round(data.progress * 100)}%`; return; }
    if (data.type === 'error') { worker?.terminate(); worker = null; setBusy(false); toast(data.message, true); return; }
    if (data.type === 'complete') {
      timelapse = data.result; worker?.terminate(); worker = null;
      configureTimeline(); setFrame(keepOriginal ? 0 : timelapse.frames.length);
      setBusy(false); updateSettingsUI();
      $('simulation-summary').textContent = `${timelapse.frames.length} keyframes · ${((performance.now() - start) / 1000).toFixed(2)}s · seed ${settings.seed}`;
      if (!silent) toast(`${number(settings.steps * settings.stepYears)} years, simulated. Scrub the timeline to explore.`);
    }
  };
  worker.onerror = error => { error.preventDefault(); worker?.terminate(); worker = null; setBusy(false); toast('The simulation worker failed. Try a smaller structure or reload the page.', true); };
  worker.postMessage({ structure: original, settings });
}
function renderLibrary() {
  $('structure-list').innerHTML = manifest.map((entry, i) => `<button class="structure-card ${entry.id === activeId ? 'selected' : ''}" data-id="${escapeHTML(entry.id)}" aria-pressed="${entry.id === activeId}" title="${escapeHTML(entry.description)}"><img class="structure-thumb" src="${base}examples/${encodeURIComponent(entry.id)}.svg" alt="" /><span class="card-content"><span class="card-name">${escapeHTML(entry.name)}</span><span class="card-meta">${entry.dimensions.join(' × ')} <span>·</span> ${number(entry.voxelCount)} voxels</span><span class="card-tags">${entry.tags.map(t => `<span>${escapeHTML(t)}</span>`).join('')}</span></span>${entry.id === activeId ? `<span class="card-check">${icon('check')}</span>` : ''}</button>`).join('');
  $('library-count').textContent = String(manifest.length).padStart(2, '0');
  $('structure-list').querySelectorAll('button').forEach(button => button.addEventListener('click', () => loadExample(button.dataset.id)));
}
function updateFloorHeight() {
  const height = Number($('floor-height').value);
  $('floor-height-value').textContent = `Y = ${height}`;
  $('floor-height').setAttribute('aria-valuetext', `${height} voxels above the model origin`);
  updateRange($('floor-height'));
  viewer?.setFloorHeight(height);
}
function updateSpecimen({ name, period = 'Imported structure · Custom', id = null }) {
  activeName = name; activeId = id;
  $('floor-height').min = -Math.max(...original.size);
  $('floor-height').max = original.size[1];
  $('floor-height').value = 0;
  updateFloorHeight();
  $('structure-name').textContent = name; $('structure-period').textContent = period;
  const index = manifest.findIndex(entry => entry.id === id);
  $('specimen-number').textContent = index >= 0 ? String(index + 1).padStart(2, '0') : '＋';
  $('dimensions').textContent = original.size.join(' × ');
  renderLibrary();
}
async function fetchJSON(url, signal) {
  const response = await fetch(url, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`The server returned ${response.status}. Check the JSON URL.`);
  if (Number(response.headers.get('content-length')) > 50000000) throw new Error('This file is too large (maximum 50 MB).');
  // Stream with a hard cap, including responses without Content-Length.
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 50000000) { await reader.cancel(); throw new Error('This file is too large (maximum 50 MB).'); } chunks.push(value); }
  const buffer = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); } catch { throw new Error('The server did not return valid JSON.'); }
}
async function loadExample(id) {
  const entry = manifest.find(e => e.id === id); if (!entry) return;
  const version = ++loadVersion; pendingLoad?.abort(); pendingLoad = new AbortController();
  cancelSimulation(); setBusy(true, 'Loading specimen…'); $('viewer-loading').hidden = false;
  try {
    const exampleURL = new URL(entry.file, new URL(base, window.location.href));
    const data = await fetchJSON(exampleURL.href, AbortSignal.any([pendingLoad.signal, AbortSignal.timeout(20000)]));
    if (version !== loadVersion) return;
    original = parseStructure(data);
    timelapse = { structure: original, step_years: readSettings().stepYears, frames: [] };
    updateSpecimen(entry); configureTimeline(); setFrame(0, true); selectViewButton('orbit');
    $('viewer-loading').hidden = !!viewer;
    runSimulation({ keepOriginal: true, silent: true });
  } catch (error) {
    if (version !== loadVersion) return;
    $('viewer-loading').hidden = true; setBusy(false); toast(`Could not load the structure. ${error.message}`, true);
  }
}
function importData(data, name) {
  const imported = data?.structure ? parseTimelapse(data) : null;
  const structure = imported ? imported.structure : parseStructure(data);
  ++loadVersion; pendingLoad?.abort(); cancelSimulation();
  original = structure; timelapse = imported || { structure, step_years: readSettings().stepYears, frames: [] };
  updateSpecimen({ name });
  configureTimeline(); setFrame(0, true); selectViewButton('orbit'); $('viewer-loading').hidden = !!viewer;
  if (imported) {
    if (imported.settings && typeof imported.settings === 'object') writeSettings(imported.settings);
    if (imported.seed !== undefined) $('seed').value = String(imported.seed).slice(0, 32);
    $('climate').value = 'custom';
    setBusy(false); $('simulation-summary').textContent = `${imported.frames.length} imported keyframes. Ready to explore.`;
    toast('Timelapse imported. Press play to explore its history.');
  } else { runSimulation({ keepOriginal: true, silent: true }); toast('Structure imported. A possible history is being generated.'); }
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const fileName = () => activeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'structure';
function downloadJSON(data, filename) { download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename); }
function selectViewButton(mode) { $('orbit-button').classList.toggle('active', mode === 'orbit'); $('top-button').classList.toggle('active', mode === 'top'); }

$('materials-button').addEventListener('click', () => {
  if (!original || busy) return;
  stopPlayback();
  openMaterialEditor(timelapse?.structure || original, updated => {
    original = updated;
    runSimulation();
  });
});
$('simulate-button').addEventListener('click', () => runSimulation());
$('play-button').addEventListener('click', play);
$('timeline').addEventListener('input', () => { stopPlayback(); setFrame(Number($('timeline').value)); });
$('restart-button').addEventListener('click', () => { stopPlayback(); setFrame(0); });
$('playback-speed').addEventListener('change', () => { if (playing) { stopPlayback(); play(); } });
for (const key of [...passKeys, ...numberKeys, 'seed', 'wind']) $(key).addEventListener('input', () => { $('climate').value = 'custom'; updateSettingsUI(true); });
$('reset-settings').addEventListener('click', () => { writeSettings(DEFAULTS); $('climate').value = 'temperate'; updateSettingsUI(true); toast('Conditions reset. Simulate to apply.'); });
$('randomize-seed').addEventListener('click', () => { $('seed').value = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000; updateSettingsUI(true); });
$('climate').addEventListener('change', () => {
  const presets = {
    temperate: { weathering: 1, sedimentRate: 0.45, growthRate: 0.65, rainfall: 0.6, water: false, wind: 'NW' },
    arid: { weathering: 0.7, sedimentRate: 1.2, growthRate: 0.1, rainfall: 0.1, water: false, wind: 'NE' },
    forest: { weathering: 1.3, sedimentRate: 0.65, growthRate: 1.3, rainfall: 1.2, water: true, wind: 'SW' },
  };
  if (presets[$('climate').value]) { writeSettings({ exposure: true, collapse: true, sediment: true, overgrowth: true, ...presets[$('climate').value] }); updateSettingsUI(true); }
});
$('import-button').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async () => {
  const file = $('file-input').files[0]; if (!file) return;
  try { if (file.size > 50000000) throw new Error('Maximum file size is 50 MB.'); const data = JSON.parse(await file.text()); importData(data, file.name.replace(/\.json$/i, '').replace(/[-_]/g, ' ')); }
  catch (error) { toast(`Import failed: ${error.message}`, true); }
  $('file-input').value = '';
});
$('url-button').addEventListener('click', () => { $('url-error').textContent = ''; $('url-dialog').showModal(); });
$('url-form').addEventListener('submit', async event => {
  event.preventDefault(); $('url-error').textContent = ''; $('url-submit').disabled = true;
  try {
    const url = new URL($('json-url').value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS URL.');
    const version = loadVersion;
    const data = await fetchJSON(url.href, AbortSignal.timeout(20000));
    if (version !== loadVersion || !$('url-dialog').open) return;
    importData(data, decodeURIComponent(url.pathname.split('/').pop() || 'Remote structure').replace(/\.json$/i, '').replace(/[-_]/g, ' ')); $('url-dialog').close();
  } catch (error) { $('url-error').textContent = error.name === 'TypeError' ? 'Could not fetch this URL. Check the address and that the source allows CORS.' : error.message; }
  finally { $('url-submit').disabled = false; }
});
$('guide-button').addEventListener('click', () => $('guide-dialog').showModal());
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
$('export-button').addEventListener('click', () => { if (!timelapse || busy) return; downloadJSON(timelapse, `${fileName()}-timelapse.json`); toast('Timelapse exported: original structure + incremental keyframes.'); });
$('export-structure').addEventListener('click', () => { if (!timelapse || busy) return; const t = frame ? timelapse.frames[frame - 1].t : 0; downloadJSON({ ...timelapse.structure, voxels: currentVoxels }, `${fileName()}-year-${t}.json`); toast(`Year ${number(t)} exported as a standalone voxel structure.`); });
$('floor-height').addEventListener('input', updateFloorHeight);
$('floor-reset').addEventListener('click', () => { $('floor-height').value = 0; updateFloorHeight(); });
$('grid-button').addEventListener('click', () => { const active = $('grid-button').classList.toggle('active'); $('grid-button').setAttribute('aria-pressed', active); viewer?.setGrid(active); });
for (const mode of ['orbit', 'top']) $(`${mode}-button`).addEventListener('click', () => { viewer?.fit(mode); selectViewButton(mode); });
$('fit-button').addEventListener('click', () => { viewer?.fit(); selectViewButton('orbit'); });
$('snapshot-button').addEventListener('click', async () => { if (!viewer) return; const blob = await viewer.snapshot(); if (blob) { download(blob, `${fileName()}-year-${frame ? timelapse.frames[frame - 1].t : 0}.png`); toast('Viewport saved as PNG.'); } });
$('fullscreen-button').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('.viewer-card').requestFullscreen(); } catch { toast('Fullscreen is not available in this browser.', true); } });
// Drop a local file onto the observatory as an alternative to the import picker.
const mainPanel = document.querySelector('.main-panel');
mainPanel.addEventListener('dragover', e => { e.preventDefault(); });
mainPanel.addEventListener('drop', async e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (!file) return; try { if (file.size > 50000000) throw new Error('Maximum file size is 50 MB.'); importData(JSON.parse(await file.text()), file.name.replace(/\.json$/i, '')); } catch (error) { toast(error.message, true); } });

async function init() {
  updateSettingsUI(); setBusy(true);
  try { viewer = new VoxelViewer($('viewer')); viewer.onError = message => toast(message, true); }
  catch { $('viewer-loading').innerHTML = '<div class="viewer-error"><strong>A little more graphics power.</strong><p>WebGL is unavailable. Enable hardware acceleration or use a browser with WebGL support. The simulation and JSON exports still work.</p></div>'; }
  try {
    const data = await fetchJSON(`${base}examples/manifest.json`, AbortSignal.timeout(20000)); manifest = data.structures; renderLibrary();
    await loadExample(manifest[0].id);
    if (!viewer) { $('viewer-loading').hidden = false; }
  } catch (error) { setBusy(false); $('viewer-loading').hidden = true; toast(`Could not load the library: ${error.message}. You can still import a JSON file.`, true); }
}
init();
