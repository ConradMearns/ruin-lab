import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseTimelapse, parseStructure } from '../../src/schema.js';

const ready = async page => {
  await expect(page.locator('#simulate-button')).toBeEnabled();
  await expect(page.locator('#simulation-summary')).toContainText('keyframes');
};

test('loads a real WebGL scene and every example; mobile stays in bounds', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await ready(page);
  await expect(page.locator('#viewer canvas')).toBeVisible();
  await expect(page.locator('#current-year')).toHaveText('0');
  for (const [id, name] of [['hillside-chapel', 'Hillside chapel'], ['courtyard-villa', 'Courtyard villa'], ['forest-cottage', 'Forest cottage'], ['coastal-watchtower', 'Coastal watchtower']]) {
    await page.locator(`[data-id="${id}"]`).click(); await expect(page.locator('#structure-name')).toHaveText(name); await ready(page);
  }
  await page.locator('#top-button').click(); await expect(page.locator('#top-button')).toHaveClass('active');
  await page.locator('#grid-button').click(); await expect(page.locator('#grid-button')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#fit-button').click(); await expect(page.locator('#orbit-button')).toHaveClass('active');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#viewer canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('simulation, scrubbing, playback, export and timelapse reimport', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.locator('#water').check();
  await expect(page.locator('#rainfall-control')).toBeVisible();
  await page.locator('#steps').selectOption('6');
  await page.locator('#simulate-button').click(); await ready(page);
  await expect(page.locator('#current-year')).toHaveText('600');
  await page.locator('#restart-button').click(); await expect(page.locator('#current-year')).toHaveText('0');
  await page.locator('#playback-speed').selectOption('600'); await page.locator('#play-button').click();
  await expect(page.locator('#current-year')).not.toHaveText('0'); await page.locator('#play-button').click();
  await page.locator('#timeline').fill('3'); await expect(page.locator('#current-year')).toHaveText('300');
  const downloadEvent = page.waitForEvent('download'); await page.locator('#export-button').click(); const download = await downloadEvent;
  const result = parseTimelapse(await readFile(await download.path(), 'utf8'));
  expect(result.frames.length).toBe(6); expect(result.frames.some(f => f.set.length)).toBe(true);
  await page.locator('#file-input').setInputFiles({ name: 'my-history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(result)) });
  await expect(page.locator('#structure-name')).toHaveText('my history'); await expect(page.locator('#current-year')).toHaveText('0');
  await page.locator('#timeline').fill('6'); await expect(page.locator('#current-year')).toHaveText('600');
  const snapshotEvent = page.waitForEvent('download'); await page.locator('#export-structure').click();
  const snapshot = parseStructure(await readFile(await (await snapshotEvent).path(), 'utf8'));
  expect(snapshot.voxels.length).toBeGreaterThan(0);
  const pngEvent = page.waitForEvent('download'); await page.locator('#snapshot-button').click();
  expect((await pngEvent).suggestedFilename()).toMatch(/\.png$/);
});

test('validates local files, supports remote JSON and opens field notes', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.locator('#file-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version": 9}') });
  await expect(page.locator('#toast')).toContainText('Import failed');
  await expect(page.locator('#structure-name')).toHaveText('Coastal watchtower');
  const structure = { version: 1, size: [4, 4, 4], materials: { 0: { name: 'air' }, 1: { name: 'stone', color: '#888888', durability: 1, decays_to: '0' } }, voxels: [[1, 0, 1, 1], [1, 1, 1, 1]] };
  await page.route('https://structures.example/tiny-tower.json', route => route.fulfill({ json: structure, headers: { 'access-control-allow-origin': '*' } }));
  await page.locator('#url-button').click(); await page.locator('#json-url').fill('https://structures.example/tiny-tower.json'); await page.locator('#url-submit').click();
  await expect(page.locator('#url-dialog')).not.toBeVisible(); await expect(page.locator('#structure-name')).toHaveText('tiny tower'); await ready(page);
  await page.locator('#guide-button').click(); await expect(page.locator('#guide-dialog')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#guide-dialog')).not.toBeVisible();
});
