import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';
import {
  PARALLEL_ABOVE_VIEWPORT_DISPLAY_VALUE,
  PARALLEL_AXIS_MAX_DISPLAY_VALUE,
  PARALLEL_AXIS_MIN_DISPLAY_VALUE,
} from '../../packages/m-charts/src/m-parallel/core/index.ts';

const dataDir = 'apps/demo/public/data';

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  ensureData('scatter-fast-e2e.json', [
    '--kind',
    'scatter-fast',
    '--count',
    '1000',
    '--seed',
    '1',
    '--out',
    `${dataDir}/scatter-fast-e2e.json`,
    '--schema-out',
    `${dataDir}/scatter-fast-e2e-schema.json`,
  ]);
  ensureData('scatter-webgpu-10m.json', [
    '--kind',
    'scatter-webgpu',
    '--count',
    '10000',
    '--page-size',
    '2500',
    '--seed',
    '1',
    '--out',
    `${dataDir}/scatter-webgpu-10m.json`,
    '--schema-out',
    `${dataDir}/scatter-fast-schema.json`,
  ]);
  ensureData('scatter-webgpu-stream.json', [
    '--kind',
    'scatter-webgpu',
    '--count',
    '10000',
    '--page-size',
    '2500',
    '--seed',
    '1',
    '--out',
    `${dataDir}/scatter-webgpu-stream.json`,
    '--schema-out',
    `${dataDir}/scatter-fast-schema.json`,
  ]);
  ensureData('mixed-table-e2e.secondary.json', [
    '--kind',
    'mixed-tables',
    '--count',
    '1000',
    '--secondary-count',
    '100',
    '--seed',
    '1',
    '--out',
    `${dataDir}/mixed-table-e2e.json`,
    '--secondary-out',
    `${dataDir}/mixed-table-e2e.secondary.json`,
  ]);
  ensureData('parallel-e2e.json', [
    '--kind',
    'parallel',
    '--count',
    '500',
    '--seed',
    '1',
    '--out',
    `${dataDir}/parallel-e2e.json`,
  ]);
  ensureData('histogram-bars-sample.json', [
    '--kind',
    'histogram-bars',
    '--count',
    '36',
    '--seed',
    '1',
    '--out',
    `${dataDir}/histogram-bars-sample.json`,
  ]);
  if (process.env.M_CHARTS_ENABLE_PARALLEL_10M_E2E === '1') {
    ensureData('parallel-webgpu-10m-e2e.json', [
      '--kind',
      'scatter-webgpu',
      '--count',
      '10000000',
      '--page-size',
      '250000',
      '--seed',
      '1',
      '--out',
      `${dataDir}/parallel-webgpu-10m-e2e.json`,
      '--schema-out',
      `${dataDir}/parallel-webgpu-10m-e2e-schema.json`,
    ]);
  }
});

test('overview links only custom plot routes and preserves theme', async ({ page }) => {
  await page.goto('/?theme=dark&mode=hover&axis=x');

  await expect(
    page.getByRole('heading', {
      name: 'WebGL2 and WebGPU charts for fast, interactive exploration of large datasets.',
    }),
  ).toBeVisible();
  await expect(page.getByText('MIT license')).toBeVisible();
  await expect(page.getByRole('link', { name: 'MatthiasLettl/m-charts' })).toBeVisible();
  await expect(page.getByText('m-scatter WebGL2', { exact: true })).toBeVisible();
  await expect(page.getByText('m-parallel WebGL2', { exact: true })).toBeVisible();
  await expect(page.getByText('m-histogram WebGL2', { exact: true })).toBeVisible();
  await expect(page.locator('.prototype-card-title')).toHaveText([
    'm-scatter WebGL2',
    'm-scatter WebGPU',
    'm-histogram WebGL2',
    'm-histogram WebGPU',
    'm-parallel WebGL2',
    'm-parallel WebGPU',
  ]);
  const parallelWebgpuCard = page
    .locator('.prototype-card')
    .filter({ hasText: 'm-parallel WebGPU' });
  await expect(parallelWebgpuCard).toContainText('WebGL2-compatible interactions');
  await expect(parallelWebgpuCard).toContainText(
    'WebGPU computes pairwise density over every record',
  );
  await expect(
    parallelWebgpuCard.getByRole('link', { name: 'One table' }),
  ).toHaveAttribute(
    'href',
    '/m-parallel-webgpu?points=1000000&theme=dark',
  );
  await expect(
    parallelWebgpuCard.getByRole('link', { name: 'Multiple tables' }),
  ).toHaveAttribute(
    'href',
    '/m-parallel-webgpu?points=1000000&tables=multi&theme=dark',
  );
  const webgpuCard = page.locator('.prototype-card').filter({ hasText: 'm-scatter WebGPU' });
  await expect(webgpuCard.getByRole('link', { name: 'One table' })).toHaveAttribute(
    'href',
    '/m-scatter-webgpu?points=1000000&theme=dark',
  );
  await expect(webgpuCard.getByRole('link', { name: 'Multiple tables' })).toHaveAttribute(
    'href',
    '/m-scatter-webgpu?points=1000000&tables=multi&theme=dark',
  );
  await expect(webgpuCard.getByRole('link', { name: 'Streaming' })).toHaveAttribute(
    'href',
    '/m-scatter-webgpu?points=1000000&webgpuData=stream-local&theme=dark',
  );
  const histogramWebgpuCard = page
    .locator('.prototype-card')
    .filter({ hasText: 'm-histogram WebGPU' });
  await expect(histogramWebgpuCard.getByRole('link', { name: 'One table' })).toHaveAttribute(
    'href',
    '/m-histogram-webgpu?points=1000000&theme=dark',
  );
  await expect(
    histogramWebgpuCard.getByRole('link', { name: 'Multiple tables' }),
  ).toHaveAttribute(
    'href',
    '/m-histogram-webgpu?points=1000000&tables=multi&theme=dark',
  );

  await page.getByRole('link', { name: 'One table' }).first().click();
  await expect(page).toHaveURL(/\/m-scatter\?mode=hover&axis=x&theme=dark$/);

  await page.goto('/?theme=dark');
  await page.getByRole('link', { name: 'Multiple tables' }).first().click();
  await expect(page).toHaveURL('/m-scatter?tables=multi&theme=dark');

  await page.goto('/?theme=dark');
  await page
    .locator('.prototype-card')
    .filter({ hasText: 'm-histogram WebGL2' })
    .getByRole('link', { name: 'Pre-aggregated bars' })
    .click();
  await expect(page).toHaveURL('/m-histogram?histMode=bar&theme=dark');
});

test('m-histogram WebGPU route preserves the histogram surface and reports availability', async ({
  page,
}) => {
  await page.goto('/m-histogram-webgpu?histMode=bar&theme=dark');
  await expect(page.getByTestId('histogram-fast-route-host')).toBeVisible();
  await expect(
    page.locator('.histogram-fast-engine-host.histogram-fast-webgpu-host'),
  ).toHaveCount(1);
  await expect(
    page.locator('canvas.histogram-fast-engine-canvas.histogram-fast-webgpu-canvas'),
  ).toHaveCount(1);
  await expect(
    page.getByTestId('histogram-webgpu-input-mode').getByRole('radio', {
      name: 'Pre-aggregated bars',
    }),
  ).toBeChecked();
  const backendRadios = page
    .getByTestId('histogram-webgpu-aggregation-backend')
    .getByRole('radio');
  await expect(backendRadios).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(backendRadios.nth(index)).toBeDisabled();
  }
  await expect.poll(async () => {
    const state = await readHistogramState(page) as {
      binCount?: number;
      stackSegmentCount?: number;
    } | null;
    return (state?.stackSegmentCount ?? 0) > (state?.binCount ?? 0);
  }).toBe(true);
  await expect
    .poll(() => page.getByTestId('histogram-fast-route-host').getAttribute('data-render-state'))
    .toMatch(/^(ready|error)$/u);
});

test('m-histogram WebGPU opt-in renders the exact million-row WASM aggregation', async ({
  page,
}) => {
  test.setTimeout(180_000);
  test.skip(
    process.env.M_CHARTS_ENABLE_WEBGPU_E2E !== '1',
    'Set M_CHARTS_ENABLE_WEBGPU_E2E=1 on a WebGPU-capable machine.',
  );
  const gpuErrors: string[] = [];
  page.on('console', (message) => {
    if (
      (message.type() === 'error' || message.type() === 'warning') &&
      /WebGPU|GPUValidation|WGSL|Buffer.*usage/u.test(message.text())
    ) {
      gpuErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => gpuErrors.push(error.message));
  await page.goto(
    '/m-histogram-webgpu?points=1000000&aggregationBackend=rust-wasm',
    { waitUntil: 'domcontentloaded' },
  );
  const host = page.getByTestId('histogram-fast-route-host');
  await expect(host).toHaveAttribute('data-render-state', 'ready', { timeout: 60_000 });
  await expect(host).toHaveAttribute('data-record-count', '1000000');
  await expect.poll(() => readHistogramState(page)).toMatchObject({
    binCount: 70,
    histMode: 'histogram',
    parameterCount: 3,
    recordCount: 1_000_000,
    sourceIndicesAvailable: false,
  });
  await expect.poll(async () => {
    const state = await readHistogramState(page) as { stackSegmentCount?: number } | null;
    return state?.stackSegmentCount ?? 0;
  }).toBeGreaterThan(70);
  await expect.poll(() =>
    page.evaluate(() => {
      const hook = (globalThis as typeof globalThis & {
        __histogramFastBenchmarkTestHook?: {
          getMetricHistory(): readonly {
            drawCalls?: number;
            phase: string;
            visibleBinCount?: number;
          }[];
        };
      }).__histogramFastBenchmarkTestHook;
      return hook?.getMetricHistory().some(
        (metric) =>
          metric.phase === 'render' &&
          metric.drawCalls === 1 &&
          (metric.visibleBinCount ?? 0) > 0,
      ) ?? false;
    }),
  ).toBe(true);
  const initialViewport = await page.evaluate(
    () => window.__histogramFastRouteStateTestHook?.()?.viewport ?? null,
  );
  expect(initialViewport).not.toBeNull();
  const signalFrame = page.locator('.histogram-fast-overlay-plot-frame').last();
  const signalRect = await signalFrame.boundingBox();
  if (signalRect === null) throw new Error('WebGPU histogram plot frame is unavailable.');
  await page.mouse.move(
    signalRect.x + signalRect.width * 0.25,
    signalRect.y + signalRect.height * 0.35,
  );
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(
    signalRect.x + signalRect.width * 0.75,
    signalRect.y + signalRect.height * 0.55,
    { steps: 8 },
  );
  await page.mouse.up({ button: 'left' });
  await expect.poll(async () => JSON.stringify(
    await page.evaluate(
      () => window.__histogramFastRouteStateTestHook?.()?.viewport ?? null,
    ),
  )).not.toBe(JSON.stringify(initialViewport));
  await page.getByTestId('histogram-fast-reset-viewport').click();
  await expect.poll(async () => JSON.stringify(
    await page.evaluate(
      () => window.__histogramFastRouteStateTestHook?.()?.viewport ?? null,
    ),
  )).toBe(JSON.stringify(initialViewport));
  const selection = await page.evaluate(
    () => window.__histogramFastBenchmarkTestHook?.selectRectangleForBenchmark(),
  );
  expect(selection?.available).toBe(true);
  expect(selection?.selectedSourceCount ?? 0).toBeGreaterThan(0);
  expect(gpuErrors, gpuErrors.join('\n')).toEqual([]);
});

test('theme switch is URL backed on custom routes', async ({ page }) => {
  await page.goto(
    '/m-scatter?mode=hover&axis=x&__e2eScatterFastSchemaDataset=1&__e2eScatterFastSchemaDataUrl=/data/scatter-fast-e2e.json&__e2eScatterFastSchemaUrl=/data/scatter-fast-e2e-schema.json',
  );
  await expect(page.getByTestId('scatter-fast-chart-shell')).toHaveAttribute(
    'data-render-state',
    'ready',
  );
  await page.getByTestId('theme-mode-switch').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('theme')).toBe('dark');
  expect(new URL(page.url()).searchParams.get('mode')).toBe('hover');
  expect(new URL(page.url()).searchParams.get('axis')).toBe('x');
  await page.getByTestId('theme-mode-switch').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('theme')).toBeNull();
});

test('public chart pages expose overview link and hide package fixtures', async ({ page }) => {
  const routes = [
    {
      route:
        '/m-scatter?__e2eScatterFastSchemaDataset=1&__e2eScatterFastSchemaDataUrl=/data/scatter-fast-e2e.json&__e2eScatterFastSchemaUrl=/data/scatter-fast-e2e-schema.json',
      title: 'm-scatter',
    },
    {
      route: '/m-parallel?__e2eParallelFastDataset=/data/parallel-e2e.json',
      title: 'm-parallel',
    },
    {
      route: createHistogramUrl({}),
      title: 'm-histogram',
    },
  ];

  for (const { route, title } of routes) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'One table' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Multiple tables' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'How to interact' })).toBeVisible();
    await expect(page.locator('a[href*="-fixture"]')).toHaveCount(0);
  }
});

test('m-scatter routes render one table multi table and package fixture', async ({ page }) => {
  await page.goto(
    '/m-scatter?__e2ePreserveDrawingBuffer=1&__e2eScatterFastSchemaDataset=1&__e2eScatterFastSchemaDataUrl=/data/scatter-fast-e2e.json&__e2eScatterFastSchemaUrl=/data/scatter-fast-e2e-schema.json',
  );
  await expect(page.getByTestId('scatter-fast-chart-shell')).toBeVisible();
  await expect(page.getByTestId('scatter-fast-route-diagnostics')).toContainText('WebGL2 points');
  await assertCanvasNonBlank(page, '.scatter-fast-webgl-canvas');

  await page.goto(
    '/m-scatter?tables=multi&__e2ePreserveDrawingBuffer=1&__e2eFastTableFixture=/data/mixed-table-e2e.json',
  );
  await expect(page.getByTestId('scatter-fast-chart-shell')).toBeVisible();
  await expect(page.getByTestId('scatter-fast-dataset-diagnostics')).toContainText('primary');

  await page.goto('/m-scatter-fixture?theme=dark');
  await expect(page.getByTestId('scatter-fast-fixture')).toBeVisible();
  await expect(page.getByTestId('scatter-fast-chart-shell')).toHaveAttribute(
    'data-renderer',
    'webgl2-points',
  );
});

test('m-scatter WebGPU route exposes the dedicated backend or a useful availability error', async ({
  page,
}) => {
  await page.goto('/m-scatter-webgpu?points=1000&mode=pan&axis=xy&webgpuData=http');
  const chart = page.getByTestId('scatter-fast-chart-shell');
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAttribute('data-renderer', 'webgpu-points');
  await expect(chart).toHaveAttribute('data-record-count', '1000');
  await expect(
    page.locator('.scatter-fast-engine-host.scatter-fast-webgpu-host'),
  ).toHaveCount(1);
  await expect(
    page.locator('canvas.scatter-fast-engine-canvas.scatter-fast-webgpu-canvas'),
  ).toHaveCount(1);
  await expect(page.getByTestId('scatter-fast-dataset-source-format')).toHaveText(
    'paged-webgpu-binary',
  );
  await expect(page.getByTestId('scatter-fast-hit-region')).toHaveCount(3);
  await expect
    .poll(async () => chart.getAttribute('data-render-state'), { timeout: 30_000 })
    .toMatch(/^(ready|error)$/u);

  const state = await chart.getAttribute('data-render-state');
  if (state === 'error') {
    await expect(page.getByTestId('scatter-fast-render-error')).toContainText(/WebGPU|GPU adapter/u);
  } else {
    await expect(page.locator('[data-testid="scatter-fast-webgpu-canvas"]')).toHaveCount(1);
  }
});

test('m-scatter WebGPU streaming is integrated and preserves its viewport', async ({
  page,
}) => {
  const localPointCount = Number(process.env.M_CHARTS_STREAM_E2E_POINTS ?? 1_000_000);
  const validatePartialLargeStream = localPointCount >= 10_000_000 &&
    process.env.M_CHARTS_STREAM_E2E_FULL !== '1';
  test.setTimeout(localPointCount > 1_000_000 ? 600_000 : 120_000);
  await page.goto('/m-scatter-webgpu-streaming?points=1000');
  await expect(page).toHaveURL(/\/m-scatter-webgpu\?.*webgpuData=stream-local/u);

  await page.goto(
    '/m-scatter-webgpu-streaming?webgpuData=stream-http&xMin=100&xMax=500',
  );
  await expect(page).toHaveURL(/\/m-scatter-webgpu\?/u);
  const chart = page.getByTestId('scatter-fast-chart-shell');
  const diagnostics = page.getByTestId('scatter-fast-route-diagnostics');
  await expect(chart).toBeVisible();
  await expect(diagnostics).toHaveAttribute('data-webgpu-dataset-mode', 'stream');
  await expect(diagnostics).toHaveAttribute('data-webgpu-stream-kind', 'http');
  await expect(page.getByTestId('scatter-webgpu-table-mode')).toContainText('Streaming');
  await expect(page.getByTestId('scatter-webgpu-stream-source')).toContainText('HTTP pages');
  await expect(page.getByTestId('scatter-fast-hit-region')).toHaveCount(3);
  const httpStreamCount = await page.evaluate(async () => {
    const response = await fetch('/data/scatter-webgpu-stream.json');
    return ((await response.json()) as { count: number }).count;
  });
  await expect
    .poll(async () => chart.getAttribute('data-render-state'), { timeout: 30_000 })
    .toMatch(/^(ready|error)$/u);

  const status = await chart.getAttribute('data-render-state');
  if (process.env.M_CHARTS_ENABLE_WEBGPU_E2E === '1') {
    expect(status).toBe('ready');
  }
  if (status === 'ready') {
    await expect(diagnostics).toHaveAttribute('data-webgpu-stream-status', 'complete', {
      timeout: 30_000,
    });
    await expect(chart).toHaveAttribute('data-record-count', String(httpStreamCount));
    expect(new URL(page.url()).searchParams.get('xMin')).toBe('100');
    expect(new URL(page.url()).searchParams.get('xMax')).toBe('500');

    await page.addInitScript(() => {
      const state = {
        lastFrameAt: 0,
        maxFrameGapMs: 0,
        maxLongTaskMs: 0,
      };
      (globalThis as typeof globalThis & {
        __scatterStreamResponsiveness?: typeof state;
      }).__scatterStreamResponsiveness = state;
      const measureFrame = (at: number) => {
        if (state.lastFrameAt > 0) {
          state.maxFrameGapMs = Math.max(state.maxFrameGapMs, at - state.lastFrameAt);
        }
        state.lastFrameAt = at;
        requestAnimationFrame(measureFrame);
      };
      requestAnimationFrame(measureFrame);
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.maxLongTaskMs = Math.max(state.maxLongTaskMs, entry.duration);
        }
      }).observe({ entryTypes: ['longtask'] });
    });
    await page.goto(
      `/m-scatter-webgpu?webgpuData=stream-local&points=${localPointCount}&__e2eScatterFastRouteStateHook=1`,
    );
    const localChart = page.getByTestId('scatter-fast-chart-shell');
    const localDiagnostics = page.getByTestId('scatter-fast-route-diagnostics');
    await expect(localDiagnostics).toHaveAttribute('data-webgpu-stream-kind', 'local');
    await expect(localChart).toHaveAttribute('data-render-state', 'ready', { timeout: 120_000 });
    await page.evaluate(() => {
      const state = (globalThis as typeof globalThis & {
        __scatterStreamResponsiveness?: {
          lastFrameAt: number;
          maxFrameGapMs: number;
          maxLongTaskMs: number;
        };
      }).__scatterStreamResponsiveness;
      if (state !== undefined) {
        state.lastFrameAt = performance.now();
        state.maxFrameGapMs = 0;
        state.maxLongTaskMs = 0;
      }
    });
    if (localPointCount >= 10_000_000) {
      await expect.poll(async () => Number(
        await page.getByTestId('scatter-webgpu-stream-progress').getAttribute('data-loaded-count'),
      ), { timeout: 120_000 }).toBeGreaterThanOrEqual(1_000_000);
      const streamingXSpan = await getScatterFastViewportXSpan(page);
      const streamingHitRegion = page.getByTestId('scatter-fast-hit-region').last();
      const streamingHitBox = await streamingHitRegion.boundingBox();
      if (streamingHitBox === null) {
        throw new Error('Streaming WebGPU hit region is unavailable during ingestion.');
      }
      await page.mouse.move(
        streamingHitBox.x + streamingHitBox.width / 2,
        streamingHitBox.y + streamingHitBox.height / 2,
      );
      await page.keyboard.down('Alt');
      await page.mouse.wheel(0, -400);
      await page.keyboard.up('Alt');
      await expect.poll(() => getScatterFastViewportXSpan(page), { timeout: 2_000 })
        .toBeLessThan(streamingXSpan);
      await page.getByRole('button', { name: 'Reset viewport' }).click();
      await expect.poll(async () => Number(
        await page.getByTestId('scatter-webgpu-stream-progress').getAttribute('data-loaded-count'),
      ), { timeout: 120_000 }).toBeGreaterThanOrEqual(2_000_000);
      const responsiveness = await getScatterStreamResponsiveness(page);
      expect(responsiveness.maxLongTaskMs).toBeLessThan(250);
      expect(responsiveness.maxFrameGapMs).toBeLessThan(500);
      if (validatePartialLargeStream) {
        await page.goto('/');
        return;
      }
    }
    await expect(localDiagnostics).toHaveAttribute('data-webgpu-stream-status', 'complete', {
      timeout: localPointCount > 1_000_000 ? 480_000 : 120_000,
    });
    await expect(localChart).toHaveAttribute('data-record-count', String(localPointCount));
    await expect.poll(() => page.evaluate(() => {
      const hook = (globalThis as typeof globalThis & {
        __scatterFastRouteStateTestHook?: {
          getWebgpuDiagnostics(): { cacheReady: boolean } | null;
        };
      }).__scatterFastRouteStateTestHook;
      return hook?.getWebgpuDiagnostics()?.cacheReady ?? false;
    })).toBe(true);

    const initialXSpan = await getScatterFastViewportXSpan(page);
    const hitRegion = page.getByTestId('scatter-fast-hit-region').last();
    const hitBox = await hitRegion.boundingBox();
    if (hitBox === null) throw new Error('Streaming WebGPU hit region is unavailable.');
    await page.mouse.move(hitBox.x + hitBox.width / 2, hitBox.y + hitBox.height / 2);
    await page.keyboard.down('Alt');
    await page.mouse.wheel(0, -400);
    await page.keyboard.up('Alt');
    await expect.poll(() => getScatterFastViewportXSpan(page), { timeout: 2_000 })
      .toBeLessThan(initialXSpan);
  } else {
    await expect(page.getByTestId('scatter-fast-render-error')).toContainText(/WebGPU|GPU adapter/u);
  }
});

async function getScatterStreamResponsiveness(page: Page): Promise<{
  maxFrameGapMs: number;
  maxLongTaskMs: number;
}> {
  const responsiveness = await page.evaluate(() =>
    (globalThis as typeof globalThis & {
      __scatterStreamResponsiveness?: {
        maxFrameGapMs: number;
        maxLongTaskMs: number;
      };
    }).__scatterStreamResponsiveness ?? null,
  );
  if (responsiveness === null) {
    throw new Error('Streaming responsiveness instrumentation is unavailable.');
  }
  return responsiveness;
}

async function getScatterFastViewportXSpan(page: Page): Promise<number> {
  const span = await page.evaluate(() => {
    const hook = (globalThis as typeof globalThis & {
      __scatterFastRouteStateTestHook?: {
        getFastViewport(): { x: { max: number; min: number } } | null;
      };
    }).__scatterFastRouteStateTestHook;
    const x = hook?.getFastViewport()?.x;
    return x === undefined ? null : x.max - x.min;
  });
  if (span === null) throw new Error('Fast scatter viewport is unavailable.');
  return span;
}

test('m-scatter WebGPU combines its selected primary size with the fixed secondary table', async ({
  page,
}) => {
  await page.goto(
    '/m-scatter-webgpu?points=1000&tables=multi&webgpuData=http&__e2eFastTableFixture=/data/mixed-table-e2e.json',
  );
  const chart = page.getByTestId('scatter-fast-chart-shell');
  const diagnostics = page.getByTestId('scatter-fast-route-diagnostics');
  await expect(chart).toHaveAttribute('data-record-count', '1100', { timeout: 30_000 });
  await expect(diagnostics).toHaveAttribute('data-table-mode', 'multi');
  await expect(diagnostics).toHaveAttribute('data-table-count', '2');
  await expect(diagnostics).toHaveAttribute(
    'data-table-record-counts',
    'benchmark-primary:1000,benchmark-secondary:100',
  );
  await expect(page.getByTestId('scatter-fast-hit-region')).toHaveCount(5);
  await expect(page.getByTestId('scatter-fast-x-axis')).toContainText(
    'Secondary signal',
  );

  const datasetDetails = page.getByTestId('scatter-webgpu-dataset-details');
  await expect(datasetDetails).not.toHaveAttribute('open', '');
  await datasetDetails.getByText('Dataset details', { exact: true }).click();
  await expect(datasetDetails).toHaveAttribute('open', '');
  await expect(datasetDetails).toContainText(
    'Denser views use a deterministic representative sample',
  );

  const tableModeControl = page.getByTestId('scatter-webgpu-table-mode');
  await expect(tableModeControl.getByRole('button', { name: 'Multiple tables' }))
    .toHaveClass(/is-active/u);
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __webgpuDocumentMarker?: string })
      .__webgpuDocumentMarker = 'old-document';
  });
  await tableModeControl.getByRole('button', { name: 'Single table' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('tables')).toBeNull();
  await expect.poll(() => page.evaluate(() =>
    (globalThis as typeof globalThis & { __webgpuDocumentMarker?: string })
      .__webgpuDocumentMarker ?? null,
  )).toBeNull();
  await expect(chart).toHaveAttribute('data-record-count', '1000', { timeout: 30_000 });
  await expect(diagnostics).toHaveAttribute('data-table-mode', 'single');

  await tableModeControl.getByRole('button', { name: 'Multiple tables' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('tables')).toBe('multi');
  await expect(chart).toHaveAttribute('data-record-count', '1100', { timeout: 30_000 });
  await expect(diagnostics).toHaveAttribute('data-table-mode', 'multi');

  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __webgpuDocumentMarker?: string })
      .__webgpuDocumentMarker = 'old-document';
  });
  await page.getByRole('button', { name: 'X index' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('xMode')).toBe('index');
  await expect.poll(() => page.evaluate(() =>
    (globalThis as typeof globalThis & { __webgpuDocumentMarker?: string })
      .__webgpuDocumentMarker ?? null,
  )).toBeNull();
  await expect(chart).toHaveAttribute('data-record-count', '1100');

  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __webgpuDocumentMarker?: string })
      .__webgpuDocumentMarker = 'old-document';
  });
  await page.getByTestId('scatter-fast-x-axis').selectOption('secondarySignal');
  await expect.poll(() => new URL(page.url()).searchParams.get('xAxis'))
    .toBe('secondarySignal');
  expect(new URL(page.url()).searchParams.get('xMode')).toBe('value');
  await expect.poll(() => page.evaluate(() =>
    (globalThis as typeof globalThis & { __webgpuDocumentMarker?: string })
      .__webgpuDocumentMarker ?? null,
  )).toBeNull();
  await expect(chart).toHaveAttribute('data-record-count', '1100');
});

test('m-scatter WebGPU generates, reuses, switches, and deletes its browser-local dataset', async ({
  page,
}) => {
  await page.goto('/m-scatter-webgpu?points=1000&theme=dark');
  await expect(page.getByTestId('scatter-webgpu-dataset-setup')).toBeVisible();
  await page.getByTestId('scatter-webgpu-generate-dataset').click();
  await expect(page.getByTestId('scatter-fast-chart-shell')).toHaveAttribute(
    'data-record-count',
    '1000',
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('scatter-fast-dataset-source-format')).toHaveText(
    'indexeddb-webgpu-binary',
  );

  await page.reload();
  await expect(page.getByTestId('scatter-fast-chart-shell')).toHaveAttribute(
    'data-record-count',
    '1000',
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('scatter-webgpu-dataset-setup')).toHaveCount(0);

  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __webgpuDocumentMarker?: string })
      .__webgpuDocumentMarker = 'old-document';
  });
  await page.getByTestId('scatter-webgpu-dataset-size').getByRole('button', {
    name: '1M',
  }).click();
  await expect(page).toHaveURL(/points=1000000/u);
  expect(new URL(page.url()).searchParams.get('theme')).toBe('dark');
  await expect(page.getByTestId('scatter-webgpu-dataset-setup')).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    (globalThis as typeof globalThis & { __webgpuDocumentMarker?: string })
      .__webgpuDocumentMarker ?? null,
  )).toBeNull();

  await page.goto('/m-scatter-webgpu?points=1000&theme=dark');
  await expect(page.getByTestId('scatter-fast-chart-shell')).toHaveAttribute(
    'data-record-count',
    '1000',
    { timeout: 30_000 },
  );
  await page.getByTestId('scatter-webgpu-delete-dataset').click();
  await expect(page.getByTestId('scatter-webgpu-dataset-setup')).toBeVisible();
});

test('m-scatter WebGPU opt-in renders and preserves pan and selection interactions', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const gpuErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /WebGPU|GPUValidation|WGSL/u.test(message.text())) {
      gpuErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => gpuErrors.push(error.message));
  test.skip(
    process.env.M_CHARTS_ENABLE_WEBGPU_E2E !== '1',
    'Set M_CHARTS_ENABLE_WEBGPU_E2E=1 on a WebGPU-capable machine.',
  );
  await page.goto(
    '/m-scatter-webgpu?points=10000&mode=pan&axis=xy&__e2eScatterFastSelectionHook=1&__e2eScatterFastRouteStateHook=1',
  );
  await page.getByTestId('scatter-webgpu-generate-dataset').click();
  const chart = page.getByTestId('scatter-fast-chart-shell');
  await expect(chart).toHaveAttribute('data-render-state', 'ready', { timeout: 60_000 });
  await page.evaluate(() => {
    const hook = (globalThis as typeof globalThis & {
      __scatterFastRouteStateTestHook?: {
        setSelectedSourceIndices(sourceIndices: Uint32Array): void;
      };
    }).__scatterFastRouteStateTestHook;
    hook?.setSelectedSourceIndices(Uint32Array.from({ length: 1000 }, (_, index) => index));
  });
  await expect.poll(() => page.evaluate(() => {
    const hook = (globalThis as typeof globalThis & {
      __scatterFastRouteStateTestHook?: {
        getWebgpuDiagnostics(): { selectedStorageMode: string } | null;
      };
    }).__scatterFastRouteStateTestHook;
    return hook?.getWebgpuDiagnostics()?.selectedStorageMode ?? null;
  })).toBe('bitset');
  const hitRegion = page.getByTestId('scatter-fast-hit-region').first();
  const box = await hitRegion.boundingBox();
  if (box === null) throw new Error('WebGPU scatter hit region is unavailable.');
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await expect
    .poll(() =>
      page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-drag-pan-ms'),
    )
    .not.toBe('pending');

  await page.goto(
    '/m-scatter-webgpu?points=10000&mode=select&axis=xy&__e2eScatterFastSelectionHook=1',
  );
  await expect(chart).toHaveAttribute('data-render-state', 'ready', { timeout: 60_000 });
  await expect(chart).toHaveAttribute('data-mode', 'select');
  const selectionBox = await page.getByTestId('scatter-fast-hit-region').first().boundingBox();
  if (selectionBox === null) throw new Error('WebGPU selection hit region is unavailable.');
  // The center of this size-relative fixture is in the steady phase, so keep
  // both the X range and categorical Y band inside that populated region.
  await page.mouse.move(selectionBox.x + selectionBox.width * 0.45, selectionBox.y + selectionBox.height * 0.3);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(selectionBox.x + selectionBox.width * 0.75, selectionBox.y + selectionBox.height * 0.45, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await expect
    .poll(() => page.evaluate(() =>
      (globalThis as typeof globalThis & {
        __scatterFastSelectionTestHook?: { getSelectedCount(): number };
      }).__scatterFastSelectionTestHook?.getSelectedCount() ?? 0,
    ))
    .toBeGreaterThan(0);

  for (const visualizationMode of ['bubble', 'heatmap'] as const) {
    await page.goto(
      `/m-scatter-webgpu?points=10000&mode=${visualizationMode === 'heatmap' ? 'select' : 'pan'}&axis=xy&viz=${visualizationMode}&__e2eScatterFastSelectionHook=1&__e2eScatterFastRouteStateHook=1`,
    );
    await expect(chart).toHaveAttribute('data-render-state', 'ready', { timeout: 60_000 });
    await expect(page.getByTestId('scatter-fast-route-diagnostics')).toHaveAttribute(
      'data-visualization-mode',
      visualizationMode,
    );
    await expect(page.getByTestId('scatter-fast-webgpu-canvas')).toHaveAttribute(
      'data-renderer',
      `webgpu-${visualizationMode}`,
    );
    await expect.poll(() => page.evaluate(() => {
      const hook = (globalThis as typeof globalThis & {
        __scatterFastRouteStateTestHook?: {
          getWebgpuDiagnostics(): { aggregationBackend: string } | null;
        };
      }).__scatterFastRouteStateTestHook;
      return hook?.getWebgpuDiagnostics()?.aggregationBackend ?? null;
    })).toBe('rust-wasm');
    await expect(page.getByTestId('scatter-fast-route-diagnostics')).toHaveAttribute(
      'data-aggregate-backend-preference',
      'auto',
    );
    const activeBackendIndicator = page.getByTestId(
      'scatter-fast-aggregation-backend-active-indicator',
    );
    await expect(activeBackendIndicator).toHaveAttribute('data-backend', 'rust-wasm');
    await expect(activeBackendIndicator).toHaveText('Running now: Rust/WASM');
    const backendSelector = page.getByTestId('scatter-fast-aggregation-backend-select');
    await backendSelector.getByRole('radio', { name: 'TypeScript' }).click();
    await expect(
      backendSelector.getByRole('radio', { name: 'TypeScript' }),
    ).toBeChecked();
    await expect(chart).toHaveAttribute('data-render-state', 'ready', { timeout: 60_000 });
    await expect(page).toHaveURL(/aggregationBackend=typescript/u);
    await expect(page.getByTestId('scatter-fast-route-diagnostics')).toHaveAttribute(
      'data-aggregate-backend-preference',
      'typescript',
    );
    await expect.poll(() => page.evaluate(() => {
      const hook = (globalThis as typeof globalThis & {
        __scatterFastRouteStateTestHook?: {
          getWebgpuDiagnostics(): {
            aggregationBackend: string;
            aggregationBackendPreference: string;
          } | null;
        };
      }).__scatterFastRouteStateTestHook;
      const diagnostics = hook?.getWebgpuDiagnostics();
      return diagnostics === null || diagnostics === undefined
        ? null
        : `${diagnostics.aggregationBackendPreference}/${diagnostics.aggregationBackend}`;
    })).toBe('typescript/typescript');
    await expect(activeBackendIndicator).toHaveAttribute('data-backend', 'typescript');
    await expect(activeBackendIndicator).toHaveText('Running now: TypeScript');
    await backendSelector.getByRole('radio', { name: 'Rust/WASM' }).click();
    await expect(
      backendSelector.getByRole('radio', { name: 'Rust/WASM' }),
    ).toBeChecked();
    await expect(chart).toHaveAttribute('data-render-state', 'ready', { timeout: 60_000 });
    await expect(page).toHaveURL(/aggregationBackend=rust-wasm/u);
    await expect.poll(() => page.evaluate(() => {
      const hook = (globalThis as typeof globalThis & {
        __scatterFastRouteStateTestHook?: {
          getWebgpuDiagnostics(): {
            aggregationBackend: string;
            aggregationBackendPreference: string;
          } | null;
        };
      }).__scatterFastRouteStateTestHook;
      const diagnostics = hook?.getWebgpuDiagnostics();
      return diagnostics === null || diagnostics === undefined
        ? null
        : `${diagnostics.aggregationBackendPreference}/${diagnostics.aggregationBackend}`;
    })).toBe('rust-wasm/rust-wasm');
    await expect(activeBackendIndicator).toHaveAttribute('data-backend', 'rust-wasm');
    await expect(activeBackendIndicator).toHaveText('Running now: Rust/WASM');
    const aggregateAttribute = visualizationMode === 'bubble'
      ? 'data-aggregate-count'
      : 'data-aggregate-populated-cell-count';
    await expect.poll(async () => Number(
      await page.getByTestId('scatter-fast-route-diagnostics').getAttribute(aggregateAttribute),
    )).toBeGreaterThan(0);
    if (visualizationMode === 'heatmap') {
      const heatmapRegion = await page.getByTestId('scatter-fast-hit-region').first().boundingBox();
      if (heatmapRegion === null) throw new Error('WebGPU heatmap hit region is unavailable.');
      await page.mouse.move(
        heatmapRegion.x + heatmapRegion.width * 0.45,
        heatmapRegion.y + heatmapRegion.height * 0.3,
      );
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(
        heatmapRegion.x + heatmapRegion.width * 0.75,
        heatmapRegion.y + heatmapRegion.height * 0.45,
        { steps: 5 },
      );
      await page.mouse.up({ button: 'right' });
      await expect.poll(() => page.evaluate(() =>
        (globalThis as typeof globalThis & {
          __scatterFastSelectionTestHook?: { getSelectedCount(): number };
        }).__scatterFastSelectionTestHook?.getSelectedCount() ?? 0,
      )).toBeGreaterThan(0);
    }
  }

  await page.goto('/m-scatter-webgpu-fixture');
  const fixture = page.getByTestId('scatter-fast-chart-shell');
  await expect(fixture).toHaveAttribute('data-renderer', 'webgpu-points');
  await expect(fixture).toHaveAttribute('data-render-state', 'ready');
  await expect(fixture).toHaveAttribute('data-selected-count', '3');
  expect(gpuErrors, gpuErrors.join('\n')).toEqual([]);
});

test('m-scatter aggregate modes render sparse alternate x-axis values', async ({ page }) => {
  for (const mode of ['bubble', 'heatmap'] as const) {
    await page.goto(
      `/m-scatter?tables=multi&xAxis=secondarySignal&xMode=value&mode=pan&axis=xy&viz=${mode}&__e2ePreserveDrawingBuffer=1&__e2eFastTableFixture=/data/mixed-table-e2e.json`,
    );
    await expect(page.getByTestId('scatter-fast-chart-shell')).toBeVisible();
    await expect(page.getByTestId('scatter-fast-route-diagnostics')).toHaveAttribute(
      'data-visualization-mode',
      mode,
    );
    await expect
      .poll(() =>
        page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-aggregate-status'),
      )
      .toBe('ready');
    await expect
      .poll(() =>
        page.getByTestId('scatter-fast-route-diagnostics').evaluate((element, mode) => {
          const attribute =
            mode === 'bubble'
              ? 'data-aggregate-count'
              : 'data-aggregate-populated-cell-count';
          return Number(element.getAttribute(attribute) ?? 0);
        }, mode),
      )
      .toBeGreaterThan(0);
    await assertCanvasHasNonBackgroundPixels(page, '.scatter-fast-webgl-canvas');
  }
});

test('m-parallel routes render one table multi table and package fixture', async ({ page }) => {
  await page.goto(
    '/m-parallel?__e2ePreserveDrawingBuffer=1&__e2eParallelFastDataset=/data/parallel-e2e.json',
  );
  await expect(page.getByTestId('parallel-fast-chart-layout')).toBeVisible();
  await expect(page.getByTestId('parallel-fast-route-diagnostics')).toContainText('WebGL2');
  await expect(page.getByTestId('parallel-viewport-status')).toHaveText(
    'All axes at full range',
  );
  await expect(page.getByTestId('parallel-reset-viewport')).toBeDisabled();
  await assertCanvasNonBlank(page, '.parallel-fast-webgl-canvas');

  await page.goto(
    '/m-parallel?tables=multi&__e2ePreserveDrawingBuffer=1&__e2eFastTableFixture=/data/mixed-table-e2e.json',
  );
  await expect(page.getByTestId('parallel-fast-chart-layout')).toBeVisible();
  await expect(page.getByTestId('parallel-fast-route-diagnostics')).toHaveAttribute(
    'data-table-mode',
    'multi',
  );

  await page.goto('/m-parallel-fixture?theme=dark');
  await expect(page.getByTestId('parallel-fast-chart-layout')).toBeVisible();
  await expect(page.getByTestId('parallel-fast-fixture-axis-overlay')).toBeVisible();
});

test('m-parallel WebGPU matches shared dataset controls and reload behavior', async ({
  page,
}) => {
  await page.goto('/m-parallel-webgpu?points=1000000&theme=dark');
  await expect(page.getByTestId('parallel-webgpu-dataset-setup')).toBeVisible();
  const sizeControl = page.getByTestId('parallel-webgpu-point-count');
  await expect(sizeControl.getByRole('button', { name: '1M' })).toHaveClass(/is-active/u);
  await expect(
    page.getByTestId('parallel-webgpu-table-mode').getByRole('button', {
      name: 'Single table',
    }),
  ).toHaveClass(/is-active/u);
  const details = page.getByTestId('parallel-webgpu-dataset-details');
  await details.getByText('Dataset details', { exact: true }).click();
  await expect(details).toContainText('complete source data');

  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __parallelDocumentMarker?: string })
      .__parallelDocumentMarker = 'old-document';
  });
  await sizeControl.getByRole('button', { name: '10M' }).click();
  await expect(page).toHaveURL(/points=10000000/u);
  expect(new URL(page.url()).searchParams.get('theme')).toBe('dark');
  await expect.poll(() => page.evaluate(() =>
    (globalThis as typeof globalThis & { __parallelDocumentMarker?: string })
      .__parallelDocumentMarker ?? null,
  )).toBeNull();
  await expect(page.getByTestId('parallel-webgpu-dataset-setup')).toBeVisible();

  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __parallelDocumentMarker?: string })
      .__parallelDocumentMarker = 'old-document';
  });
  await page.getByTestId('parallel-webgpu-table-mode').getByRole('button', {
    name: 'Multiple tables',
  }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('tables')).toBe('multi');
  await expect.poll(() => page.evaluate(() =>
    (globalThis as typeof globalThis & { __parallelDocumentMarker?: string })
      .__parallelDocumentMarker ?? null,
  )).toBeNull();
});

test('m-parallel WebGPU loads a stored 10M dataset without a tab crash', async ({
  page,
}) => {
  test.setTimeout(300_000);
  test.skip(
    process.env.M_CHARTS_ENABLE_PARALLEL_10M_E2E !== '1',
    'Set M_CHARTS_ENABLE_PARALLEL_10M_E2E=1 for the large browser-memory gate.',
  );
  const gpuErrors: string[] = [];
  page.on('console', (message) => {
    if (
      (message.type() === 'error' || message.type() === 'warning') &&
      /WebGPU|GPUValidation|WGSL|Buffer.*usage/u.test(message.text())
    ) {
      gpuErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => gpuErrors.push(error.message));
  const pointCount = 10_000_000;
  await page.goto(
    `/m-parallel-webgpu?points=${pointCount}&webgpuData=http&__e2eParallelFastBrushHook=1&__e2eParallelWebgpuManifest=/data/parallel-webgpu-10m-e2e.json`,
  );
  const chart = page.getByTestId('parallel-fast-chart-layout');
  await expect(chart).toHaveAttribute('data-record-count', String(pointCount), {
    timeout: 240_000,
  });
  await expect
    .poll(async () => {
      const state = await chart.getAttribute('data-render-state');
      if (state === 'error' && process.env.M_CHARTS_ENABLE_WEBGPU_E2E === '1') {
        const alert = await page.getByRole('alert').textContent();
        throw new Error(
          [alert, ...gpuErrors].filter((message) => message !== null).join('\n'),
        );
      }
      return state;
    }, { timeout: 240_000 })
    .toBe(
      process.env.M_CHARTS_ENABLE_WEBGPU_E2E === '1' ? 'ready' : 'error',
    );
  await expect(page.getByTestId('parallel-webgpu-point-count')).toBeVisible();
  await expect(page.getByTestId('parallel-webgpu-table-mode')).toBeVisible();
  if (process.env.M_CHARTS_ENABLE_WEBGPU_E2E === '1') {
    await expect.poll(() => page.evaluate(() => {
      return (
        window as typeof window & {
          __parallelFastPrototypeTestHooks?: {
            getWebgpuDiagnostics: () => { densityVisible: boolean } | null;
          };
        }
      ).__parallelFastPrototypeTestHooks?.getWebgpuDiagnostics()
        ?.densityVisible ?? false;
    }), { timeout: 240_000 }).toBe(true);
    const initialDiagnostics = await page.evaluate(() => {
      return (
        window as typeof window & {
          __parallelFastPrototypeTestHooks?: {
            getWebgpuDiagnostics: () => {
              coordinateQuantizationBits: number;
              refinedCoordinatePrecisionBits: number;
              densityVisible: boolean;
              hoverSearchRecordCount: number;
              lastAggregationMs: number;
              lastAggregationPairCount: number;
              representativeRecordCount: number;
              uploadBytes: number;
            } | null;
          };
        }
      ).__parallelFastPrototypeTestHooks?.getWebgpuDiagnostics() ?? null;
    });
    expect(initialDiagnostics).not.toBeNull();
    expect(initialDiagnostics?.coordinateQuantizationBits).toBe(16);
    expect(initialDiagnostics?.refinedCoordinatePrecisionBits).toBe(32);
    expect(initialDiagnostics?.densityVisible).toBe(true);
    expect(initialDiagnostics?.hoverSearchRecordCount).toBe(
      initialDiagnostics?.representativeRecordCount,
    );
    expect(initialDiagnostics!.hoverSearchRecordCount).toBeLessThan(pointCount);
    expect(initialDiagnostics!.uploadBytes).toBeGreaterThanOrEqual(
      pointCount * 10,
    );
    const signalAxis = page.locator(
      '.parallel-fast-axis-guide[data-axis="signalValue"]',
    );
    const signalAxisLine = signalAxis.locator('.parallel-fast-axis-line');
    const initialSignalAxisLineBounds = await signalAxisLine.boundingBox();
    if (initialSignalAxisLineBounds === null) {
      throw new Error('Signal axis line is unavailable.');
    }
    await expect(signalAxis).toHaveAttribute('data-above-viewport', 'false');
    await expect(signalAxis).toHaveAttribute('data-below-viewport', 'false');
    await expect(signalAxis).toHaveAttribute('data-missing-values', 'false');
    const aggregationStartedAt = performance.now();
    await page.evaluate(() => {
      (
        window as typeof window & {
          __parallelFastPrototypeTestHooks?: {
            setAxisViewports: (
              viewports: Record<string, { max: number; min: number }>,
            ) => void;
          };
        }
      ).__parallelFastPrototypeTestHooks?.setAxisViewports({
        signalValue: { max: 80, min: 60 },
      });
    });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            return (
              window as typeof window & {
                __parallelFastPrototypeTestHooks?: {
                  getWebgpuDiagnostics: () => {
                    densityVisible: boolean;
                    lastAggregationMs: number;
                    lastAggregationPairCount: number;
                    refinedRecordCount: number;
                    refinementQualifiedRecordCount: number;
                    refinementStride: number;
                  } | null;
                };
              }
            ).__parallelFastPrototypeTestHooks?.getWebgpuDiagnostics() ?? null;
          }),
        { timeout: 15_000 },
      )
      .toMatchObject({ densityVisible: true, lastAggregationPairCount: 1 });
    expect(performance.now() - aggregationStartedAt).toBeLessThan(15_000);
    const zoomDiagnostics = await page.evaluate(() => {
      return (
        window as typeof window & {
          __parallelFastPrototypeTestHooks?: {
            getWebgpuDiagnostics: () => {
              densityVisible: boolean;
              hoverSearchRecordCount: number;
              lastAggregationMs: number;
              lastAggregationPairCount: number;
              refinedRecordCount: number;
              refinementQualifiedRecordCount: number;
              refinementStride: number;
              representativeRecordCount: number;
            } | null;
          };
        }
      ).__parallelFastPrototypeTestHooks?.getWebgpuDiagnostics() ?? null;
    });
    expect(zoomDiagnostics?.lastAggregationPairCount).toBe(1);
    expect(zoomDiagnostics?.densityVisible).toBe(true);
    expect(zoomDiagnostics!.refinedRecordCount).toBeGreaterThan(0);
    expect(zoomDiagnostics!.refinedRecordCount).toBeLessThanOrEqual(
      zoomDiagnostics!.representativeRecordCount,
    );
    expect(zoomDiagnostics?.hoverSearchRecordCount).toBe(
      zoomDiagnostics?.refinedRecordCount,
    );
    expect(zoomDiagnostics!.refinementQualifiedRecordCount).toBeGreaterThanOrEqual(
      zoomDiagnostics!.refinedRecordCount,
    );
    expect(zoomDiagnostics!.refinementStride).toBeGreaterThanOrEqual(1);
    expect(zoomDiagnostics!.lastAggregationMs).toBeLessThan(5_000);
    await expect(signalAxis).toHaveAttribute('data-above-viewport', 'true');
    await expect(signalAxis).toHaveAttribute('data-below-viewport', 'true');
    await expect(
      signalAxis.locator('.parallel-fast-axis-overflow-rail-above'),
    ).toHaveAttribute('data-visible', 'true');
    await expect(
      signalAxis.locator('.parallel-fast-axis-overflow-rail-below'),
    ).toHaveAttribute('data-visible', 'true');
    const zoomedSignalAxisLineBounds = await signalAxisLine.boundingBox();
    expect(zoomedSignalAxisLineBounds).toEqual(initialSignalAxisLineBounds);

    const detailRefinementStartedAt = performance.now();
    await page.evaluate(() => {
      (
        window as typeof window & {
          __parallelFastPrototypeTestHooks?: {
            setAxisViewports: (
              viewports: Record<string, { max: number; min: number }>,
            ) => void;
          };
        }
      ).__parallelFastPrototypeTestHooks?.setAxisViewports({
        signalValue: { max: 67.7, min: 67.5 },
      });
    });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const diagnostics = (
              window as typeof window & {
                __parallelFastPrototypeTestHooks?: {
                  getWebgpuDiagnostics: () => {
                    densityVisible: boolean;
                    hoverSearchRecordCount: number;
                    lastAggregationPairCount: number;
                    refinedRecordCount: number;
                    refinementQualifiedRecordCount: number;
                    refinementStride: number;
                    representativeRecordCount: number;
                  } | null;
                };
              }
            ).__parallelFastPrototypeTestHooks?.getWebgpuDiagnostics() ?? null;
            return diagnostics === null
              ? null
              : {
                  ...diagnostics,
                  fullyRefined:
                    diagnostics.refinementQualifiedRecordCount > 0 &&
                    diagnostics.refinedRecordCount ===
                      diagnostics.refinementQualifiedRecordCount,
                };
          }),
        { timeout: 15_000 },
      )
      .toMatchObject({
        densityVisible: true,
        fullyRefined: true,
        lastAggregationPairCount: 1,
        refinementStride: 1,
      });
    expect(performance.now() - detailRefinementStartedAt).toBeLessThan(15_000);
    const detailDiagnostics = await page.evaluate(() => {
      return (
        window as typeof window & {
          __parallelFastPrototypeTestHooks?: {
            getWebgpuDiagnostics: () => {
              hoverSearchRecordCount: number;
              lastAggregationMs: number;
              refinedCoordinatePrecisionBits: number;
              refinedRecordCount: number;
              representativeRecordCount: number;
            } | null;
          };
        }
      ).__parallelFastPrototypeTestHooks?.getWebgpuDiagnostics() ?? null;
    });
    expect(detailDiagnostics).not.toBeNull();
    expect(detailDiagnostics?.refinedCoordinatePrecisionBits).toBe(32);
    expect(detailDiagnostics!.refinedRecordCount).toBeLessThanOrEqual(
      detailDiagnostics!.representativeRecordCount,
    );
    expect(detailDiagnostics!.hoverSearchRecordCount).toBe(
      detailDiagnostics!.refinedRecordCount,
    );
    expect(detailDiagnostics!.lastAggregationMs).toBeLessThan(5_000);

    const bounds = await chart.boundingBox();
    if (bounds === null) throw new Error('Parallel WebGPU chart is unavailable.');
    const overflowHoverPoint = {
      x: initialSignalAxisLineBounds.x + initialSignalAxisLineBounds.width / 2,
      y: bounds.y +
        (1 - PARALLEL_ABOVE_VIEWPORT_DISPLAY_VALUE) * bounds.height,
    };
    await page.keyboard.down('Shift');
    await page.mouse.move(overflowHoverPoint.x, overflowHoverPoint.y);
    const projectionMarker = page.getByTestId(
      'parallel-fast-inspection-projection-marker',
    );
    await expect(projectionMarker).toBeVisible({ timeout: 10_000 });
    const overflowMarkerBounds = await projectionMarker.boundingBox();
    if (overflowMarkerBounds === null) {
      throw new Error('Overflow hover projection marker is unavailable.');
    }
    expect(Math.hypot(
      overflowMarkerBounds.x + overflowMarkerBounds.width / 2 -
        overflowHoverPoint.x,
      overflowMarkerBounds.y + overflowMarkerBounds.height / 2 -
        overflowHoverPoint.y,
    )).toBeLessThan(8);
    await expect.poll(() => page.evaluate(() => {
      return (
        window as typeof window & {
          __parallelFastPrototypeTestHooks?: {
            getWebgpuDiagnostics: () => {
              hoverFallbackCount: number;
              lastHoverResolveMs: number;
              lastHoverUsedFullPopulation: boolean;
            } | null;
          };
        }
      ).__parallelFastPrototypeTestHooks?.getWebgpuDiagnostics() ?? null;
    }), { timeout: 10_000 }).toMatchObject({
      lastHoverUsedFullPopulation: true,
    });
    const overflowHoverDiagnostics = await page.evaluate(() => {
      return (
        window as typeof window & {
          __parallelFastPrototypeTestHooks?: {
            getWebgpuDiagnostics: () => {
              hoverFallbackCount: number;
              lastHoverResolveMs: number;
              lastHoverUsedFullPopulation: boolean;
            } | null;
          };
        }
      ).__parallelFastPrototypeTestHooks?.getWebgpuDiagnostics() ?? null;
    });
    expect(overflowHoverDiagnostics!.hoverFallbackCount).toBeGreaterThan(0);
    expect(overflowHoverDiagnostics!.lastHoverResolveMs).toBeLessThan(250);
    await page.keyboard.up('Shift');
    const hoverPoint = {
      x: bounds.x + bounds.width * 0.84,
      y: bounds.y + bounds.height * 0.5,
    };
    await page.keyboard.down('Shift');
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    await expect(projectionMarker).toBeVisible({ timeout: 10_000 });
    const markerBounds = await projectionMarker.boundingBox();
    if (markerBounds === null) throw new Error('Hover projection marker is unavailable.');
    const markerCenter = {
      x: markerBounds.x + markerBounds.width / 2,
      y: markerBounds.y + markerBounds.height / 2,
    };
    expect(Math.hypot(
      markerCenter.x - hoverPoint.x,
      markerCenter.y - hoverPoint.y,
    )).toBeLessThan(25);
    await expect.poll(() => page.evaluate(({ x, y }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas.parallel-fast-hover-canvas, canvas.parallel-fast-webgl-hover-canvas',
      );
      if (canvas === null) return 0;
      const context = canvas.getContext('2d');
      if (context === null) return 0;
      const rect = canvas.getBoundingClientRect();
      const canvasX = Math.round((x - rect.left) * canvas.width / rect.width);
      const canvasY = Math.round((y - rect.top) * canvas.height / rect.height);
      const radius = 5;
      const pixels = context.getImageData(
        Math.max(0, canvasX - radius),
        Math.max(0, canvasY - radius),
        radius * 2 + 1,
        radius * 2 + 1,
      ).data;
      let maxAlpha = 0;
      for (let offset = 3; offset < pixels.length; offset += 4) {
        maxAlpha = Math.max(maxAlpha, pixels[offset] ?? 0);
      }
      return maxAlpha;
    }, markerCenter), { timeout: 5_000 }).toBeGreaterThan(0);
    await page.keyboard.up('Shift');
    await page.getByRole('button', { name: 'Reset viewport' }).click();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            return (
              window as typeof window & {
                __parallelFastPrototypeTestHooks?: {
                  getWebgpuDiagnostics: () => {
                    densityVisible: boolean;
                    hoverSearchRecordCount: number;
                    lastAggregationMs: number;
                    refinedRecordCount: number;
                    representativeRecordCount: number;
                  } | null;
                };
              }
            ).__parallelFastPrototypeTestHooks?.getWebgpuDiagnostics() ?? null;
          }),
        { timeout: 15_000 },
      )
      .toMatchObject({ densityVisible: true, refinedRecordCount: 0 });
    const resetDiagnostics = await page.evaluate(() => {
      return (
        window as typeof window & {
          __parallelFastPrototypeTestHooks?: {
            getWebgpuDiagnostics: () => {
              hoverSearchRecordCount: number;
              lastAggregationMs: number;
              representativeRecordCount: number;
            } | null;
          };
        }
      ).__parallelFastPrototypeTestHooks?.getWebgpuDiagnostics() ?? null;
    });
    expect(resetDiagnostics?.hoverSearchRecordCount).toBe(
      resetDiagnostics?.representativeRecordCount,
    );
    expect(resetDiagnostics!.lastAggregationMs).toBeLessThan(5_000);
    expect(gpuErrors, gpuErrors.join('\n')).toEqual([]);
  }
});

test('m-parallel WebGPU renders density and preserves zoom reset and hover', async ({
  page,
}) => {
  test.setTimeout(120_000);
  test.skip(
    process.env.M_CHARTS_ENABLE_WEBGPU_E2E !== '1',
    'Set M_CHARTS_ENABLE_WEBGPU_E2E=1 on a WebGPU-capable machine.',
  );
  const gpuErrors: string[] = [];
  page.on('console', (message) => {
    if (
      (message.type() === 'error' || message.type() === 'warning') &&
      /WebGPU|GPUValidation|WGSL|Buffer.*usage/u.test(message.text())
    ) {
      gpuErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => gpuErrors.push(error.message));
  await page.goto('/m-parallel-webgpu-fixture');
  const chart = page.getByTestId('parallel-fast-chart-layout');
  await expect(chart).toHaveAttribute('data-renderer', 'webgpu-parallel-density');
  await page.waitForTimeout(1_000);
  expect(gpuErrors, gpuErrors.join('\n')).toEqual([]);
  await expect
    .poll(
      async () => ({
        errors: gpuErrors,
        state: await chart.getAttribute('data-render-state'),
      }),
      { timeout: 60_000 },
    )
    .toEqual({ errors: [], state: 'ready' });
  const bounds = await chart.boundingBox();
  if (bounds === null) throw new Error('Parallel WebGPU fixture is unavailable.');
  const latencyAxis = page.locator(
    '.parallel-fast-axis-guide[data-axis="latency"]',
  );
  const axisBounds = await latencyAxis.boundingBox();
  if (axisBounds === null) throw new Error('Latency axis is unavailable.');
  await page.mouse.move(
    axisBounds.x + axisBounds.width / 2,
    axisBounds.y + axisBounds.height * 0.2,
  );
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(
    axisBounds.x + axisBounds.width / 2,
    axisBounds.y + axisBounds.height * 0.65,
    { steps: 6 },
  );
  await expect(chart).toHaveAttribute('data-axis-viewport-count', '0');
  await page.mouse.up({ button: 'left' });
  await expect(chart).toHaveAttribute('data-axis-viewport-count', '1');
  const viewportBeforeSmallPan = await chart.getAttribute('data-axis-viewports');
  const viewportFeedback = page.locator('.parallel-fast-axis-viewport-box');
  const latencyAxisLine = latencyAxis.locator('.parallel-fast-axis-line');
  const smallPanStartY = axisBounds.y + axisBounds.height * 0.5;
  await page.mouse.move(axisBounds.x + axisBounds.width / 2, smallPanStartY);
  await page.mouse.down({ button: 'middle' });
  await expect(viewportFeedback).toBeVisible();
  const feedbackBounds = await viewportFeedback.boundingBox();
  const axisLineBounds = await latencyAxisLine.boundingBox();
  if (feedbackBounds === null || axisLineBounds === null) {
    throw new Error('Parallel viewport feedback geometry is unavailable.');
  }
  expect(Math.round(feedbackBounds.y)).toBe(Math.round(axisLineBounds.y));
  expect(Math.round(feedbackBounds.height)).toBe(Math.round(axisLineBounds.height));
  await page.mouse.move(
    axisBounds.x + axisBounds.width / 2,
    smallPanStartY + 8,
    { steps: 3 },
  );
  await page.mouse.up({ button: 'middle' });
  await expect
    .poll(() => chart.getAttribute('data-axis-viewports'))
    .not.toBe(viewportBeforeSmallPan);
  const zoomedBrushStartY = axisBounds.y + axisBounds.height * 0.3;
  const zoomedBrushEndY = axisBounds.y + axisBounds.height * 0.55;
  await page.mouse.move(axisBounds.x + axisBounds.width / 2, zoomedBrushStartY);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(axisBounds.x + axisBounds.width / 2, zoomedBrushEndY, {
    steps: 5,
  });
  await page.mouse.up({ button: 'right' });
  const zoomedLatencyBrush = latencyAxis.getByTestId('parallel-fast-axis-brush');
  await expect(zoomedLatencyBrush).toBeVisible();
  await expect
    .poll(async () => {
      const brushBounds = await zoomedLatencyBrush.boundingBox();
      if (brushBounds === null) return null;
      return {
        bottom: Math.round(brushBounds.y + brushBounds.height),
        top: Math.round(brushBounds.y),
      };
    })
    .toEqual({
      bottom: Math.round(zoomedBrushEndY),
      top: Math.round(zoomedBrushStartY),
    });
  await page.getByTestId('parallel-fixture-reset-zoom').click();
  await expect(chart).toHaveAttribute('data-axis-viewport-count', '0');
  await page.keyboard.down('Shift');
  await page.mouse.move(
    bounds.x + bounds.width * 0.5,
    bounds.y + bounds.height * 0.5,
  );
  await expect
    .poll(() => chart.getAttribute('data-hover-source-index'), {
      timeout: 10_000,
    })
    .not.toBe('none');
  await page.keyboard.up('Shift');
  await expect
    .poll(async () => Number(await chart.getAttribute('data-draw-call-count')))
    .toBeGreaterThan(0);
  await page.mouse.move(
    axisBounds.x + axisBounds.width / 2,
    axisBounds.y + axisBounds.height * 0.25,
  );
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(
    axisBounds.x + axisBounds.width / 2,
    axisBounds.y + axisBounds.height * 0.65,
    { steps: 5 },
  );
  await page.mouse.up({ button: 'right' });
  await expect
    .poll(async () => Number(await chart.getAttribute('data-selected-count')))
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await chart.getAttribute('data-selected-count')))
    .toBeLessThan(24);
  const observedAtAxis = page.locator(
    '.parallel-fast-axis-guide[data-axis="observedAt"]',
  );
  const observedAtBounds = await observedAtAxis.boundingBox();
  if (observedAtBounds === null) throw new Error('Observed-at axis is unavailable.');
  await page.mouse.move(
    observedAtBounds.x + observedAtBounds.width / 2,
    observedAtBounds.y + observedAtBounds.height * 0.3,
  );
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(
    observedAtBounds.x + observedAtBounds.width / 2,
    observedAtBounds.y + observedAtBounds.height * 0.55,
    { steps: 4 },
  );
  await page.mouse.up({ button: 'right' });
  const edgeBrush = observedAtAxis.getByTestId('parallel-fast-axis-brush');
  await expect(edgeBrush).toBeVisible();
  const edgeBrushBounds = await edgeBrush.boundingBox();
  if (edgeBrushBounds === null) throw new Error('Observed-at brush is unavailable.');
  expect(edgeBrushBounds.x).toBeGreaterThanOrEqual(bounds.x);
  expect(edgeBrushBounds.x + edgeBrushBounds.width).toBeLessThanOrEqual(
    bounds.x + bounds.width,
  );
  await expect(edgeBrush.locator('.parallel-fast-axis-brush-band')).toHaveAttribute(
    'title',
    / – /u,
  );
  const latencyBrush = latencyAxis.getByTestId('parallel-fast-axis-brush');
  expect(
    await latencyBrush.locator('span').evaluateAll((labels) =>
      labels.every((label) => label.scrollWidth <= label.clientWidth),
    ),
  ).toBe(true);
  expect(gpuErrors, gpuErrors.join('\n')).toEqual([]);
});

test('m-histogram routes render raw multi table bar mode and package fixture', async ({ page }) => {
  await page.goto(createHistogramUrl({}));
  await expect(page.getByTestId('histogram-fast-route-host')).toBeVisible();
  await expect.poll(() => readHistogramState(page)).toMatchObject({
    histMode: 'histogram',
    tableMode: 'single',
  });
  await assertCanvasNonBlank(page, '.histogram-fast-webgl-canvas');

  await page.goto(createHistogramUrl({ tables: 'multi' }));
  await expect.poll(() => readHistogramState(page)).toMatchObject({
    histMode: 'histogram',
    tableMode: 'multi',
  });

  await page.goto(createHistogramUrl({ histMode: 'bar' }));
  await expect.poll(() => readHistogramState(page)).toMatchObject({
    histMode: 'bar',
  });
  await expect.poll(async () => {
    const state = await readHistogramState(page) as {
      binCount?: number;
      stackSegmentCount?: number;
    } | null;
    return (state?.stackSegmentCount ?? 0) > (state?.binCount ?? 0);
  }).toBe(true);

  await page.goto('/m-histogram-fixture?theme=dark&__e2ePreserveDrawingBuffer=1');
  await expect(page.getByTestId('histogram-fast-fixture')).toBeVisible();
  await expect(page.getByTestId('histogram-fast-fixture-host')).toHaveAttribute(
    'data-renderer',
    'webgl2-histogram',
  );
});

test('m-histogram reset viewport restores the full range in one action', async ({ page }) => {
  await page.goto(createHistogramUrl({}));
  await expect.poll(() =>
    page.evaluate(
      () => window.__histogramFastRouteStateTestHook?.()?.viewport ?? null,
    ),
  ).not.toBeNull();
  const initialViewport = await page.evaluate(
    () => window.__histogramFastRouteStateTestHook?.()?.viewport ?? null,
  );
  expect(initialViewport).not.toBeNull();

  const continuousFrame = page.locator('.histogram-fast-overlay-plot-frame').last();
  const frame = await continuousFrame.boundingBox();
  if (frame === null) throw new Error('Histogram plot frame is unavailable.');
  await page.mouse.move(
    frame.x + frame.width * 0.25,
    frame.y + frame.height * 0.35,
  );
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(
    frame.x + frame.width * 0.75,
    frame.y + frame.height * 0.55,
    { steps: 8 },
  );
  await page.mouse.up({ button: 'left' });

  await expect.poll(async () => {
    const viewport = await page.evaluate(
      () => window.__histogramFastRouteStateTestHook?.()?.viewport ?? null,
    );
    return JSON.stringify(viewport);
  }).not.toBe(JSON.stringify(initialViewport));

  await page.getByTestId('histogram-fast-reset-viewport').click();
  await expect.poll(async () => {
    const viewport = await page.evaluate(
      () => window.__histogramFastRouteStateTestHook?.()?.viewport ?? null,
    );
    return JSON.stringify(viewport);
  }).toBe(JSON.stringify(initialViewport));
});

test('basic custom interactions expose selection hover and measurement hooks', async ({ page }) => {
  await page.goto(
    '/m-scatter?mode=hover&axis=xy&__e2ePreserveDrawingBuffer=1&__e2eScatterFastSchemaDataset=1&__e2eScatterFastSchemaDataUrl=/data/scatter-fast-e2e.json&__e2eScatterFastSchemaUrl=/data/scatter-fast-e2e-schema.json&__e2eScatterFastHoverHook=1&__e2eScatterFastMeasurementHook=1',
  );
  await expect(page.getByTestId('scatter-fast-interaction-surface')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof window.__scatterFastHoverTestHook?.getCurrentHover === 'function' &&
          typeof window.__scatterFastMeasurementTestHook?.getCurrent === 'function',
      ),
    )
    .toBe(true);

  await page.goto(
    '/m-parallel?__e2eParallelFastBrushHook=1&__e2eParallelFastDataset=/data/parallel-e2e.json',
  );
  await expect(page.getByTestId('parallel-fast-interaction-surface')).toBeVisible();
  await page.keyboard.press('Shift');
  const parallelPoint = await plotPoint(page, '[data-testid="parallel-fast-interaction-surface"]');
  await page.mouse.move(parallelPoint.x, parallelPoint.y);
  await expect(page.getByTestId('parallel-fast-axis-overlay')).toBeVisible();
  await page.keyboard.up('Shift');

  await page.goto(createHistogramUrl({ mode: 'select' }));
  const histogramPoint = await plotPoint(page, '.histogram-fast-overlay-plot-frame');
  await page.mouse.move(histogramPoint.x, histogramPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => window.__histogramFastRouteStateTestHook?.()?.recordCount ?? 0),
    )
    .toBeGreaterThan(0);
});

test('parallel inspection axis markers follow zoomed axis viewports', async ({ page }) => {
  await page.goto(
    '/m-parallel?__e2eParallelFastBrushHook=1&__e2eParallelFastDataset=/data/parallel-e2e.json',
  );
  await expect(page.getByTestId('parallel-fast-interaction-surface')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (
            window as typeof window & {
              __parallelFastPrototypeTestHooks?: {
                setAxisViewports?: unknown;
              };
            }
          ).__parallelFastPrototypeTestHooks?.setAxisViewports === 'function',
      ),
    )
    .toBe(true);

  await page.evaluate(() => {
    const hooks = (
      window as typeof window & {
        __parallelFastPrototypeTestHooks?: {
          inspectRecord: (recordId: string, axis: string) => void;
          setAxisViewports: (
            viewports: Record<string, { max: number; min: number }>,
          ) => void;
        };
      }
    ).__parallelFastPrototypeTestHooks;
    hooks?.setAxisViewports({ memoryUsage: { max: 70, min: 60 } });
    hooks?.inspectRecord('pc-000006', 'memoryUsage');
  });
  await expect
    .poll(() => new URL(page.url()).searchParams.get('pf.memoryUsage.min'))
    .toBe('60');
  expect(new URL(page.url()).searchParams.get('pf.memoryUsage.max')).toBe('70');
  await expect(page.getByTestId('parallel-viewport-status')).toHaveText(
    '1 axis adjusted',
  );
  await expect(page.getByTestId('parallel-reset-viewport')).toBeEnabled();

  const marker = page.locator(
    '[data-testid="parallel-fast-inspection-axis-marker"][data-axis="memoryUsage"]',
  );
  const label = page.locator(
    '[data-testid="parallel-fast-inspection-axis-label"][data-axis="memoryUsage"]',
  );
  await expect(marker).toBeVisible();
  await expect(label).toHaveAttribute('data-value-text', /63\.2/u);
  const normalizedViewportValue = (63.247 - 60) / (70 - 60);
  const expectedMarkerTop = (
    1 - (
      PARALLEL_AXIS_MIN_DISPLAY_VALUE +
      normalizedViewportValue * (
        PARALLEL_AXIS_MAX_DISPLAY_VALUE - PARALLEL_AXIS_MIN_DISPLAY_VALUE
      )
    )
  ) * 100;
  await expect
    .poll(async () => {
      const style = await marker.getAttribute('style');
      return Number.parseFloat(style?.match(/top:\s*([\d.]+)/u)?.[1] ?? 'NaN');
    })
    .toBeCloseTo(expectedMarkerTop, 3);

  await page.reload();
  const reloadedChart = page.getByTestId('parallel-fast-chart-layout');
  await expect(reloadedChart).toHaveAttribute('data-axis-viewport-count', '1');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (
            window as typeof window & {
              __parallelFastPrototypeTestHooks?: {
                inspectRecord?: unknown;
              };
            }
          ).__parallelFastPrototypeTestHooks?.inspectRecord === 'function',
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    (
      window as typeof window & {
        __parallelFastPrototypeTestHooks?: {
          inspectRecord: (recordId: string, axis: string) => void;
        };
      }
    ).__parallelFastPrototypeTestHooks?.inspectRecord('pc-000006', 'memoryUsage');
  });
  await expect(marker).toBeVisible();
  await expect
    .poll(async () => {
      const style = await marker.getAttribute('style');
      return Number.parseFloat(style?.match(/top:\s*([\d.]+)/u)?.[1] ?? 'NaN');
    })
    .toBeCloseTo(expectedMarkerTop, 3);

  await page.getByRole('button', { name: 'Reset viewport' }).click();
  await expect(reloadedChart).toHaveAttribute('data-axis-viewport-count', '0');
  await expect(page.getByTestId('parallel-viewport-status')).toHaveText(
    'All axes at full range',
  );
  await expect(page.getByTestId('parallel-reset-viewport')).toBeDisabled();
  await expect
    .poll(() => new URL(page.url()).searchParams.has('pf.memoryUsage.min'))
    .toBe(false);
  expect(new URL(page.url()).searchParams.has('pf.memoryUsage.max')).toBe(false);
});

test('m-scatter heatmap selection clears hover inspection', async ({ page }) => {
  await page.goto(
    '/m-scatter?mode=select&axis=xy&viz=heatmap&heatBinPx=16&__e2ePreserveDrawingBuffer=1&__e2eScatterFastSchemaDataset=1&__e2eScatterFastSchemaDataUrl=/data/scatter-fast-e2e.json&__e2eScatterFastSchemaUrl=/data/scatter-fast-e2e-schema.json&__e2eScatterFastHoverHook=1&__e2eScatterFastSelectionHook=1&__e2eScatterFastRouteStateHook=1',
  );
  await expect(page.getByTestId('scatter-fast-interaction-surface')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__scatterFastRouteStateTestHook?.getVisualizationMode?.() ?? null,
      ),
    )
    .toBe('heatmap');
  await expect
    .poll(() =>
      page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-aggregate-status'),
    )
    .toBe('ready');

  await page.evaluate(() => {
    window.__scatterFastHoverTestHook?.setHoverSourceIndex(0);
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.__scatterFastHoverTestHook?.getCurrentHover?.()?.point.sourceIndex),
    )
    .toBe(0);
  await expect(page.getByTestId('scatter-fast-cursor-tooltip')).toHaveCount(1);

  const point = await plotPoint(page, '[data-testid="scatter-fast-chart-shell"]');
  await page.mouse.move(point.x - 80, point.y - 40);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(point.x + 80, point.y + 40, { steps: 4 });
  await page.mouse.up({ button: 'right' });

  await expect
    .poll(() =>
      page.evaluate(() => window.__scatterFastSelectionTestHook?.getSelectedCount?.() ?? 0),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        hover: window.__scatterFastHoverTestHook?.getCurrentHover?.() ?? null,
        sourceIndex: window.__scatterFastHoverTestHook?.getHoverSourceIndex?.() ?? null,
      })),
    )
    .toEqual({ hover: null, sourceIndex: null });
  await expect(page.getByTestId('scatter-fast-cursor-tooltip')).toHaveCount(0);
  await expect(page.getByTestId('scatter-fast-inspection-aggregate-heatmap')).toHaveCount(0);
});

function ensureData(fileName: string, args: readonly string[]): void {
  if (existsSync(`${dataDir}/${fileName}`)) {
    return;
  }
  execFileSync('pnpm', ['generate:data', '--', ...args], {
    stdio: 'inherit',
  });
}

function createHistogramUrl(options: {
  histMode?: 'bar';
  mode?: string;
  tables?: 'multi';
}): string {
  const params = new URLSearchParams({
    __e2ePreserveDrawingBuffer: '1',
    __e2eScatterFastSchemaDataUrl: '/data/scatter-fast-e2e.json',
    __e2eScatterFastSchemaUrl: '/data/scatter-fast-e2e-schema.json',
  });
  if (options.tables === 'multi') {
    params.set('tables', 'multi');
    params.set('__e2eFastTableFixture', '/data/mixed-table-e2e.json');
  }
  if (options.histMode === 'bar') {
    params.set('histMode', 'bar');
  }
  if (options.mode !== undefined) {
    params.set('mode', options.mode);
  }
  return `/m-histogram?${params.toString()}`;
}

async function assertCanvasNonBlank(page: Page, selector: string): Promise<void> {
  await expect
    .poll(async () =>
      page.locator(selector).first().evaluate((canvas) => {
        const target = canvas as HTMLCanvasElement;
        const sample = document.createElement('canvas');
        sample.width = Math.max(1, target.width);
        sample.height = Math.max(1, target.height);
        const context = sample.getContext('2d', { willReadFrequently: true });
        if (context === null || target.width === 0 || target.height === 0) {
          return false;
        }
        context.drawImage(target, 0, 0);
        const data = context.getImageData(0, 0, sample.width, sample.height).data;
        for (let index = 3; index < data.length; index += 4) {
          if (data[index] !== 0) {
            return true;
          }
        }
        return false;
      }),
    )
    .toBe(true);
}

async function assertCanvasHasNonBackgroundPixels(page: Page, selector: string): Promise<void> {
  await expect
    .poll(async () =>
      page.locator(selector).first().evaluate((canvas) => {
        const target = canvas as HTMLCanvasElement;
        const sample = document.createElement('canvas');
        sample.width = Math.max(1, target.width);
        sample.height = Math.max(1, target.height);
        const context = sample.getContext('2d', { willReadFrequently: true });
        if (context === null || target.width === 0 || target.height === 0) {
          return 0;
        }
        context.drawImage(target, 0, 0);
        const data = context.getImageData(0, 0, sample.width, sample.height).data;
        let nonBackgroundPixels = 0;
        for (let index = 0; index < data.length; index += 4) {
          const red = data[index] ?? 0;
          const green = data[index + 1] ?? 0;
          const blue = data[index + 2] ?? 0;
          const alpha = data[index + 3] ?? 0;
          const lightBackground = red > 225 && green > 225 && blue > 225;
          if (alpha > 0 && !lightBackground) {
            nonBackgroundPixels += 1;
          }
        }
        return nonBackgroundPixels;
      }),
    )
    .toBeGreaterThan(1000);
}

async function plotPoint(
  page: Page,
  selector: string,
): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().boundingBox();
  expect(box).not.toBeNull();
  return {
    x: box!.x + box!.width / 2,
    y: box!.y + box!.height / 2,
  };
}

async function readHistogramState(page: Page): Promise<unknown> {
  return page.evaluate(() => window.__histogramFastRouteStateTestHook?.() ?? null);
}
