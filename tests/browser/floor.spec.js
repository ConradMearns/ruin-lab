import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { VoxelViewer } from '../../src/viewer.js';

test('floor and grid move together without changing model data', async ({ page }) => {
  const fake = { ground: { position: {} }, grid: { position: {} }, invalidate() {} };
  VoxelViewer.prototype.setFloorHeight.call(fake, 12);
  expect(fake.ground.position.y).toBeCloseTo(11.44);
  expect(fake.grid.position.y).toBeCloseTo(11.46);
  VoxelViewer.prototype.setFloorHeight.call(fake, -5);
  expect(fake.ground.position.y).toBeCloseTo(-5.56);
  await page.goto('/');
  await expect(page.locator('#play-button')).toBeEnabled();
  const exportCurrent = async () => {
    const event = page.waitForEvent('download');
    await page.locator('#export-structure').click();
    return JSON.parse(await readFile(await (await event).path(), 'utf8'));
  };
  const before = await exportCurrent();
  await page.locator('#floor-height').fill('12');
  await expect(page.locator('#floor-height-value')).toHaveText('Y = 12');
  await page.locator('#fit-button').click();
  await expect(page.locator('#floor-height')).toHaveValue('12');
  expect(await exportCurrent()).toEqual(before);
  await page.locator('#floor-height').fill('-5');
  await expect(page.locator('#floor-height-value')).toHaveText('Y = -5');
  await page.locator('#floor-reset').click();
  await expect(page.locator('#floor-height')).toHaveValue('0');
  await page.locator('#floor-height').fill('8');
  await page.locator('[data-id="forest-cottage"]').click();
  await expect(page.locator('#structure-name')).toHaveText('Forest cottage');
  await expect(page.locator('#floor-height')).toHaveValue('0');
});
