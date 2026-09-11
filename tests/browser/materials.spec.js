import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('material editor unlocks imported glass, applies decay and persists it in exports', async ({ page }) => {
  const structure = { version: 1, size: [4, 4, 4], materials: {
    0: { name: 'air' },
    1: { name: 'glasspane-leaded-oak-ns', color: '#7da9ac', durability: 1, fixed: true, extractionRole: 'terrain' },
    2: { name: 'rock-sandstone', color: '#bea780', fixed: true },
  }, voxels: [[1, 2, 1, 1], [1, 1, 1, 2]] };
  await page.goto('/');
  await expect(page.locator('#materials-button')).toBeEnabled();
  await page.locator('#file-input').setInputFiles({ name: 'glass-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(structure)) });
  await expect(page.locator('#structure-name')).toHaveText('glass test');
  await expect(page.locator('#materials-button')).toBeEnabled();
  await page.locator('#materials-button').click();
  await page.locator('#material-search').fill('glass');
  await expect(page.locator('#material-protected')).toBeChecked();
  await page.locator('#material-protected').uncheck();
  await expect(page.locator('#material-decay')).toHaveValue('0');
  await page.locator('#material-durability').fill('0.001');
  await page.getByRole('button', { name: 'Apply & simulate' }).click();
  await expect(page.locator('.material-editor')).toHaveCount(0);
  await expect(page.locator('#materials-button')).toBeEnabled();
  const event = page.waitForEvent('download'); await page.locator('#export-button').click();
  const data = JSON.parse(await readFile(await (await event).path(), 'utf8'));
  expect(data.structure.materials[1].fixed).toBeUndefined();
  expect(data.structure.materials[1].durability).toBe(0.001);
  expect(data.structure.materials[1].decays_to).toBe('0');
  expect(data.structure.materials[2].fixed).toBe(true);
  expect(data.frames.some(f => f.set.some(v => v.join(',') === '1,2,1,0'))).toBe(true);
  await page.locator('#materials-button').click();
  await page.locator('#material-search').fill('glass');
  await page.locator('#material-durability').fill('9');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('#materials-button').click();
  await page.locator('#material-search').fill('glass');
  await expect(page.locator('#material-durability')).toHaveValue('0.001');
});
