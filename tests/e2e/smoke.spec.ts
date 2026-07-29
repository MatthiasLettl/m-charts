import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

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
  ]);
  const webgpuCard = page.locator('.prototype-card').filter({ hasText: 'm-scatter WebGPU' });
  await expect(webgpuCard.getByRole('link', { name: 'One table' })).toHaveAttribute(
    'href',
    '/m-scatter-webgpu?points=1000000&theme=dark',
  );
  await expect(webgpuCard.getByRole('link', { name: 'Multiple tables' })).toHaveAttribute(
    'href',
    '/m-scatter-webgpu?points=1000000&tables=multi&theme=dark',
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
