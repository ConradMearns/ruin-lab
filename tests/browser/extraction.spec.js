import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseProject, parseRegion } from '../../src/extraction/model.js';
import { parseStructure } from '../../src/schema.js';
import { createDemoRegion } from '../../src/extraction/demo.js';

const ready = async page => { await expect(page.locator('#selection-status')).toContainText('occupied cells selected'); };
const localFile = (name, data) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });

test('studio loads, slices and changes bounds; local files cannot be served', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/extraction.html'); await ready(page);
  await expect(page.locator('#studio-viewer canvas')).toBeVisible();
  await expect(page.locator('#source-badge')).toContainText('SYNTHETIC');
  await page.locator('#cutaway').check();
  await page.locator('#slice-axis').selectOption('2');
  await page.locator('#slice').fill('20'); await expect(page.locator('#slice-value')).toHaveText('Z = 20');
  await page.locator('#show-export').click(); await expect(page.locator('#show-export')).toHaveClass('active');
  await page.locator('#bound-max-0').fill('15'); await page.locator('#bound-max-0').press('Tab');
  await expect(page.locator('#undo')).toBeEnabled();
  await page.locator('#undo').click(); await expect(page.locator('#bound-max-0')).toHaveValue('39');
  await page.locator('#redo').click(); await expect(page.locator('#bound-max-0')).toHaveValue('15');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const path of ['/local/inspection/save-report.json', '/local/extractions/house-candidate.vsregion.json?raw', '/@fs/home/conrad/3j-ruiner/local/inspection/save-report.json']) {
    const response = await page.request.get(path); expect([403, 404]).toContain(response.status());
    expect(await response.text()).not.toContain('saveSha256');
  }
  expect(errors).toEqual([]);
});

test('air preview, manual lock, undo, project round trip, ruiner import', async ({ page }) => {
  await page.goto('/extraction.html'); await ready(page);
  await page.locator('#inspect-coordinate').click(); await expect(page.locator('#cell-code')).toHaveText('game:air');
  await page.locator('#suggest-air').click(); await expect(page.locator('#air-warning')).toContainText('Open or clipped');
  await expect(page.locator('#air-count')).toHaveText('0');
  await page.locator('#accept-air').click(); await expect(page.locator('#air-count')).not.toHaveText('0');
  const airCount = await page.locator('#air-count').textContent();
  await page.locator('#shell').fill('5'); await page.locator('#shell').dispatchEvent('change');
  await expect(page.locator('#air-count')).toHaveText(airCount);
  await page.locator('#undo').click(); await expect(page.locator('#shell')).toHaveValue('2');
  const projectDownload = page.waitForEvent('download'); await page.locator('#save-project').click();
  const projectText = await readFile(await (await projectDownload).path(), 'utf8');
  const project = parseProject(projectText); expect(project.overrides.size).toBeGreaterThan(0);
  await page.locator('#region-file').setInputFiles({ name: 'roundtrip.vsproject.json', mimeType: 'application/json', buffer: Buffer.from(projectText) });
  await ready(page); await expect(page.locator('#air-count')).toHaveText(airCount);
  const snapshotDownload = page.waitForEvent('download'); await page.locator('#export-ruiner').click();
  const snapshotText = await readFile(await (await snapshotDownload).path(), 'utf8');
  const snapshot = parseStructure(snapshotText);
  expect(snapshot.extraction.originalSelectedAir.length).toBeGreaterThan(0);
  expect(Object.values(snapshot.materials).some(m => m.fixed)).toBe(true);
  await page.goto('/'); await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#file-input').setInputFiles({ name: 'extracted-house.json', mimeType: 'application/json', buffer: Buffer.from(snapshotText) });
  await expect(page.locator('#structure-name')).toHaveText('extracted house'); await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#simulate-button').click(); await expect(page.locator('#simulate-button')).toBeEnabled();
  await expect(page.locator('#current-year')).toHaveText('1,200');
});

test('invalid import preserves active region; slice painting and failed bounds are reversible', async ({ page }) => {
  await page.goto('/extraction.html'); await ready(page);
  await page.locator('#region-file').setInputFiles(localFile('bad.json', { format: 'wrong' }));
  await expect(page.locator('#toast')).toContainText('Could not open');
  await expect(page.locator('#source-badge')).toContainText('SYNTHETIC');
  await page.locator('#bound-min-0').fill('100'); await page.locator('#bound-min-0').press('Tab');
  await expect(page.locator('#bound-min-0')).toHaveValue('0');
  await expect(page.locator('#toast')).toContainText('bounds');
  // Select center cellar dry-air cell in the fitted horizontal slice.
  await page.locator('[data-tool="3"]').click();
  const rect = await page.locator('#slice-canvas').boundingBox();
  const unit = Math.min((rect.width - 24) / 40, (rect.height - 24) / 40);
  const x = (rect.width - 40 * unit) / 2 + 20.5 * unit;
  const y = (rect.height - 40 * unit) / 2 + 20.5 * unit;
  await page.locator('#slice-canvas').click({ position: { x, y } });
  await expect(page.locator('#air-count')).toHaveText('1');
  await page.locator('#undo').click(); await expect(page.locator('#air-count')).toHaveText('0');
  await page.locator('#redo').click(); await expect(page.locator('#air-count')).toHaveText('1');
  page.on('dialog', dialog => dialog.accept());
  const raw = createDemoRegion(); raw.name = '<img src=x onerror=alert(1)>'; raw.source = { gameVersion: '1.22.7' };
  expect(parseRegion(raw).data.name).toBe(raw.name);
  await page.locator('#region-file').setInputFiles(localFile('private.json', raw));
  await expect(page.locator('#source-badge')).toContainText('PRIVATE');
  await expect(page.locator('#region-name')).toHaveText(raw.name); expect(await page.locator('#region-name img').count()).toBe(0);
});
