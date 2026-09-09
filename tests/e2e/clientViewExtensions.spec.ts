import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('client view extensions and production regressions', async ({ page }) => {
  test.skip(process.env.M_CHARTS_ENABLE_WEBGPU_E2E !== '1', 'Requires WebGPU');
  test.setTimeout(120000);
  await page.goto(`/@fs${resolve('tests/browser/clientDataView.html')}`);
  await expect(page.getByRole('status')).toHaveText('ALL PASSED', { timeout: 90000 });
  await expect(page.locator('.fail')).toHaveCount(0);
});
