import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

test.skip(process.env.M_CHARTS_ENABLE_WEBGPU_E2E !== '1' || !process.env.M_CHARTS_CLIENT_PERF_ROWS, 'Run the dedicated serial benchmark command on a real GPU.');
const sizes = process.env.M_CHARTS_CLIENT_PERF_ROWS?.split(',').map(Number) ?? [1000000];
for (const rows of sizes) test(`client pipeline residency and latency: ${rows} rows`, async ({ page }) => {
  test.setTimeout(600000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (event) => { if (event.type() === 'error') errors.push(event.text()); });
  const budget = process.env.M_CHARTS_CLIENT_PERF_BUDGET_MS;
  await page.goto(`/@fs${resolve('tests/browser/clientViewPerformance.html')}?rows=${rows}${budget ? `&budgetMs=${encodeURIComponent(budget)}` : ''}`);
  await expect(page.getByRole('status')).toHaveText(/^(ALL PASSED|FAILED)$/, { timeout: 540000 });
  const result = await page.locator('#results').innerText();
  await test.info().attach('client-pipeline-measurements', { body: result, contentType: 'application/json' });
  expect(errors).toEqual([]);
  await expect(page.getByRole('status'), result).toHaveText('ALL PASSED');
});
