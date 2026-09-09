import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ClientDataView } from '../../packages/m-charts/src/client-data-view/index.ts';
import type { FastScatterPointColumns, FastScatterTheme } from '../../packages/m-charts/src/m-scatter/core/index.ts';
import type { FastScatterWebgpuPlotInstance } from '../../packages/m-charts/src/m-scatter-webgpu/index.ts';

declare global {
  interface Window {
    scatterRegression: {
      plot: FastScatterWebgpuPlotInstance;
      view?: ClientDataView;
      columns: FastScatterPointColumns;
      theme: FastScatterTheme;
      errors: string[];
      listenerErrors: string[];
      stylePageLoads: number;
    };
  }
}

const moduleUrl = `/@fs${resolve('packages/m-charts/src/m-scatter-webgpu/index.ts')}`;
const engineUrl = `/@fs${resolve('packages/m-charts/src/m-scatter/engine/createScatterEngine.ts')}`;
test.skip(process.env.M_CHARTS_ENABLE_WEBGPU_E2E !== '1', 'Requires an actual WebGPU adapter.');
test.beforeEach(async ({ page }) => { await page.goto('/'); });

async function mount(page: Page, options: {
  x?: number[];
  y?: number[];
  colors?: number[];
  view?: boolean;
  capacity?: number;
  xRange?: [number, number];
  throwingListener?: boolean;
  hoverIndex?: boolean;
  count?: number;
  pagedStyles?: boolean;
} = {}) {
  await page.evaluate(async ({ moduleUrl, options }) => {
    window.scatterRegression?.plot.dispose();
    const api = await import(moduleUrl) as typeof import('../../packages/m-charts/src/m-scatter-webgpu/index.ts');
    const host = document.createElement('div');
    host.style.cssText = 'width:800px;height:440px;position:relative;background:white;';
    document.body.style.cssText = 'margin:0;background:white;';
    document.body.replaceChildren(host);
    const x = options.x ?? (options.count === undefined ? [0, 1] : Array.from({ length: options.count }, (_, index) => index));
    const columns: FastScatterPointColumns = {
      ids: x.map((_, index) => String(index)),
      x: Float64Array.from(x),
      y: { value: Float64Array.from(options.y ?? x.map(() => 1)) },
      size: new Float32Array(x.length).fill(4),
      ...(options.colors === undefined ? {} : { color: Uint32Array.from(options.colors), colorFormat: 'rgba32' as const }),
    };
    const theme: FastScatterTheme = {
      alphaScaleMultiplier: 1, backgroundColor: [1, 1, 1, 1],
      defaultPointColor: [0, 128, 255, 255], selectedOverlayColor: [1, 0, 0, 1],
      subplotBackgroundColor: [1, 1, 1, 1],
    };
    const listenerErrors: string[] = [];
    const view = options.view ? api.createFastScatterClientDataView({
      columns, onListenerError: (error) => listenerErrors.push(String(error)),
    }) : undefined;
    if (options.throwingListener) view?.on('change', () => { throw new Error('Persistence failed'); });
    const range = options.xRange ?? [-1, 2];
    const plot = api.createScatterPlot(host, {
      columns, mode: 'select', axisMode: 'xy',
      hoverIndex: options.hoverIndex ? api.createFastScatterHoverIndex(columns, { xBinCount: 16, yBinCount: 16 }) : undefined,
      spec: { xLabel: 'X', plots: [{ id: 'value', yKey: 'value', label: 'Value' }] },
      theme, pointCapacity: options.capacity,
      packedStyles: options.pagedStyles ? {
        pointCount: x.length, maxPointSize: 4,
        async *createPages() {
          // Loading begins asynchronously after the fixture is published.
          window.scatterRegression.stylePageLoads += 1;
          const greenCircle = ((63 << 5) | (15 << 16) | (32 << 23) | (3 << 29)) >>> 0;
          for (let start = 0; start < x.length; start += 250_000) {
            yield { startPoint: start, data: new Uint32Array(Math.min(250_000, x.length - start)).fill(greenCircle) };
          }
        },
      } : undefined,
      viewport: { x: { min: range[0], max: range[1] }, yByPlot: { value: { min: 0, max: 2 } } },
      ...(view === undefined ? {} : { clientView: { view } }),
    });
    const errors: string[] = [];
    plot.on('renderstatechange', (event) => {
      if (event.state === 'error') errors.push(event.message ?? 'Unknown rendering error');
    });
    window.scatterRegression = { plot, view, columns, theme, errors, listenerErrors, stylePageLoads: 0 };
    await plot.ready;
  }, { moduleUrl, options });
  await settled(page);
}

async function settled(page: Page, revision?: number) {
  await expect.poll(() => page.evaluate(() => {
    const diagnostics = window.scatterRegression.plot.getWebgpuDiagnostics();
    return { cacheReady: diagnostics.cacheReady, revision: diagnostics.clientView?.revision };
  })).toMatchObject({ cacheReady: true, ...(revision === undefined ? {} : { revision }) });
  // Wait for browser presentation after the queue has completed.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => window.scatterRegression.errors)).toEqual([]);
}

let captureNumber = 0;
async function pixels(page: Page) {
  return page.locator('.scatter-fast-webgpu-canvas').screenshot({
    animations: 'disabled', path: test.info().outputPath(`canvas-${captureNumber++}.png`),
  });
}

test('empty client view preserves unsorted X rendering and source IDs', async ({ page }) => {
  const options = { x: [10, Number.NaN, Number.NEGATIVE_INFINITY, 0, 5, Number.POSITIVE_INFINITY], y: [1, 1, 1, 1, 1, 1], xRange: [9, 11] as [number, number] };
  await mount(page, options);
  const baseline = await pixels(page);
  await mount(page, { ...options, view: true });
  expect((await pixels(page)).equals(baseline)).toBe(true);
  expect(await page.evaluate(() => window.scatterRegression.columns.ids)).toEqual(['0', '1', '2', '3', '4', '5']);
});

test('conditional colors retain the theme across updates and style-base modes', async ({ page }) => {
  await mount(page, { colors: [0xff0000ff, 0x0080ffff] });
  const expected = await pixels(page);
  await mount(page, { view: true, throwingListener: true });
  await page.evaluate(() => window.scatterRegression.view!.addStyle({
    id: 'red', when: { op: 'eq', field: 'x', value: 0 },
    channels: { color: { op: 'constant', value: '#ff0000' } },
  }));
  await settled(page, 1);
  expect((await pixels(page)).equals(expected)).toBe(true);
  expect(await page.evaluate(() => window.scatterRegression.listenerErrors)).toHaveLength(1);
  await page.evaluate(() => {
    const { view } = window.scatterRegression;
    view!.replaceState({ ...view!.exportState(), sourceStyleMode: 'ignore' });
  });
  await settled(page, 2);
  expect((await pixels(page)).equals(expected)).toBe(true);
  await page.evaluate(() => {
    const fixture = window.scatterRegression;
    fixture.plot.update({ theme: { ...fixture.theme, defaultPointColor: [0, 255, 0, 255] } });
  });
  await settled(page, 2);
  const afterTheme = await pixels(page);
  await mount(page, { colors: [0xff0000ff, 0x00ff00ff] });
  expect(afterTheme.equals(await pixels(page))).toBe(true);
});

test('streamed capacity growth draws new rows without a client view', async ({ page }) => {
  const x = Array.from({ length: 65 }, (_, index) => index);
  await mount(page, { x, xRange: [60, 66] });
  const expected = await pixels(page);
  await mount(page, { x: [0], capacity: 1, xRange: [60, 66] });
  expect((await pixels(page)).equals(expected)).toBe(false);
  await page.evaluate(async ({ engineUrl, x }) => {
    const { appendFastScatterEngineData, finishFastScatterEngineData } = await import(engineUrl) as typeof import('../../packages/m-charts/src/m-scatter/engine/createScatterEngine.ts');
    const { plot } = window.scatterRegression;
    const columns = {
      ids: x.map(String), x: Float64Array.from(x),
      y: { value: new Float64Array(x.length).fill(1) }, size: new Float32Array(x.length).fill(4),
    };
    await appendFastScatterEngineData(plot, {
      columns, capacity: x.length, startPoint: 1,
      dataDomain: { x: { min: 0, max: 64 }, yByPlot: { value: { min: 0, max: 2 } } },
    });
    await finishFastScatterEngineData(plot);
  }, { engineUrl, x });
  await settled(page);
  expect((await pixels(page)).equals(expected)).toBe(true);
  expect(await page.evaluate(() => window.scatterRegression.plot.getWebgpuDiagnostics().pointCapacity)).toBe(65);
});

test('style-only edits reuse GPU coordinates and rapid updates settle on the final state', async ({ page }) => {
  const x = Array.from({ length: 100_000 }, (_, index) => index);
  await mount(page, { x, view: true, xRange: [0, 100_000] });
  await page.evaluate(() => window.scatterRegression.view!.addTransformation({
    id: 'scale', op: 'affine', input: 'value', output: 'value', factor: 0.5, offset: 0,
  }));
  await settled(page, 1);
  await page.evaluate(() => window.scatterRegression.view!.addStyle({
    id: 'color', channels: { color: { op: 'constant', value: '#ff0000' } },
  }));
  await settled(page, 2);
  expect(await page.evaluate(() => window.scatterRegression.plot.getWebgpuDiagnostics().clientView!.viewUploadBytes)).toBe(400_000);
  await page.evaluate(() => {
    const { view } = window.scatterRegression;
    for (let index = 0; index < 12; index += 1) {
      view!.updateTransformation('scale', {
        id: 'scale', op: 'affine', input: 'value', output: 'value', factor: index / 12, offset: 0,
      });
    }
    view!.replaceState({ ...view!.exportState(), transformations: [], styles: [], filters: [] });
  });
  await settled(page, 15);
  const reset = await pixels(page);
  await mount(page, { x, view: true, xRange: [0, 100_000] });
  expect((await pixels(page)).equals(reset)).toBe(true);
});


test('transformed hover discards the source spatial index and resets correctly', async ({ page }) => {
  await mount(page, { x: [0, 1], y: [0.25, 0.75], view: true, hoverIndex: true });
  await page.evaluate(() => window.scatterRegression.view!.addTransformation({
    id: 'shift', op: 'affine', input: 'value', output: 'value', factor: 1, offset: 1,
  }));
  await settled(page, 1);
  const hover = await page.evaluate(() => {
    const { plot } = window.scatterRegression;
    const rect = plot.commands.getPlotRectAtPoint(400, 220)!;
    return plot.commands.hoverAtPoint({
      pointerCssX: rect.xCssPx + rect.widthCssPx / 3,
      pointerCssY: rect.yCssPx + rect.heightCssPx * (1 - 1.25 / 2),
      source: 'shift-hover',
    });
  });
  expect(hover?.point.sourceIndex).toBe(0);
  await page.evaluate(() => window.scatterRegression.view!.removeTransformation('shift'));
  await settled(page, 2);
  expect(await page.evaluate(() => {
    const { plot } = window.scatterRegression;
    const rect = plot.commands.getPlotRectAtPoint(400, 220)!;
    return plot.commands.hoverAtPoint({
      pointerCssX: rect.xCssPx + rect.widthCssPx / 3,
      pointerCssY: rect.yCssPx + rect.heightCssPx * (1 - 0.25 / 2),
      source: 'shift-hover',
    });
  })).not.toBeNull();
});


test('large paged views preserve source styles, give sparse filters the full LOD budget, and reset', async ({ page }) => {
  test.setTimeout(120_000);
  const count = Number(process.env.M_CHARTS_SCATTER_LARGE_E2E_ROWS ?? 2_000_001);
  await mount(page, { count, view: true, pagedStyles: true, xRange: [-1, count] });
  const original = await pixels(page);
  await page.evaluate(() => window.scatterRegression.view!.addStyle({
    id: 'opacity', channels: { opacity: { op: 'constant', value: 1 } },
  }));
  await settled(page, 1);
  expect((await pixels(page)).equals(original)).toBe(true);
  await page.evaluate((count) => window.scatterRegression.view!.addFilter({
    id: 'last', predicate: { op: 'eq', field: 'x', value: count - 1 },
  }), count);
  await settled(page, 2);
  const sparse = await pixels(page);
  const diagnostics = await page.evaluate(() => window.scatterRegression.plot.getWebgpuDiagnostics());
  expect(diagnostics.lodPointCount).toBe(1);
  expect(diagnostics.clientView!.activePointCount).toBe(1);
  expect(diagnostics.clientView!.sourceUploadBytes).toBe(0);
  expect(sparse.equals(original)).toBe(false);
  await page.evaluate(() => window.scatterRegression.view!.addStyle({
    id: 'red', channels: { color: { op: 'constant', value: '#ff0000' } },
  }));
  await settled(page, 3);
  expect((await pixels(page)).equals(sparse)).toBe(false);
  await page.evaluate(() => {
    const { view } = window.scatterRegression;
    view!.replaceState({ ...view!.exportState(), filters: [], styles: [], transformations: [] });
  });
  await settled(page, 4);
  expect((await pixels(page)).equals(original)).toBe(true);
  expect(await page.evaluate(() => window.scatterRegression.stylePageLoads)).toBe(1);
});
