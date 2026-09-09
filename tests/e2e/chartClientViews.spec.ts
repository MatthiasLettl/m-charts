import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { ParallelWebgpuPlotInstance, ParallelBuffers } from '../../packages/m-charts/src/m-parallel-webgpu/index.ts';
import type { HistogramWebgpuPlotInstance, HistogramColumns } from '../../packages/m-charts/src/m-histogram-webgpu/index.ts';
import type { ClientDataView } from '../../packages/m-charts/src/client-data-view/index.ts';

declare global {
  interface Window {
    parallelClientRegression: { plot: ParallelWebgpuPlotInstance; view?: ClientDataView; buffers: ParallelBuffers; errors: string[] };
    histogramClientRegression: { plot: HistogramWebgpuPlotInstance; view?: ClientDataView; columns: HistogramColumns; errors: string[] };
  }
}
const parallelUrl = `/@fs${resolve('packages/m-charts/src/m-parallel-webgpu/index.ts')}`;
const histogramUrl = `/@fs${resolve('packages/m-charts/src/m-histogram-webgpu/index.ts')}`;
test.skip(process.env.M_CHARTS_ENABLE_WEBGPU_E2E !== '1', 'Requires an actual WebGPU adapter.');
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || (message.type() === 'warning' && /WebGPU|GPUValidation|WGSL|writeBuffer/u.test(message.text()))) errors.push(message.text());
  });
  await page.goto('/');
});
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });
async function mountParallel(page: Page, view: boolean, mode: 'direct' | 'density' | 'auto' = 'direct', count = 3) {
  await page.evaluate(async ({ parallelUrl, view: enabled, mode, count }) => {
    window.parallelClientRegression?.plot.dispose();
    const api = await import(parallelUrl) as typeof import('../../packages/m-charts/src/m-parallel-webgpu/index.ts');
    const host = document.createElement('div'); host.style.cssText = 'width:800px;height:400px;position:relative;background:white';
    document.body.style.cssText = 'margin:0;background:white'; document.body.replaceChildren(host);
    const buffers = api.createParallelWebgpuBuffers({ axisOrder: ['a', 'b'], ids: Array.from({ length: count }, (_, i) => `row-${i}`),
      valuesByAxis: count === 3
        ? { a: new Float64Array([0.1, 0.5, 0.9]), b: new Float64Array([0.2, 0.4, 0.8]) }
        : { a: Float64Array.from({ length: count }, (_, i) => i / (count - 1)), b: Float64Array.from({ length: count }, (_, i) => 0.5 + 0.45 * Math.sin(i / 23)) } });
    const view = enabled ? api.createParallelClientDataView({ buffers }) : undefined;
    const errors: string[] = [];
    const plot = api.createParallelWebgpuPlot(host, { buffers, renderMode: mode, directSegmentLimit: 1, representativeRecordLimit: 128,
      binResolution: 32, theme: { backgroundColor: [1, 1, 1, 1], lineColor: [0, 0.2, 0.8, 1], selectedColor: [1, 0, 0, 1], preselectedColor: [0, 1, 0, 1] },
      ...(view ? { clientView: { view } } : {}) });
    plot.on('renderstatechange', (event) => { if (event.state === 'error') errors.push(event.message ?? 'Unknown error'); });
    window.parallelClientRegression = { plot, view, buffers, errors }; await plot.ready;
  }, { parallelUrl, view, mode, count });
  await settleParallel(page);
}
async function settleParallel(page: Page) {
  await expect.poll(() => page.evaluate(() => { const d = window.parallelClientRegression.plot.getWebgpuDiagnostics(); return d.initialized && !d.clientView?.pending; })).toBe(true);
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  expect(await page.evaluate(() => window.parallelClientRegression.errors)).toEqual([]);
  await expect.poll(() => page.evaluate(() => window.parallelClientRegression.plot.commands.getRenderSnapshot().renderState)).toBe('ready');
}
for (const mode of ['direct', 'density', 'auto'] as const) test(`parallel ${mode}: optional view, GPU visibility, exact selection, reset and rapid edits`, async ({ page }) => {
  await mountParallel(page, false, mode);
  const baseline = await page.locator('.parallel-fast-webgpu-canvas-base').screenshot();
  await mountParallel(page, true, mode);
  expect((await page.locator('.parallel-fast-webgpu-canvas-base').screenshot()).equals(baseline)).toBe(true);
  await page.evaluate(() => {
    const { view } = window.parallelClientRegression;
    view!.addFilter({ id: 'keep', predicate: { op: 'gte', field: 'a', value: 0.5 } });
    view!.addTransformation({ id: 'scale', op: 'affine', input: 'b', output: 'b', factor: 0.5, offset: 0 });
    view!.addStyle({ id: 'red', channels: { color: { op: 'constant', value: '#ff0000' }, opacity: { op: 'constant', value: 0.9 } } });
  });
  await settleParallel(page);
  await page.evaluate(() => window.parallelClientRegression.plot.commands.commitBrushIntervals({ a: { min: 0, max: 1 } }));
  await expect.poll(() => page.evaluate(() => Array.from(window.parallelClientRegression.plot.commands.getStateSnapshot().selectedSourceIndices))).toEqual([1, 2]);
  const state = await page.evaluate(() => {
    const { plot, buffers } = window.parallelClientRegression;
    return { raw: Array.from(plot.commands.getStateSnapshot().buffers.rawValuesByAxis.b!), source: Array.from(buffers.rawValuesByAxis.b!) };
  });
  expect(state.raw).toEqual([NaN, state.source[1]! * 0.5, state.source[2]! * 0.5]); expect(state.source).toEqual([0.2, 0.4, 0.8].map(Math.fround));
  await page.evaluate(() => window.parallelClientRegression.view!.addFilter({ id: 'empty', predicate: { op: 'lt', field: 'a', value: 0 } }));
  await settleParallel(page);
  await expect.poll(() => page.evaluate(() => Array.from(window.parallelClientRegression.plot.commands.getStateSnapshot().selectedSourceIndices))).toEqual([]);
  expect(await page.evaluate(async () => window.parallelClientRegression.plot.commands.resolveInspectionAtPoint({ axisPosition: 0.5, normalizedValue: 0.5, maxDistancePx: 10000, plotWidthPx: 800, plotHeightPx: 400 }))).toBeNull();
  await page.evaluate(() => { const { plot, view } = window.parallelClientRegression; plot.commands.clearBrushes(); view!.replaceState({ ...view!.exportState(), filters: [], styles: [], transformations: [] }); });
  await settleParallel(page);
  expect((await page.locator('.parallel-fast-webgpu-canvas-base').screenshot({ path: test.info().outputPath('parallel-reset.png') })).equals(baseline)).toBe(true);
  expect(await page.evaluate(() => { try { const { plot, buffers } = window.parallelClientRegression; plot.update({ buffers: { ...buffers } }); return false; } catch { return true; } })).toBe(true);
});

test('parallel hybrid: sparse representatives, style-only uploads, empty view and reset', async ({ page }) => {
  await mountParallel(page, false, 'auto', 4097);
  const canvas = page.locator('.parallel-fast-webgpu-canvas-base');
  const baseline = await canvas.screenshot();
  await mountParallel(page, true, 'auto', 4097);
  expect((await canvas.screenshot()).equals(baseline)).toBe(true);
  await page.evaluate(() => window.parallelClientRegression.plot.commands.setSelectedSourceIndices(new Uint32Array([4076, 4096])));
  await page.evaluate(() => {
    const { view } = window.parallelClientRegression;
    view!.addFilter({ id: 'sparse', predicate: { op: 'gte', field: 'a', value: 0.995 } });
    view!.addTransformation({ id: 'scale', op: 'affine', input: 'b', output: 'b', factor: -1, offset: 1 });
  });
  await settleParallel(page);
  const coordinateBytes = await page.evaluate(() => window.parallelClientRegression.plot.getWebgpuDiagnostics().clientView!.viewUploadBytes);
  await page.evaluate(() => window.parallelClientRegression.view!.addStyle({ id: 'red', channels: { color: { op: 'constant', value: '#ff0000' } } }));
  await settleParallel(page);
  const diagnostics = await page.evaluate(() => window.parallelClientRegression.plot.getWebgpuDiagnostics());
  expect(diagnostics.renderMode).toBe('hybrid');
  expect(diagnostics.clientView?.activeRowCount).toBe(21);
  expect(diagnostics.clientView!.viewUploadBytes).toBeLessThan(coordinateBytes);
  expect(diagnostics.clientView!.sourceUploadBytes).toBe(0);
  expect(await page.evaluate(() => Array.from(window.parallelClientRegression.plot.commands.getStateSnapshot().selectedSourceIndices))).toEqual([4076, 4096]);
  expect((await canvas.screenshot()).equals(baseline)).toBe(false);
  await page.evaluate(() => window.parallelClientRegression.plot.commands.commitBrushIntervals({ a: { min: 0, max: 1 } }));
  await expect.poll(() => page.evaluate(() => Array.from(window.parallelClientRegression.plot.commands.getStateSnapshot().selectedSourceIndices))).toEqual(Array.from({ length: 21 }, (_, i) => 4076 + i));
  await page.evaluate(() => window.parallelClientRegression.view!.addFilter({ id: 'empty', predicate: { op: 'lt', field: 'a', value: 0 } }));
  await settleParallel(page);
  await page.evaluate(() => {
    const { view, plot } = window.parallelClientRegression;
    plot.commands.clearBrushes();
    view!.replaceState({ ...view!.exportState(), filters: [], transformations: [], styles: [] });
  });
  await settleParallel(page);
  expect((await canvas.screenshot()).equals(baseline)).toBe(true);
});

async function mountHistogram(page: Page, enabled: boolean, backend: 'typescript' | 'rust-wasm') {
  await page.evaluate(async ({ histogramUrl, enabled, backend }) => {
    window.histogramClientRegression?.plot.dispose();
    const api = await import(histogramUrl) as typeof import('../../packages/m-charts/src/m-histogram-webgpu/index.ts');
    const host = document.createElement('div'); host.style.cssText = 'width:800px;height:400px;position:relative;background:white'; document.body.style.cssText = 'margin:0;background:white'; document.body.replaceChildren(host);
    const columns: HistogramColumns = { ids: ['a', 'b', 'c', 'd'], parameters: [{ key: 'value', label: 'Value', kind: 'numeric', domain: { min: 0, max: 5 } }], valuesByParameter: { value: new Float64Array([1, 2, 3, 4]) } };
    const view = enabled ? api.createHistogramClientDataView({ columns }) : undefined;
    const errors: string[] = [];
    const plot = api.createHistogramWebgpuPlot(host, { columns, aggregationBackend: backend,
      spec: { mode: 'histogram', parameters: columns.parameters!, subplots: [{ id: 'value', label: 'Value', parameterKey: 'value' }] },
      ...(view ? { clientView: { view } } : {}) });
    plot.on('renderstatechange', (event) => { if (event.state === 'error') errors.push(event.message ?? 'Unknown error'); });
    window.histogramClientRegression = { plot, view, columns, errors }; await plot.ready;
  }, { histogramUrl, enabled, backend });
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}
for (const backend of ['typescript', 'rust-wasm'] as const) test(`histogram ${backend}: optional view, bins, styles, transformed domains and reset`, async ({ page }) => {
  await mountHistogram(page, false, backend);
  const baseline = await page.locator('.histogram-fast-webgpu-canvas').screenshot();
  await mountHistogram(page, true, backend);
  expect((await page.locator('.histogram-fast-webgpu-canvas').screenshot()).equals(baseline)).toBe(true);
  await page.evaluate(() => { const { view } = window.histogramClientRegression;
    view!.addFilter({ id: 'keep', predicate: { op: 'in', field: 'value', values: [1, 3] } });
    view!.addTransformation({ id: 'scale', op: 'affine', input: 'value', output: 'value', factor: 2, offset: 0 });
    view!.addStyle({ id: 'red', channels: { color: { op: 'constant', value: '#ff0000' }, opacity: { op: 'constant', value: 0.5 } } });
  });
  const result = await page.evaluate(() => { const { plot } = window.histogramClientRegression;
    const state = plot.commands.getStateSnapshot();
    return { diagnostics: plot.getWebgpuDiagnostics(), bins: state.aggregation.subplots[0]!.bins, errors: window.histogramClientRegression.errors };
  });
  expect(result.errors).toEqual([]);
  expect(result.diagnostics.aggregationBackend).toBe(backend);
  // Values outside the retained viewport are still part of the transformed domain.
  expect(result.diagnostics.clientView?.activeRowCount).toBe(2);
  expect(result.bins.flatMap((bin) => bin.stack).every((stack) => stack.color === 0xff000080)).toBe(true);
  expect(result.bins.reduce((count, bin) => count + bin.totalCount, 0)).toBeGreaterThan(0);
  expect((await page.locator('.histogram-fast-webgpu-canvas').screenshot()).equals(baseline)).toBe(false);
  await page.evaluate(() => { const { view } = window.histogramClientRegression; view!.replaceState({ ...view!.exportState(), filters: [], styles: [], transformations: [] }); });
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  expect((await page.locator('.histogram-fast-webgpu-canvas').screenshot({ path: test.info().outputPath('histogram-reset.png') })).equals(baseline)).toBe(true);
  expect(await page.evaluate(() => {
    const { plot, columns } = window.histogramClientRegression;
    try { plot.update({ columns: { ...columns } }); return false; } catch { return true; }
  })).toBe(true);
  await page.evaluate(() => {
    const { view } = window.histogramClientRegression;
    view!.replaceState({ ...view!.exportState(), sourceStyleMode: 'ignore' });
  });
  expect((await page.locator('.histogram-fast-webgpu-canvas').screenshot()).equals(baseline)).toBe(false);
  const themedColors = await page.evaluate(() => {
    const { plot } = window.histogramClientRegression;
    plot.update({ theme: { defaultBarColor: [0, 1, 0, 1] } });
    plot.commands.render();
    return plot.commands.getStateSnapshot().aggregation.subplots.flatMap((subplot) => subplot.bins).flatMap((bin) => bin.stack).map((stack) => stack.color);
  });
  expect(themedColors.length).toBeGreaterThan(0);
  expect(themedColors.every((color) => color === 0x00ff00ff)).toBe(true);
});

test('resident demo pipelines: filters, transforms, styles, state import and themes without refetch', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  // Histogram generates the shared local dataset; parallel then reads it.
  for (const chart of ['histogram', 'parallel']) {
    await page.goto(`/m-${chart}-webgpu?points=1000000&theme=light`);
    const panel = page.getByTestId('client-view-panel');
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await panel.getByText('Pipeline diagnostics and state', { exact: true }).click();
    await expect(panel.getByTestId('client-view-visible-count')).toHaveText('1,000,000');
    const canvas = page.locator(chart === 'histogram' ? '.histogram-fast-webgpu-canvas' : '.parallel-fast-webgpu-canvas-base');
    const baseline = await canvas.screenshot();
    let requests = 0;
    const requestListener = (request: import('@playwright/test').Request) => {
      if (/\/data\/|\/api\//u.test(request.url())) requests += 1;
    };
    page.on('request', requestListener);
    await panel.getByTestId('client-filter-category').click();
    await expect(panel.getByTestId('client-view-visible-count')).toHaveText('400,000');
    await panel.getByText('Transformations', { exact: true }).click();
    await panel.getByTestId('client-transform-affine').click();
    await expect(panel.getByTestId('client-view-revision')).toHaveText('2');
    await panel.getByText('Styles', { exact: true }).click();
    await panel.getByLabel('Client color mapping').selectOption('continuous');
    await panel.getByTestId('client-style-preset').click();
    await expect(panel.getByTestId('client-view-revision')).toHaveText('3');
    await expect.poll(async () => (await canvas.screenshot()).equals(baseline)).toBe(false);
    const state = await panel.getByTestId('client-view-state-json').textContent();
    expect(JSON.parse(state!).styles).toHaveLength(1);
    await page.screenshot({ path: test.info().outputPath(`${chart}-light.png`) });
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(panel.getByTestId('client-view-revision')).toHaveText('3');
    await page.screenshot({ path: test.info().outputPath(`${chart}-dark.png`) });
    await panel.getByTestId('client-view-reset').click();
    await expect(panel.getByTestId('client-view-visible-count')).toHaveText('1,000,000');
    await panel.getByLabel('Import client state JSON').fill(state!);
    await panel.getByRole('button', { name: 'Import state', exact: true }).click();
    await expect(panel.getByTestId('client-view-visible-count')).toHaveText('400,000');
    await panel.getByTestId('client-view-reset').click();
    expect(requests).toBe(0);
    page.off('request', requestListener);
    await expect(page.getByText('Preparing parallel plot', { exact: true })).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
