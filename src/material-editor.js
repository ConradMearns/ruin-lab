import './material-editor.css';
import { parseStructure } from './schema.js';

/** Edits a copy; Cancel never mutates the active structure or history. */
export function openMaterialEditor(structure, onApply) {
  const draft = structuredClone(structure);
  const dialog = document.createElement('dialog'); dialog.className = 'material-editor';
  dialog.innerHTML = `<form><div class="dialog-heading"><span class="eyebrow">MATERIAL WORKSHOP</span><button type="button" class="icon-button material-cancel" aria-label="Close">×</button></div>
    <h2>Let every block age.</h2><p>Lower durability means faster decay. Protected terrain ignores decay and collapse, regardless of durability.</p>
    <label class="field-label" for="material-search">Find a material</label><input id="material-search" type="search" placeholder="glass, sandstone, wood…" />
    <select id="material-list" size="6" aria-label="Material"></select><p id="material-empty" hidden>No matching materials.</p>
    <fieldset id="material-fields"><p id="material-code"></p><label class="field-label" for="material-durability">Durability · lower = more fragile</label><input id="material-durability" type="number" min="0.001" step="any" required />
    <label class="material-protection"><input id="material-protected" type="checkbox" /> Protected / fixed terrain</label>
    <label class="field-label" for="material-decay">Decays into</label><select id="material-decay"></select><p id="material-note"></p></fieldset>
    <p id="material-error" class="error-text" role="alert"></p><div class="material-actions"><button type="button" class="button ghost material-cancel">Cancel</button><button type="submit" class="button dark">Apply & simulate</button></div>
    <p class="guide-footnote">Changes apply to this structure and are included in subsequent JSON exports. Existing keyframes will be regenerated from year zero.</p></form>`;
  const $ = id => dialog.querySelector(`#${id}`);
  let selected = null;
  const entries = Object.entries(draft.materials).filter(([id]) => id !== '0');
  const close = () => { dialog.close(); dialog.remove(); };
  function status() {
    const m = draft.materials[selected]; if (!m) return;
    $('material-note').textContent = m.fixed || m.ground ? 'Protected: this material will not weather. Uncheck protection to allow aging.' : !m.decays_to || m.decays_to === selected ? 'No decay transition: durability alone will not remove this material. Choose air or another material.' : `Weathering can advance this material to ${draft.materials[m.decays_to].name}.`;
  }
  function saveFields() {
    if (selected === null) return true;
    const input = $('material-durability'), value = Number(input.value);
    if (!input.value || !Number.isFinite(value) || value < 0.001) { $('material-error').textContent = 'Durability must be at least 0.001.'; input.focus(); return false; }
    draft.materials[selected].durability = value; $('material-error').textContent = ''; return true;
  }
  function show(id) {
    selected = id; const m = draft.materials[id]; $('material-fields').disabled = !m;
    if (!m) return;
    $('material-code').textContent = `#${id} · ${m.vsCode || m.name}`;
    $('material-durability').value = m.durability ?? 1;
    $('material-protected').checked = !!(m.fixed || m.ground);
    $('material-decay').replaceChildren(new Option('Never (no transition)', ''));
    for (const [target, material] of Object.entries(draft.materials)) if (target !== id) $('material-decay').add(new Option(`${material.name} · #${target}`, target));
    $('material-decay').value = m.decays_to && m.decays_to !== id ? m.decays_to : '';
    status();
  }
  function filter() {
    if (!saveFields()) return;
    const query = $('material-search').value.toLowerCase();
    const matches = entries.filter(([id, m]) => `${id} ${m.name} ${m.vsCode || ''}`.toLowerCase().includes(query));
    $('material-list').replaceChildren(...matches.map(([id, m]) => new Option(`${m.name} · #${id}${m.fixed || m.ground ? ' · protected' : ''}`, id)));
    $('material-empty').hidden = matches.length > 0;
    const id = matches.some(([id]) => id === selected) ? selected : matches[0]?.[0] ?? null;
    if (id) $('material-list').value = id; show(id);
  }
  $('material-search').addEventListener('input', filter);
  $('material-list').addEventListener('change', () => { const next = $('material-list').value; if (saveFields()) show(next); else $('material-list').value = selected; });
  $('material-protected').addEventListener('change', () => {
    const m = draft.materials[selected];
    if ($('material-protected').checked) m.fixed = true;
    else { delete m.fixed; delete m.ground; if (!m.decays_to || m.decays_to === selected) { m.decays_to = '0'; $('material-decay').value = '0'; } }
    status();
  });
  $('material-decay').addEventListener('change', () => { const m = draft.materials[selected]; if ($('material-decay').value) m.decays_to = $('material-decay').value; else delete m.decays_to; status(); });
  dialog.querySelectorAll('.material-cancel').forEach(button => button.addEventListener('click', close));
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault(); if (!saveFields()) return;
    try { const validated = parseStructure(draft); onApply(validated); close(); } catch (error) { $('material-error').textContent = error.message; }
  });
  document.body.appendChild(dialog); filter(); dialog.showModal(); $('material-search').focus();
}
