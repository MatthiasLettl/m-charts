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
  ensureData('mixed-table-e2e.json', [
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
      name: 'WebGL2 charts for fast, interactive exploration of large datasets.',
    }),
  ).toBeVisible();
  await expect(page.getByText('MIT license')).toBeVisible();
  await expect(page.getByRole('link', { name: 'MatthiasLettl/m-charts' })).toBeVisible();
  await expect(page.getByText('m-scatter', { exact: true })).toBeVisible();
  await expect(page.getByText('m-parallel', { exact: true })).toBeVisible();
  await expect(page.getByText('m-histogram', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'One table' }).first().click();
  await expect(page).toHaveURL(/\/m-scatter\?mode=hover&axis=x&theme=dark$/);

  await page.goto('/?theme=dark');
  await page.getByRole('link', { name: 'Multiple tables' }).first().click();
  await expect(page).toHaveURL('/m-scatter?tables=multi&theme=dark');

  await page.goto('/?theme=dark');
  await page.getByRole('link', { name: 'Pre-aggregated bars' }).click();
  await expect(page).toHaveURL('/m-histogram?histMode=bar&theme=dark');
});

test('theme switch is URL backed on custom routes', async ({ page }) => {
  await page.goto('/m-scatter?mode=hover&axis=x');
  await page.getByTestId('theme-mode-switch').click();
  await expect(page).toHaveURL(/\/m-scatter\?mode=hover&axis=x&theme=dark$/);
  await page.getByTestId('theme-mode-switch').click();
  await expect(page).toHaveURL(/\/m-scatter\?mode=hover&axis=x$/);
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

  await page.goto('/m-histogram-fixture?theme=dark&__e2ePreserveDrawingBuffer=1');
  await expect(page.getByTestId('histogram-fast-fixture')).toBeVisible();
  await expect(page.getByTestId('histogram-fast-fixture-host')).toHaveAttribute(
    'data-renderer',
    'webgl2-histogram',
  );
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
