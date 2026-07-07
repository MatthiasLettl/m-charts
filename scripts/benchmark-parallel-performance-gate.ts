import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { chromium, type Page } from '@playwright/test';

type ParallelParameter =
  | 'throughput'
  | 'latency'
  | 'errorRate'
  | 'cpuLoad'
  | 'memoryUsage';

interface ParallelRecord {
  cpuLoad: number;
  errorRate: number;
  id: string;
  latency: number;
  memoryUsage: number;
  throughput: number;
}

interface ParallelDataset {
  records: ParallelRecord[];
}

interface BrowserCanvas {
  height: number;
  width: number;
}

interface BrowserCanvasContext {
  drawImage: (image: unknown, dx: number, dy: number) => void;
  getImageData: (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ) => { data: Uint8ClampedArray };
}

interface BrowserDocument {
  createElement: (tagName: 'canvas') => BrowserCanvas & {
    getContext: (
      contextId: '2d',
      options?: { willReadFrequently: boolean },
    ) => BrowserCanvasContext | null;
  };
  querySelector: (selector: string) => BrowserElement | null;
}

interface BrowserElement {
  dataset: Record<string, string | undefined>;
  nextElementSibling: BrowserElement | null;
  querySelectorAll: (selector: string) => BrowserElement[];
  textContent: string | null;
}

interface BrowserTimingGlobals {
  __parallelNavigationStartedAt?: number;
}

interface BrushSelector {
  axis: ParallelParameter;
  end: number;
  start: number;
}

interface BrushScenario {
  expectedCount: number;
  selectors: BrushSelector[];
}

interface RouteBenchmarkResult {
  brush: {
    pointerDrag: PointerDragBenchmarkResult | null;
    oneAxis: SelectionBenchmarkResult;
    twoAxis: SelectionBenchmarkResult;
  };
  exportSerializationMs: number | null;
  exportSerializationBytes: number | null;
  firstNonblankFromNavigationMs: number | null;
  hoverInspectMs: number | null;
  hoverTrace: HoverTraceBenchmarkResult | null;
  metrics: Record<string, number | string | boolean | null>;
  recordCount: number;
  route: '/m-parallel';
  routeReadyFromNavigationMs: number | null;
  renderState: string;
}

interface HoverTraceBenchmarkResult {
  hoverResolveMsMedian: number | null;
  hoverResolveMsP95: number | null;
  hoverVisualRedrawMsMedian: number | null;
  hoverVisualRedrawMsP95: number | null;
  hoverVisualUpdateMsMedian: number | null;
  hoverVisualUpdateMsP95: number | null;
  hoverVisualUploadBytesMedian: number | null;
  moveCount: number;
  observedMs: number;
}

interface SelectionBenchmarkResult {
  expectedCount: number;
  idMaterializationMs: number | null;
  observedCount: number;
  reactSelectionCommitMs: number | null;
  routeMetricMs: number | null;
  selectionComputeMs: number | null;
  selectedVisualBufferCreationMs: number | null;
  selectedVisualGpuUploadMs: number | null;
  selectedVisualMaskBuildMs: number | null;
  selectedVisualMaskGpuUploadMs: number | null;
  selectedVisualRedrawMs: number | null;
  selectionUpdateMs: number | null;
  setAndObserveMs: number;
  sourceIndexCreationMs: number | null;
}

interface PointerDragBenchmarkResult {
  brushComputeChangedDuringDrag: boolean;
  brushComputeDuringDrag: number | null;
  brushComputeBeforeDrag: number | null;
  finalObservedCount: number;
  moveCount: number;
  observedMs: number;
  selectionFreshnessDuringDrag: string | null;
  streamMs: number;
}

interface BenchmarkResult {
  parallelFast: RouteBenchmarkResult;
  run: number;
}

const DEFAULT_PORT = 5186;
const DEFAULT_RUNS = 1;
const ROUTE_READY_TIMEOUT_MS = 300_000;
const NONBLANK_TIMEOUT_MS = 300_000;
const SELECT_TIMEOUT_MS = 180_000;
const HOVER_TIMEOUT_MS = 30_000;
const PARALLEL_FAST_DATASET_PATH = new URL(
  '../apps/demo/public/data/parallel-sample.json',
  import.meta.url,
);
export const PARALLEL_FAST_ROUTE_DATASET_URL = '/data/parallel-sample.json';
const AXIS_ORDER: ParallelParameter[] = [
  'throughput',
  'latency',
  'errorRate',
  'cpuLoad',
  'memoryUsage',
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const parallelFastDataset = readParallelDataset(PARALLEL_FAST_DATASET_PATH);
  const parallelFastOneAxis = createBrushScenario(parallelFastDataset.records, 1);
  const parallelFastTwoAxis = createBrushScenario(parallelFastDataset.records, 2);
  await assertPortAvailable(options.port);
  const server = startViteServer(options.port);
  const baseUrl = `http://127.0.0.1:${options.port}`;

  try {
    await waitForSpawnedViteServer(baseUrl, server);

    const results: BenchmarkResult[] = [];

    for (let run = 1; run <= options.runs; run += 1) {
      const parallelFast = await benchmarkParallelFastRoute({
        baseUrl,
        oneAxis: parallelFastOneAxis,
        twoAxis: parallelFastTwoAxis,
      });

      results.push({
        parallelFast,
        run,
      });
    }

    console.log(JSON.stringify({ results, summary: createSummary(results) }, null, 2));
  } finally {
    await stopViteServer(server);
  }
}

async function benchmarkParallelFastRoute({
  baseUrl,
  oneAxis,
  twoAxis,
}: {
  baseUrl: string;
  oneAxis: BrushScenario;
  twoAxis: BrushScenario;
}): Promise<RouteBenchmarkResult> {
  const page = await createPage();

  try {
    await page.goto(
      createParallelFastBenchmarkUrl(baseUrl),
      {
        timeout: ROUTE_READY_TIMEOUT_MS,
        waitUntil: 'domcontentloaded',
      },
    );

    const firstNonblankPromise = waitForFirstNonblankCanvas(
      page,
      '.parallel-fast-chart-host canvas',
    );
    const renderState = await waitForRenderState(
      page,
      '[data-testid="parallel-fast-chart-layout"]',
    );
    const routeReadyFromNavigationMs = await readElapsedFromNavigation(page);
    const firstNonblankFromNavigationMs =
      renderState === 'ready' ? await firstNonblankPromise : null;
    const diagnostics = await readDataAttributes(
      page,
      '[data-testid="parallel-fast-route-diagnostics"]',
    );

    if (renderState !== 'ready') {
      return {
        brush: {
          pointerDrag: null,
          oneAxis: createSkippedSelectionResult(oneAxis.expectedCount),
          twoAxis: createSkippedSelectionResult(twoAxis.expectedCount),
        },
        exportSerializationBytes: null,
        exportSerializationMs: null,
        firstNonblankFromNavigationMs,
        hoverInspectMs: null,
        hoverTrace: null,
        metrics: diagnostics,
        recordCount: Number(diagnostics.recordCount ?? 0),
        route: '/m-parallel',
        routeReadyFromNavigationMs,
        renderState,
      };
    }

    await waitForParallelFastHook(page);
    const oneAxisResult = await runParallelFastBrush(page, oneAxis);
    const exportSerialization = await runParallelFastExportSerialization(page);
    const pointerDragResult = await runParallelFastPointerDrag(page);
    const twoAxisResult = await runParallelFastBrush(page, twoAxis);
    const hoverInspectMs = await runPointerHoverInspect(
      page,
      '.parallel-fast-axis-overlay',
      '[data-testid="parallel-fast-route-diagnostics"]',
      'hoverResolveMs',
    );
    const hoverTrace = await runParallelFastHoverTrace(page);

    return {
      brush: {
        pointerDrag: pointerDragResult,
        oneAxis: oneAxisResult,
        twoAxis: twoAxisResult,
      },
      exportSerializationBytes: exportSerialization?.byteLength ?? null,
      exportSerializationMs: exportSerialization?.ms ?? null,
      firstNonblankFromNavigationMs,
      hoverInspectMs,
      hoverTrace,
      metrics: await readDataAttributes(
        page,
        '[data-testid="parallel-fast-route-diagnostics"]',
      ),
      recordCount: Number(diagnostics.recordCount ?? 0),
      route: '/m-parallel',
      routeReadyFromNavigationMs,
      renderState,
    };
  } finally {
    await page.close();
  }
}

async function createPage(): Promise<Page> {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.once('close', () => {
    void browser.close();
  });
  await page.addInitScript(() => {
    (globalThis as BrowserTimingGlobals).__parallelNavigationStartedAt = performance.now();
  });

  return page;
}

async function waitForRenderState(
  page: Page,
  selector: string,
): Promise<'ready' | 'error'> {
  await page.waitForFunction(
    (chartSelector) => {
      const browserGlobals = globalThis as unknown as { document: BrowserDocument };
      const element = browserGlobals.document.querySelector(chartSelector);
      const renderState = element?.dataset.renderState;

      return renderState === 'ready' || renderState === 'error';
    },
    selector,
    { timeout: ROUTE_READY_TIMEOUT_MS },
  );

  const renderState = await page.locator(selector).getAttribute('data-render-state');

  if (renderState !== 'ready' && renderState !== 'error') {
    throw new Error(`Unexpected render state for ${selector}: ${renderState}`);
  }

  return renderState;
}

async function waitForFirstNonblankCanvas(
  page: Page,
  selector: string,
): Promise<number | null> {
  try {
    const handle = await page.waitForFunction(
      (canvasSelector) => {
        const startedAt = (globalThis as BrowserTimingGlobals)
          .__parallelNavigationStartedAt;
        const browserGlobals = globalThis as unknown as { document: BrowserDocument };
        const canvas = browserGlobals.document.querySelector(canvasSelector) as
          | (BrowserCanvas & {
              getContext?: (
                contextId: '2d',
                options?: { willReadFrequently: boolean },
              ) => BrowserCanvasContext | null;
            })
          | null;

        if (!canvas || canvas.width === 0 || canvas.height === 0) {
          return false;
        }

        const sampleCanvas = browserGlobals.document.createElement('canvas');
        sampleCanvas.width = canvas.width;
        sampleCanvas.height = canvas.height;
        const context = sampleCanvas.getContext('2d', {
          willReadFrequently: true,
        });

        if (!context || startedAt === undefined) {
          return false;
        }

        context.drawImage(canvas, 0, 0);
        const stepX = Math.max(1, Math.floor(canvas.width / 24));
        const stepY = Math.max(1, Math.floor(canvas.height / 24));

        for (let y = 0; y < canvas.height; y += stepY) {
          for (let x = 0; x < canvas.width; x += stepX) {
            const [red, green, blue, alpha] = context.getImageData(x, y, 1, 1).data;

            if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
              return performance.now() - startedAt;
            }
          }
        }

        return false;
      },
      selector,
      { timeout: NONBLANK_TIMEOUT_MS },
    );

    const value = await handle.jsonValue();

    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

async function waitForParallelFastHook(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof (globalThis as {
        __parallelFastPrototypeTestHooks?: { setBrushes?: unknown };
      }).__parallelFastPrototypeTestHooks?.setBrushes === 'function',
    undefined,
    { timeout: ROUTE_READY_TIMEOUT_MS },
  );
}

async function runParallelFastBrush(
  page: Page,
  scenario: BrushScenario,
): Promise<SelectionBenchmarkResult> {
  const startedAt = await page.evaluate((selectors) => {
    const hooks = (globalThis as {
      __parallelFastPrototypeTestHooks?: {
        setBrushes?: (nextSelectors: BrushSelector[]) => void;
      };
    }).__parallelFastPrototypeTestHooks;

    if (typeof hooks?.setBrushes !== 'function') {
      throw new Error('parallel-fast brush hook is unavailable.');
    }

    const startedAt = performance.now();
    hooks.setBrushes(selectors);
    return startedAt;
  }, scenario.selectors);
  const observedCount = await waitForSelectedCount(
    page,
    '[data-testid="parallel-fast-selection-state"]',
    scenario.expectedCount,
  );
  const completedAt = await page.evaluate(() => performance.now());
  await waitForParallelFastSelectedHighlight(page, scenario.expectedCount);
  const metrics = await readDataAttributes(
    page,
    '[data-testid="parallel-fast-route-diagnostics"]',
  );

  return {
    expectedCount: scenario.expectedCount,
    idMaterializationMs: numberMetric(metrics.selectedIdMaterializationMs),
    observedCount,
    reactSelectionCommitMs: numberMetric(metrics.reactSelectionCommitMs),
    routeMetricMs: numberMetric(metrics.selectionVisualUpdateMs),
    selectionComputeMs: numberMetric(metrics.brushComputeMs),
    selectedVisualBufferCreationMs: numberMetric(
      metrics.selectedVisualBufferCreationMs,
    ),
    selectedVisualGpuUploadMs: numberMetric(metrics.selectedVisualGpuUploadMs),
    selectedVisualMaskBuildMs: numberMetric(metrics.selectedVisualMaskBuildMs),
    selectedVisualMaskGpuUploadMs: numberMetric(
      metrics.selectedVisualMaskGpuUploadMs,
    ),
    selectedVisualRedrawMs: numberMetric(metrics.selectedVisualRedrawMs),
    selectionUpdateMs: null,
    setAndObserveMs: completedAt - startedAt,
    sourceIndexCreationMs: numberMetric(metrics.selectedSourceIndexCreationMs),
  };
}

async function runParallelFastExportSerialization(
  page: Page,
): Promise<{ byteLength: number; ms: number } | null> {
  return page.evaluate(() => {
    const hooks = (globalThis as {
      __parallelFastPrototypeTestHooks?: {
        serializeSelectedIdsForBenchmark?: () => { byteLength: number; ms: number };
      };
    }).__parallelFastPrototypeTestHooks;

    if (typeof hooks?.serializeSelectedIdsForBenchmark !== 'function') {
      return null;
    }

    return hooks.serializeSelectedIdsForBenchmark();
  });
}

async function runParallelFastPointerDrag(
  page: Page,
): Promise<PointerDragBenchmarkResult | null> {
  const axis = page.locator('.parallel-fast-axis-guide').first();
  const box = await axis.boundingBox();

  if (box === null) {
    return null;
  }

  const moveCount = 18;
  const startX = box.width / 2;
  const startY = box.height * 0.25;
  const endY = box.height * 0.82;
  const metricsBeforeDrag = await readDataAttributes(
    page,
    '[data-testid="parallel-fast-route-diagnostics"]',
  );
  const streamStartedAt = await page.evaluate(() => performance.now());

  await axis.hover({ position: { x: startX, y: startY } });
  await page.mouse.down();

  for (let index = 1; index <= moveCount; index += 1) {
    const y = startY + ((endY - startY) * index) / moveCount;
    await axis.hover({ position: { x: startX, y } });
  }

  const metricsDuringDrag = await readDataAttributes(
    page,
    '[data-testid="parallel-fast-route-diagnostics"]',
  );
  await page.mouse.up();
  const streamCompletedAt = await page.evaluate(() => performance.now());
  const finalObservedCount = await waitForAnySelectedCount(
    page,
    '[data-testid="parallel-fast-selection-state"]',
  );
  const observedAt = await page.evaluate(() => performance.now());

  return {
    brushComputeChangedDuringDrag:
      numberMetric(metricsBeforeDrag.brushComputeMs) !==
      numberMetric(metricsDuringDrag.brushComputeMs),
    brushComputeDuringDrag: numberMetric(metricsDuringDrag.brushComputeMs),
    brushComputeBeforeDrag: numberMetric(metricsBeforeDrag.brushComputeMs),
    finalObservedCount,
    moveCount,
    observedMs: observedAt - streamStartedAt,
    selectionFreshnessDuringDrag:
      typeof metricsDuringDrag.selectionFreshness === 'string'
        ? metricsDuringDrag.selectionFreshness
        : null,
    streamMs: streamCompletedAt - streamStartedAt,
  };
}

async function waitForSelectedCount(
  page: Page,
  selector: string,
  expectedCount: number,
): Promise<number> {
  await page.waitForFunction(
    ({ expectedCount, selector }) => {
        const browserGlobals = globalThis as unknown as { document: BrowserDocument };
        const element = browserGlobals.document.querySelector(selector);
      const count = Number(element?.dataset.selectedCount ?? 'NaN');

      return count === expectedCount;
    },
    { expectedCount, selector },
    { timeout: SELECT_TIMEOUT_MS },
  );

  const count = await page.locator(selector).getAttribute('data-selected-count');

  return Number(count ?? '0');
}

async function waitForAnySelectedCount(
  page: Page,
  selector: string,
): Promise<number> {
  await page.waitForFunction(
    (selector) => {
      const browserGlobals = globalThis as unknown as { document: BrowserDocument };
      const element = browserGlobals.document.querySelector(selector);
      const count = Number(element?.dataset.selectedCount ?? 'NaN');

      return Number.isFinite(count) && count > 0;
    },
    selector,
    { timeout: SELECT_TIMEOUT_MS },
  );

  const count = await page.locator(selector).getAttribute('data-selected-count');

  return Number(count ?? '0');
}

async function waitForParallelFastSelectedHighlight(
  page: Page,
  expectedCount: number,
): Promise<number> {
  await page.waitForFunction(
    (expectedCount) => {
      const browserGlobals = globalThis as unknown as { document: BrowserDocument };
      const element = browserGlobals.document.querySelector(
        '[data-testid="parallel-fast-chart-layout"]',
      );
      const count = Number(element?.dataset.selectedHighlightCount ?? 'NaN');

      return count === expectedCount;
    },
    expectedCount,
    { timeout: SELECT_TIMEOUT_MS },
  );

  const count = await page
    .locator('[data-testid="parallel-fast-chart-layout"]')
    .getAttribute('data-selected-highlight-count');

  return Number(count ?? '0');
}

async function runPointerHoverInspect(
  page: Page,
  hoverSelector: string,
  metricsSelector: string,
  metricName: string,
): Promise<number | null> {
  const target = page.locator(hoverSelector).first();
  const box = await target.boundingBox();

  if (box === null) {
    return null;
  }

  await target.hover({
    position: {
      x: box.width * 0.52,
      y: box.height * 0.48,
    },
  });

  try {
    await page.waitForFunction(
      ({ metricName, metricsSelector }) => {
        const browserGlobals = globalThis as unknown as { document: BrowserDocument };
        const element = browserGlobals.document.querySelector(metricsSelector);
        const value = element?.dataset[metricName];

        return value !== undefined && value !== 'n/a';
      },
      { metricName, metricsSelector },
      { timeout: HOVER_TIMEOUT_MS },
    );
  } catch {
    return null;
  }

  const metrics = await readDataAttributes(page, metricsSelector);

  return numberMetric(metrics[metricName]);
}

async function runParallelFastHoverTrace(
  page: Page,
): Promise<HoverTraceBenchmarkResult | null> {
  const target = page.locator('.parallel-fast-axis-overlay').first();
  const box = await target.boundingBox();

  if (box === null) {
    return null;
  }

  const moveCount = 48;
  const hoverResolveMs: number[] = [];
  const hoverVisualRedrawMs: number[] = [];
  const hoverVisualUpdateMs: number[] = [];
  const hoverVisualUploadBytes: number[] = [];
  const startedAt = await page.evaluate(() => performance.now());

  for (let index = 0; index < moveCount; index += 1) {
    const t = moveCount <= 1 ? 0 : index / (moveCount - 1);
    await target.hover({
      position: {
        x: box.width * (0.08 + t * 0.84),
        y: box.height * (0.24 + (index % 7) * 0.07),
      },
    });
    await page.waitForFunction(
      (metricsSelector) => {
        const browserGlobals = globalThis as unknown as { document: BrowserDocument };
        const element = browserGlobals.document.querySelector(metricsSelector);
        return element?.dataset.hoverVisualMode === 'webgl2-hover-overlay-canvas';
      },
      '[data-testid="parallel-fast-route-diagnostics"]',
      { timeout: HOVER_TIMEOUT_MS },
    );
    const metrics = await readDataAttributes(
      page,
      '[data-testid="parallel-fast-route-diagnostics"]',
    );
    pushNumberMetric(hoverResolveMs, metrics.hoverResolveMs);
    pushNumberMetric(hoverVisualRedrawMs, metrics.hoverVisualRedrawMs);
    pushNumberMetric(hoverVisualUpdateMs, metrics.hoverVisualUpdateMs);
    pushNumberMetric(hoverVisualUploadBytes, metrics.hoverVisualUploadBytes);
  }

  const completedAt = await page.evaluate(() => performance.now());

  return {
    hoverResolveMsMedian: medianNumbers(hoverResolveMs),
    hoverResolveMsP95: percentileNumbers(hoverResolveMs, 0.95),
    hoverVisualRedrawMsMedian: medianNumbers(hoverVisualRedrawMs),
    hoverVisualRedrawMsP95: percentileNumbers(hoverVisualRedrawMs, 0.95),
    hoverVisualUpdateMsMedian: medianNumbers(hoverVisualUpdateMs),
    hoverVisualUpdateMsP95: percentileNumbers(hoverVisualUpdateMs, 0.95),
    hoverVisualUploadBytesMedian: medianNumbers(hoverVisualUploadBytes),
    moveCount,
    observedMs: completedAt - startedAt,
  };
}

function pushNumberMetric(
  target: number[],
  value: number | string | boolean | null | undefined,
): void {
  if (typeof value === 'number') {
    target.push(value);
  }
}

async function readElapsedFromNavigation(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const startedAt = (globalThis as BrowserTimingGlobals).__parallelNavigationStartedAt;

    return startedAt === undefined ? null : performance.now() - startedAt;
  });
}

async function readDataAttributes(
  page: Page,
  selector: string,
): Promise<Record<string, number | string | boolean | null>> {
  return page.locator(selector).evaluate((element) => {
    const result: Record<string, number | string | boolean | null> = {};
    const dataset = (element as unknown as BrowserElement).dataset;

    for (const [key, value] of Object.entries(dataset)) {
      if (value === undefined) {
        continue;
      }
      if (value === 'n/a') {
        result[key] = null;
      } else if (value === 'true' || value === 'false') {
        result[key] = value === 'true';
      } else if (value !== '' && Number.isFinite(Number(value))) {
        result[key] = Number(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  });
}

function createSkippedSelectionResult(expectedCount: number): SelectionBenchmarkResult {
  return {
    expectedCount,
    idMaterializationMs: null,
    observedCount: 0,
    reactSelectionCommitMs: null,
    routeMetricMs: null,
    selectionComputeMs: null,
    selectedVisualBufferCreationMs: null,
    selectedVisualGpuUploadMs: null,
    selectedVisualMaskBuildMs: null,
    selectedVisualMaskGpuUploadMs: null,
    selectedVisualRedrawMs: null,
    selectionUpdateMs: null,
    setAndObserveMs: 0,
    sourceIndexCreationMs: null,
  };
}

function readParallelDataset(path: URL): ParallelDataset {
  return JSON.parse(readFileSync(path, 'utf8')) as ParallelDataset;
}

export function createParallelFastBenchmarkUrl(baseUrl: string): string {
  const searchParams = new URLSearchParams({
    __benchmark: '1',
    __e2eParallelFastBrushHook: '1',
    __e2eParallelFastDataset: PARALLEL_FAST_ROUTE_DATASET_URL,
    __parallelFastHoverMode: '1',
  });

  return `${baseUrl}/m-parallel?${searchParams}`;
}

export function createBrushScenario(
  records: readonly ParallelRecord[],
  axisCount: 1 | 2,
): BrushScenario {
  const axes = AXIS_ORDER.slice(0, axisCount);
  const seedRecords = records.slice(25, 95);
  const selectors = axes.map((axis) => {
    const values = seedRecords.map((record) => record[axis]);

    return {
      axis,
      end: Math.max(...values),
      start: Math.min(...values),
    };
  });
  const expectedCount = records.filter((record) =>
    selectors.every(
      (selector) =>
        record[selector.axis] >= selector.start &&
        record[selector.axis] <= selector.end,
    ),
  ).length;

  if (expectedCount === 0 || expectedCount >= records.length) {
    throw new Error(
      `Brush scenario produced an invalid selected count: ${expectedCount}`,
    );
  }

  return {
    expectedCount,
    selectors,
  };
}

interface Options {
  port: number;
  runs: number;
}

export function parseArgs(args: string[]): Options {
  const options: Options = {
    port: DEFAULT_PORT,
    runs: DEFAULT_RUNS,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--') {
      continue;
    }

    const [flag, inlineValue] = arg.split('=', 2);
    const value = inlineValue ?? args[index + 1];

    if (inlineValue === undefined) {
      index += 1;
    }

    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}.`);
    }

    switch (flag) {
      case '--port':
        options.port = parsePositiveInteger(value, flag);
        break;
      case '--runs':
        options.runs = parsePositiveInteger(value, flag);
        break;
      case '--target':
        if (value !== 'custom') {
          throw new Error(`--target must be "custom". Received: ${value}`);
        }
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  return options;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer. Received: ${value}`);
  }

  return parsed;
}

async function assertPortAvailable(port: number): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}`, {
      signal: AbortSignal.timeout(500),
    });

    if (response.ok) {
      throw new Error(
        `Port ${port} is already serving HTTP. Stop the existing server or pass --port.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('already serving HTTP')) {
      throw error;
    }
  }
}

function startViteServer(port: number): ChildProcess {
  return spawn(
    'pnpm',
    ['dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

async function waitForSpawnedViteServer(
  baseUrl: string,
  server: ChildProcess,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for spawned Vite dev server to print ${baseUrl}.`,
        ),
      );
    }, 120_000);

    const cleanup = () => {
      clearTimeout(timeout);
      server.stdout?.off('data', handleOutput);
      server.stderr?.off('data', handleOutput);
      server.off('exit', handleExit);
      server.off('error', handleError);
    };
    const handleOutput = (chunk: Buffer) => {
      output += chunk.toString();

      if (output.includes(baseUrl)) {
        cleanup();
        resolve();
      }
    };
    const handleExit = (code: number | null) => {
      cleanup();
      reject(
        new Error(
          `Vite dev server exited before printing ${baseUrl} with code ${code}.`,
        ),
      );
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    server.stdout?.on('data', handleOutput);
    server.stderr?.on('data', handleOutput);
    server.once('exit', handleExit);
    server.once('error', handleError);
  });
}

async function stopViteServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) {
    return;
  }

  server.kill('SIGTERM');

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (server.exitCode === null) {
        server.kill('SIGKILL');
      }
      resolve();
    }, 5_000);

    server.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function createSummary(results: readonly BenchmarkResult[]) {
  return {
    parallelFast: summarizeRoute(results.map((result) => result.parallelFast)),
  };
}

function summarizeRoute(results: readonly RouteBenchmarkResult[]) {
  return {
    firstNonblankFromNavigationMsMedian: medianNumbers(
      results.map((result) => result.firstNonblankFromNavigationMs),
    ),
    hoverInspectMsMedian: medianNumbers(
      results.map((result) => result.hoverInspectMs),
    ),
    hoverTraceResolveMsMedian: medianNumbers(
      results.map((result) => result.hoverTrace?.hoverResolveMsMedian ?? null),
    ),
    hoverTraceResolveMsP95: medianNumbers(
      results.map((result) => result.hoverTrace?.hoverResolveMsP95 ?? null),
    ),
    hoverTraceVisualRedrawMsMedian: medianNumbers(
      results.map((result) => result.hoverTrace?.hoverVisualRedrawMsMedian ?? null),
    ),
    hoverTraceVisualRedrawMsP95: medianNumbers(
      results.map((result) => result.hoverTrace?.hoverVisualRedrawMsP95 ?? null),
    ),
    hoverTraceVisualUpdateMsMedian: medianNumbers(
      results.map((result) => result.hoverTrace?.hoverVisualUpdateMsMedian ?? null),
    ),
    hoverTraceVisualUpdateMsP95: medianNumbers(
      results.map((result) => result.hoverTrace?.hoverVisualUpdateMsP95 ?? null),
    ),
    hoverTraceVisualUploadBytesMedian: medianNumbers(
      results.map((result) => result.hoverTrace?.hoverVisualUploadBytesMedian ?? null),
    ),
    exportSerializationMsMedian: medianNumbers(
      results.map((result) => result.exportSerializationMs),
    ),
    oneAxisComputeMsMedian: medianNumbers(
      results.map((result) => result.brush.oneAxis.selectionComputeMs),
    ),
    oneAxisRouteMetricMsMedian: medianNumbers(
      results.map((result) => result.brush.oneAxis.routeMetricMs),
    ),
    oneAxisSetAndObserveMsMedian: medianNumbers(
      results.map((result) => result.brush.oneAxis.setAndObserveMs),
    ),
    oneAxisSourceIndexCreationMsMedian: medianNumbers(
      results.map((result) => result.brush.oneAxis.sourceIndexCreationMs),
    ),
    oneAxisIdMaterializationMsMedian: medianNumbers(
      results.map((result) => result.brush.oneAxis.idMaterializationMs),
    ),
    oneAxisSelectedVisualBufferCreationMsMedian: medianNumbers(
      results.map((result) => result.brush.oneAxis.selectedVisualBufferCreationMs),
    ),
    oneAxisSelectedVisualGpuUploadMsMedian: medianNumbers(
      results.map((result) => result.brush.oneAxis.selectedVisualGpuUploadMs),
    ),
    oneAxisSelectedVisualRedrawMsMedian: medianNumbers(
      results.map((result) => result.brush.oneAxis.selectedVisualRedrawMs),
    ),
    pointerDragObservedMsMedian: medianNumbers(
      results.map((result) => result.brush.pointerDrag?.observedMs ?? null),
    ),
    pointerDragStreamMsMedian: medianNumbers(
      results.map((result) => result.brush.pointerDrag?.streamMs ?? null),
    ),
    recordCount: results[0]?.recordCount ?? 0,
    routeReadyFromNavigationMsMedian: medianNumbers(
      results.map((result) => result.routeReadyFromNavigationMs),
    ),
    twoAxisComputeMsMedian: medianNumbers(
      results.map((result) => result.brush.twoAxis.selectionComputeMs),
    ),
    twoAxisRouteMetricMsMedian: medianNumbers(
      results.map((result) => result.brush.twoAxis.routeMetricMs),
    ),
    twoAxisSetAndObserveMsMedian: medianNumbers(
      results.map((result) => result.brush.twoAxis.setAndObserveMs),
    ),
  };
}

function medianNumbers(values: readonly (number | null)[]): number | null {
  const numberValues = values.filter((value): value is number => value !== null);

  if (numberValues.length === 0) {
    return null;
  }

  const sorted = [...numberValues].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }

  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function percentileNumbers(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentile) - 1),
  );

  return sorted[index];
}

function numberMetric(value: number | string | boolean | null | undefined): number | null {
  return typeof value === 'number' ? value : null;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
