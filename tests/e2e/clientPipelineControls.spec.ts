import { test, expect } from '@playwright/test';
import type { ClientDataViewState } from '../../packages/m-charts/src/client-data-view/index.ts';

test.skip(process.env.M_CHARTS_ENABLE_WEBGPU_E2E !== '1', 'Requires an actual WebGPU adapter.');

for (const chart of ['scatter', 'histogram', 'parallel'] as const) {
  test(`${chart}: shared pipeline updates rules, validates import, and resets`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    // Histogram creates the shared resident dataset without a setup action.
    await page.goto('/m-histogram-webgpu?points=1000000');
    await expect(page.getByTestId('client-view-panel')).toBeVisible({ timeout: 60_000 });
    if (chart !== 'histogram') await page.goto(`/m-${chart}-webgpu?points=1000000`);
    const panel = page.getByTestId(chart === 'scatter' ? 'scatter-client-view-panel' : 'client-view-panel');
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await panel.getByText('Pipeline diagnostics and state', { exact: true }).click();
    const state = async () => JSON.parse((await panel.getByTestId('client-view-state-json').textContent())!) as ClientDataViewState;
    const reset = panel.getByTestId('client-view-reset');
    const settled = async () => { await expect(reset).toBeEnabled(); };
    await expect(panel.getByLabel('Client pipeline summary')).toContainText('1,000,000 visible');
    await expect(panel.getByText('No rules applied.', { exact: true }).first()).toBeVisible({ timeout: 60_000 });

    await panel.getByTestId('client-filter-category').click(); await settled();
    const filteredCount = (await panel.getByTestId('client-view-visible-count').textContent())!;
    await panel.getByTestId('client-filter-category').click(); await settled();
    expect((await state()).filters).toHaveLength(1);
    await expect(panel.getByTestId('client-view-visible-count')).toHaveText(filteredCount);

    await panel.getByText('Transformations', { exact: true }).click();
    const factor = panel.getByRole('spinbutton', { name: chart === 'scatter' ? 'Scale factor' : 'Client transform factor', exact: true });
    const offset = panel.getByRole('spinbutton', { name: chart === 'scatter' ? 'Offset' : 'Client transform offset', exact: true });
    await factor.fill('2'); await offset.fill('0');
    await panel.getByTestId('client-transform-affine').click(); await settled();
    await factor.fill('3');
    if (chart === 'histogram') await offset.fill('1000');
    await panel.getByTestId('client-transform-affine').click(); await settled();
    const linear = (await state()).transformations;
    expect(linear).toHaveLength(1);
    expect(linear[0]).toMatchObject({ op: 'affine', factor: 3, offset: chart === 'histogram' ? 1000 : 0 });
    if (chart === 'histogram') {
      const range = await page.evaluate(() => window.__histogramFastRouteStateTestHook?.()?.viewport?.subplotById.signalValue?.x);
      expect(range).toBeDefined();
      expect(range!.min).toBeGreaterThan(1000);
      expect(range!.max - range!.min).toBeGreaterThan(100);
      await panel.getByLabel('Filter stage').selectOption('transformed');
      expect(Number(await panel.getByLabel('Client filter minimum').inputValue())).toBeGreaterThan(1000);
    }
    await panel.getByTestId('client-transform-delta').click(); await settled();
    await panel.getByTestId('client-transform-delta').click(); await settled();
    expect((await state()).transformations).toHaveLength(2);
    const difference = (await state()).transformations[1]!;
    await panel.getByRole('button', { name: `Move ${difference.id} up`, exact: true }).click(); await settled();
    expect((await state()).transformations[0]!.id).toBe(difference.id);
    await panel.getByRole('button', { name: `Remove ${difference.id}`, exact: true }).click(); await settled();
    expect((await state()).transformations).toHaveLength(1);
    await factor.fill(''); await expect(panel.getByTestId('client-transform-affine')).toBeDisabled();
    await factor.fill('3');

    await panel.getByText('Styles', { exact: true }).click();
    await panel.getByTestId('client-style-data-only').click(); await settled();
    await expect(panel.getByTestId('client-view-style-source')).toHaveText('Theme base');
    await panel.getByTestId('client-style-preset').click(); await settled();
    const saved = await state();
    expect(saved.styles).toHaveLength(1);
    await panel.getByLabel('Import client state JSON').fill('{invalid');
    await panel.getByRole('button', { name: 'Import state', exact: true }).click(); await settled();
    await expect(panel.getByRole('alert')).toBeVisible({ timeout: 60_000 });
    expect(await state()).toEqual(saved);

    await reset.click(); await settled();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(panel.getByTestId('client-view-visible-count')).toHaveText('1,000,000');
    expect(await state()).toMatchObject({ filters: [], transformations: [], styles: [], sourceStyleMode: 'preserve' });
    await panel.getByLabel('Import client state JSON').fill(JSON.stringify(saved));
    await panel.getByRole('button', { name: 'Import state', exact: true }).click(); await settled();
    expect(await state()).toMatchObject({ filters: saved.filters, transformations: saved.transformations, styles: saved.styles });
    await reset.click(); await settled();
    await expect(panel.getByTestId('client-filter-selection-inside')).toBeDisabled();
    await expect(panel.getByTestId('client-filter-selection-outside')).toBeDisabled();
    if (chart !== 'scatter') {
      for (const inside of [true, false]) {
        const target = chart === 'parallel' ? page.getByLabel('Brush phase', { exact: true }) : page.locator('.histogram-fast-overlay-plot-frame').last();
        const box = await target.boundingBox();
        if (box === null) throw new Error('Missing chart selection target');
        await page.mouse.move(box.x + box.width * (chart === 'parallel' ? 0.5 : 0.2), box.y + box.height * 0.2);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(box.x + box.width * (chart === 'parallel' ? 0.5 : 0.65), box.y + box.height * 0.85, { steps: 8 });
        await page.mouse.up({ button: 'right' });
        await expect(panel.getByTestId('client-filter-selection-inside')).toBeEnabled({ timeout: 15_000 });
        const selected = chart === 'histogram'
          ? await page.evaluate(() => window.__histogramFastSelectionTestHook?.()?.selectedSourceCount ?? 0)
          : Number((await page.getByLabel('Parallel fast selected records').locator('dd').first().textContent())!.replace(/,/gu, ''));
        expect(selected).toBeGreaterThan(0);
        expect(selected).toBeLessThan(1_000_000);
        if (inside) await page.keyboard.press('Alt+i');
        else await panel.getByTestId('client-filter-selection-outside').click();
        await settled();
        await expect(panel.getByTestId('client-view-visible-count')).toHaveText((inside ? selected : 1_000_000 - selected).toLocaleString('en-US'));
        await expect(panel.getByTestId('client-filter-selection-inside')).toBeDisabled();
        await reset.click(); await settled();
      }
    }
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(panel.getByLabel('Client pipeline summary')).toContainText('1,000,000 visible');
    expect(errors).toEqual([]);
  });
}
