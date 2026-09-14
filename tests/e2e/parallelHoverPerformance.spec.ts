import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.M_CHARTS_ENABLE_WEBGPU_E2E !== '1', 'Requires a WebGPU adapter.');

for (const rows of [1_000_000, 10_000_000]) {
  test(`parallel hover: ${rows} rows, zoom, fallback and continuous movement`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' || (message.type() === 'warning' && /WebGPU|GPUValidation|WGSL/u.test(message.text()))) errors.push(message.text());
    });
    await page.goto(`/@fs${resolve('tests/browser/parallelHover.html')}?rows=${rows}`);
    await expect(page.getByRole('status')).toHaveText('PASS: all parallel hover checks', { timeout: 90_000 });
    await test.info().attach('hover-timings.json', {
      body: await page.locator('#timings').innerText(), contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });
}
