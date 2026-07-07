import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { chromium, type Page } from '@playwright/test';

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
}

type HistogramScenarioId = 'barMode' | 'rawMixedTable' | 'rawSingleTable';
type TimedStatus = 'ok' | 'timeout' | 'unavailable';

interface HistogramRouteState {
  activeSubplotId: string | null;
  binCount: number;
  binSize: number | null;
  binSizeComputeMs?: number | null;
  binSizeDebounceMs?: number | null;
  binSizeEffective?: number | null;
  binSizeMembershipFinalizeMs?: number | null;
  binSizeObservableMs?: number | null;
  binSizePending: boolean;
  binSizeRequestedVisibleBinCount?: number | null;
  binSizeStatus?: string | null;
  binSizeVisibleBinCount?: number | null;
  focusedSubplotId: string | null;
  histMode: 'bar' | 'histogram';
  hoverActive: boolean;
  measurementActive: boolean;
  parameterCount: number;
  populatedBinCount: number;
  recordCount: number;
  renderState: {
    message?: string;
    status: 'error' | 'idle' | 'ready' | 'rendering';
  };
  selectedCount: number;
  sourceIndicesAvailable: boolean;
  stackSegmentCount: number;
  tableMode: 'multi' | 'single';
}

interface HistogramMetric {
  aggregateBuildMs?: number;
  at?: number;
  binCount?: number;
  colorSegmentCount?: number;
  detail?: string;
  drawCalls?: number;
  durationMs?: number;
  gpuDurationMs?: number;
  gpuTimerSupported?: boolean;
  mode?: 'bar' | 'histogram';
  phase:
    | 'aggregation'
    | 'bar-normalize'
    | 'buffer-upload'
    | 'dispose'
    | 'hover'
    | 'init'
    | 'interaction'
    | 'measurement'
    | 'render'
    | 'selection';
  pointCount?: number;
  selectedBinCount?: number;
  selectedSourceCount?: number;
  stackSegmentCount?: number;
  subplotCount?: number;
  uploadBytes?: number;
  visibleBinCount?: number;
}

interface SerializationResult {
  available: boolean;
  byteLength: number | null;
  count: number;
  message?: string;
  ms: number;
}

interface TimedResult {
  observedMs: number;
  status: TimedStatus;
}

interface BinSizeChangeResult extends TimedResult {
  computeMs: number | null;
  debounceMs: number | null;
  effectiveBinSize: number | null;
  finalBinSize: number | null;
  membershipFinalizeMs: number | null;
  observableMs: number | null;
  renderMs: number | null;
  requestedVisibleBinCount: number | null;
  statusDetail: string | null;
  visibleBinCount: number | null;
}

interface RectangleSelectionResult extends TimedResult {
  selectedBinCount: number | null;
  selectedSourceCount: number | null;
  selectedVisualUpdateMs: number | null;
  selectedVisualUpdateObservable: boolean;
  selectionComputeMs: number | null;
}

interface PointerTraceSummary {
  metricMsP50: number | null;
  metricMsP95: number | null;
  okCount: number;
  observedMs: number;
  sampleCount: number;
}

interface RouteBenchmarkResult {
  barModeRenderMs: number | null;
  binSizeChange: BinSizeChangeResult | null;
  canvasNonblank: boolean;
  exportSerialization: SerializationResult | null;
  firstNonblankFromNavigationMs: number | null;
  hoverTrace: PointerTraceSummary | null;
  measurementTrace: PointerTraceSummary | null;
  metricHistoryCount: number;
  metrics: {
    aggregationBuildMs: number | null;
    bufferUploadBytes: number | null;
    bufferUploadMs: number | null;
    drawCalls: number | null;
    renderGpuMs: number | null;
    renderMs: number | null;
    visibleBinCount: number | null;
  };
  recordCount: number;
  renderState: HistogramRouteState['renderState'];
  route: '/m-histogram';
  routeReadyFromNavigationMs: number | null;
  scenario: HistogramScenarioId;
  selection: RectangleSelectionResult | null;
}

interface BenchmarkResult {
  barMode: RouteBenchmarkResult;
  rawMixedTable: RouteBenchmarkResult;
  rawSingleTable: RouteBenchmarkResult;
  run: number;
}

interface Options {
  port: number;
  runs: number;
}

const DEFAULT_PORT = 5188;
const DEFAULT_RUNS = 1;
const ACTION_TIMEOUT_MS = 30_000;
const ROUTE_READY_TIMEOUT_MS = 300_000;
const NONBLANK_TIMEOUT_MS = 300_000;
const HISTOGRAM_CANVAS_SELECTOR = '.histogram-fast-webgl-canvas';
const HISTOGRAM_HOST_SELECTOR = '[data-testid="histogram-fast-route-host"]';
export const HISTOGRAM_FAST_SCATTER_DATASET_URL = '/data/scatter-fast-sample.json';
export const HISTOGRAM_FAST_SCATTER_SCHEMA_URL = '/data/scatter-fast-schema.json';
export const HISTOGRAM_FAST_MIXED_TABLE_URL = '/data/mixed-table-fixture.json';
export const HISTOGRAM_FAST_BAR_DATASET_URL = '/data/histogram-bars-sample.json';
const REQUIRED_DATA_PATHS = [
  'apps/demo/public/data/scatter-fast-sample.json',
  'apps/demo/public/data/scatter-fast-schema.json',
  'apps/demo/public/data/mixed-table-fixture.json',
  'apps/demo/public/data/histogram-bars-sample.json',
] as const;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  requireBenchmarkData();
  await assertPortAvailable(options.port);
  const server = startViteServer(options.port);
  const baseUrl = `http://127.0.0.1:${options.port}`;

  try {
    await waitForSpawnedViteServer(baseUrl, server);

    const results: BenchmarkResult[] = [];
    for (let run = 1; run <= options.runs; run += 1) {
      console.error(`benchmark:histogram run ${run}/${options.runs} raw single-table`);
      const rawSingleTable = await benchmarkHistogramRoute(
        baseUrl,
        'rawSingleTable',
      );
      console.error(`benchmark:histogram run ${run}/${options.runs} raw mixed-table`);
      const rawMixedTable = await benchmarkHistogramRoute(
        baseUrl,
        'rawMixedTable',
      );
      console.error(`benchmark:histogram run ${run}/${options.runs} bar mode`);
      const barMode = await benchmarkHistogramRoute(baseUrl, 'barMode');

      const result = { barMode, rawMixedTable, rawSingleTable, run };
      validateBenchmarkResult(result);
      results.push(result);
    }

    console.log(JSON.stringify({ results, summary: createSummary(results) }, null, 2));
  } finally {
    await stopViteServer(server);
  }
}

async function benchmarkHistogramRoute(
  baseUrl: string,
  scenario: HistogramScenarioId,
): Promise<RouteBenchmarkResult> {
  const page = await createPage();

  try {
    await page.goto(createHistogramFastBenchmarkUrl(baseUrl, scenario), {
      timeout: ROUTE_READY_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    });

    const firstNonblankPromise = waitForFirstNonblankCanvas(
      page,
      HISTOGRAM_CANVAS_SELECTOR,
    );
    await waitForHistogramHooks(page);
    await waitForHistogramReady(page);
    const routeReadyFromNavigationMs = await readElapsedFromNavigation(page);
    const firstNonblankFromNavigationMs = await firstNonblankPromise;
    const routeState = await readHistogramRouteState(page);
    const startupMetrics = await readHistogramMetrics(page);
    const hoverTrace =
      scenario === 'barMode' ? null : await runHistogramHoverTrace(page);
    const measurementTrace =
      scenario === 'barMode' ? null : await runHistogramMeasurementTrace(page);
    const binSizeChange =
      scenario === 'barMode' ? null : await runHistogramBinSizeChange(page);
    const selection =
      scenario === 'barMode' ? null : await runHistogramRectangleSelection(page);
    const exportSerialization =
      scenario === 'barMode' ? null : await runHistogramExportSerialization(page);
    const finalMetrics = await readHistogramMetrics(page);
    const canvasNonblank = await isCanvasNonblank(page, HISTOGRAM_CANVAS_SELECTOR);
    const metrics = createMetricSnapshot(finalMetrics.history, startupMetrics.history);

    return {
      barModeRenderMs: scenario === 'barMode' ? metrics.renderMs : null,
      binSizeChange,
      canvasNonblank,
      exportSerialization,
      firstNonblankFromNavigationMs,
      hoverTrace,
      measurementTrace,
      metricHistoryCount: finalMetrics.history.length,
      metrics,
      recordCount: routeState.recordCount,
      renderState: routeState.renderState,
      route: '/m-histogram',
      routeReadyFromNavigationMs,
      scenario,
      selection,
    };
  } finally {
    await page.close();
  }
}

async function createPage(): Promise<Page> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  page.once('close', () => {
    void browser.close();
  });
  await page.addInitScript(() => {
    (globalThis as { __histogramNavigationStartedAt?: number })
      .__histogramNavigationStartedAt = performance.now();
    (globalThis as {
      __histogramCanvasHasContent?: (selector: string) => boolean;
    }).__histogramCanvasHasContent = (selector: string) => {
      const browserGlobals = globalThis as unknown as {
        document: BrowserDocument;
      };
      const canvas = browserGlobals.document.querySelector(selector) as
        | (BrowserCanvas & {
            getContext: (
              contextId: '2d',
              options?: { willReadFrequently: boolean },
            ) => BrowserCanvasContext | null;
          })
        | null;
      if (canvas === null || canvas.width === 0 || canvas.height === 0) {
        return false;
      }
      const sampleCanvas = browserGlobals.document.createElement('canvas');
      sampleCanvas.width = canvas.width;
      sampleCanvas.height = canvas.height;
      const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (context === null) {
        return false;
      }
      context.drawImage(canvas, 0, 0);
      const stepX = Math.max(1, Math.floor(canvas.width / 24));
      const stepY = Math.max(1, Math.floor(canvas.height / 24));

      for (let y = 0; y < canvas.height; y += stepY) {
        for (let x = 0; x < canvas.width; x += stepX) {
          const [red, green, blue, alpha] = context.getImageData(x, y, 1, 1).data;
          if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
            return true;
          }
        }
      }

      return false;
    };
  });

  return page;
}

async function waitForHistogramHooks(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const globals = globalThis as {
        __histogramFastBenchmarkTestHook?: {
          getRouteState?: unknown;
          serializeSelectedIdsForBenchmark?: unknown;
        };
        __histogramFastHoverTestHook?: unknown;
        __histogramFastMeasurementTestHook?: unknown;
        __histogramFastRouteStateTestHook?: unknown;
        __histogramFastSelectionTestHook?: unknown;
      };
      return (
        typeof globals.__histogramFastBenchmarkTestHook?.getRouteState === 'function' &&
        typeof globals.__histogramFastBenchmarkTestHook
          .serializeSelectedIdsForBenchmark === 'function' &&
        typeof globals.__histogramFastRouteStateTestHook === 'function' &&
        typeof globals.__histogramFastSelectionTestHook === 'function' &&
        typeof globals.__histogramFastHoverTestHook === 'function' &&
        typeof globals.__histogramFastMeasurementTestHook === 'function'
      );
    },
    undefined,
    { timeout: ROUTE_READY_TIMEOUT_MS },
  );
}

async function waitForHistogramReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const error = globalThis.document.querySelector(
        '.histogram-fast-render-error',
      )?.textContent;
      if (error !== undefined && error !== null && error.trim() !== '') {
        return 'error';
      }
      const hook = (globalThis as {
        __histogramFastBenchmarkTestHook?: {
          getMetricHistory?: () => readonly HistogramMetric[];
          getRouteState?: () => HistogramRouteState | null;
        };
      }).__histogramFastBenchmarkTestHook;
      const state = hook?.getRouteState?.();
      const hasRenderMetric =
        hook?.getMetricHistory?.().some((metric) => metric.phase === 'render') ?? false;

      if (state?.renderState.status === 'error') {
        return 'error';
      }

      return state !== null && state !== undefined && hasRenderMetric ? 'ready' : false;
    },
    undefined,
    { timeout: ROUTE_READY_TIMEOUT_MS },
  );
  const errorText = await page
    .locator('.histogram-fast-render-error')
    .textContent({ timeout: 100 })
    .catch(() => null);
  if (errorText !== null && errorText.trim() !== '') {
    throw new Error(`Histogram route failed: ${errorText.trim()}`);
  }
  const state = await readHistogramRouteState(page);
  if (state.renderState.status === 'error') {
    throw new Error(
      `Histogram route failed: ${state.renderState.message ?? state.renderState.status}`,
    );
  }
}

async function waitForFirstNonblankCanvas(
  page: Page,
  selector: string,
): Promise<number | null> {
  try {
    const handle = await page.waitForFunction(
      (canvasSelector) => {
        const startedAt = (globalThis as { __histogramNavigationStartedAt?: number })
          .__histogramNavigationStartedAt;
        const hasContent = (globalThis as {
          __histogramCanvasHasContent?: (selector: string) => boolean;
        }).__histogramCanvasHasContent;

        return startedAt !== undefined && hasContent?.(canvasSelector) === true
          ? performance.now() - startedAt
          : false;
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

async function readHistogramRouteState(page: Page): Promise<HistogramRouteState> {
  await page.waitForFunction(
    () => {
      const state = (
        globalThis as {
          __histogramFastBenchmarkTestHook?: {
            getRouteState?: () => HistogramRouteState | null;
          };
        }
      ).__histogramFastBenchmarkTestHook?.getRouteState?.();
      return state !== null && state !== undefined;
    },
    undefined,
    { timeout: ACTION_TIMEOUT_MS },
  );
  return page.evaluate(() => {
    const state = (
      globalThis as {
        __histogramFastBenchmarkTestHook?: {
          getRouteState?: () => HistogramRouteState | null;
        };
      }
    ).__histogramFastBenchmarkTestHook?.getRouteState?.();
    if (state === null || state === undefined) {
      throw new Error('Histogram route state hook returned no state.');
    }

    return state;
  });
}

async function readHistogramMetrics(page: Page): Promise<{
  history: HistogramMetric[];
  last: HistogramMetric | null;
}> {
  return page.evaluate(() => {
    const hook = (
      globalThis as {
        __histogramFastBenchmarkTestHook?: {
          getLastMetrics?: () => HistogramMetric | null;
          getMetricHistory?: () => readonly HistogramMetric[];
        };
      }
    ).__histogramFastBenchmarkTestHook;
    const history = hook?.getMetricHistory?.();
    if (history === undefined) {
      throw new Error('Histogram metric history hook is unavailable.');
    }

    return {
      history: [...history],
      last: hook?.getLastMetrics?.() ?? null,
    };
  });
}

async function runHistogramBinSizeChange(page: Page): Promise<BinSizeChangeResult> {
  const startedAt = performance.now();
  try {
    const before = await readHistogramRouteState(page);
    const targetBinSize = (before.binSize ?? 1_000_000) * 0.82;
    const accepted = await page.evaluate((binSize) => {
      const hook = (
        globalThis as {
          __histogramFastBenchmarkTestHook?: {
            setRawBinSizeForBenchmark?: (nextBinSize: number) => boolean;
          };
        }
      ).__histogramFastBenchmarkTestHook;
      if (typeof hook?.setRawBinSizeForBenchmark !== 'function') {
        throw new Error('Histogram raw bin-size benchmark hook is unavailable.');
      }

      return hook.setRawBinSizeForBenchmark(binSize);
    }, targetBinSize);
    if (!accepted) {
      throw new Error('Histogram raw bin-size benchmark hook rejected the update.');
    }
    await page.waitForFunction(
      (expectedBinSize) => {
        const state = (
          globalThis as {
            __histogramFastBenchmarkTestHook?: {
              getRouteState?: () => HistogramRouteState | null;
            };
          }
        ).__histogramFastBenchmarkTestHook?.getRouteState?.();
        return (
          state !== null &&
          state !== undefined &&
          state.binSize !== null &&
          Math.abs(state.binSize - expectedBinSize) <=
            Math.max(1e-3, Math.abs(expectedBinSize) * 1e-9) &&
          state.binSizePending === false &&
          state.binSizeEffective !== null &&
          state.binSizeVisibleBinCount !== null
        );
      },
      targetBinSize,
      { timeout: ACTION_TIMEOUT_MS },
    );
    const state = await readHistogramRouteState(page);
    const metrics = await readHistogramMetrics(page);

    return {
      computeMs: state.binSizeComputeMs ?? null,
      debounceMs: state.binSizeDebounceMs ?? null,
      effectiveBinSize: state.binSizeEffective ?? null,
      finalBinSize: state.binSize ?? targetBinSize,
      membershipFinalizeMs: state.binSizeMembershipFinalizeMs ?? null,
      observedMs: performance.now() - startedAt,
      observableMs: state.binSizeObservableMs ?? null,
      renderMs: latestMetric(metrics.history, 'render')?.durationMs ?? null,
      requestedVisibleBinCount: state.binSizeRequestedVisibleBinCount ?? null,
      status: 'ok',
      statusDetail: state.binSizeStatus ?? null,
      visibleBinCount: state.binSizeVisibleBinCount ?? null,
    };
  } catch (error) {
    const fallbackState = await readHistogramRouteState(page).catch(() => null);
    if (
      fallbackState !== null &&
      fallbackState.binSize !== null &&
      fallbackState.binSizePending === false &&
      fallbackState.binSizeEffective !== null &&
      fallbackState.binSizeVisibleBinCount !== null
    ) {
      const metrics = await readHistogramMetrics(page).catch(() => ({
        history: [] as HistogramMetric[],
        last: null as HistogramMetric | null,
      }));
      return {
        computeMs: fallbackState.binSizeComputeMs ?? null,
        debounceMs: fallbackState.binSizeDebounceMs ?? null,
        effectiveBinSize: fallbackState.binSizeEffective ?? null,
        finalBinSize: fallbackState.binSize,
        membershipFinalizeMs: fallbackState.binSizeMembershipFinalizeMs ?? null,
        observedMs: performance.now() - startedAt,
        observableMs: fallbackState.binSizeObservableMs ?? null,
        renderMs: latestMetric(metrics.history, 'render')?.durationMs ?? null,
        requestedVisibleBinCount:
          fallbackState.binSizeRequestedVisibleBinCount ?? null,
        status: 'ok',
        statusDetail: fallbackState.binSizeStatus ?? null,
        visibleBinCount: fallbackState.binSizeVisibleBinCount ?? null,
      };
    }
    return {
      computeMs: null,
      debounceMs: null,
      effectiveBinSize: null,
      finalBinSize: null,
      membershipFinalizeMs: null,
      observedMs: performance.now() - startedAt,
      observableMs: null,
      renderMs: null,
      requestedVisibleBinCount: null,
      status: classifyTimedError(error),
      statusDetail: null,
      visibleBinCount: null,
    };
  }
}

async function runHistogramRectangleSelection(
  page: Page,
): Promise<RectangleSelectionResult> {
  const startedAt = performance.now();
  try {
    const result = await page.evaluate(() => {
      const hook = (
        globalThis as {
          __histogramFastBenchmarkTestHook?: {
            selectRectangleForBenchmark?: () => {
              available: boolean;
              message?: string;
              ms: number;
              selectedBinCount: number | null;
              selectedSourceCount: number | null;
              selectionComputeMs: number | null;
            };
          };
        }
      ).__histogramFastBenchmarkTestHook;
      if (typeof hook?.selectRectangleForBenchmark !== 'function') {
        throw new Error('Histogram rectangle-selection benchmark hook is unavailable.');
      }

      return hook.selectRectangleForBenchmark();
    });
    if (!result.available) {
      throw new Error(result.message ?? 'Histogram rectangle selection was unavailable.');
    }
    if (result.selectedSourceCount === null) {
      throw new Error('Histogram rectangle selection returned no source count.');
    }
    await page.waitForFunction(
      (expectedCount) => {
        const selection = (
          globalThis as {
            __histogramFastSelectionTestHook?: () => {
              selectedBinCount: number;
              selectedSourceCount: number;
            } | null;
          }
        ).__histogramFastSelectionTestHook?.();
        return (
          selection !== null &&
          selection !== undefined &&
          selection.selectedSourceCount === expectedCount
        );
      },
      result.selectedSourceCount,
      { timeout: ACTION_TIMEOUT_MS },
    );

    return {
      observedMs: performance.now() - startedAt,
      selectedBinCount: result.selectedBinCount,
      selectedSourceCount: result.selectedSourceCount,
      selectedVisualUpdateMs: null,
      selectedVisualUpdateObservable: false,
      selectionComputeMs: result.selectionComputeMs,
      status: 'ok',
    };
  } catch (error) {
    return {
      observedMs: performance.now() - startedAt,
      selectedBinCount: null,
      selectedSourceCount: null,
      selectedVisualUpdateMs: null,
      selectedVisualUpdateObservable: false,
      selectionComputeMs: null,
      status: classifyTimedError(error),
    };
  }
}

async function runHistogramExportSerialization(
  page: Page,
): Promise<SerializationResult> {
  return page.evaluate(() => {
    const hook = (
      globalThis as {
        __histogramFastBenchmarkTestHook?: {
          serializeSelectedRecordsForBenchmark?: () => SerializationResult;
        };
      }
    ).__histogramFastBenchmarkTestHook;
    if (typeof hook?.serializeSelectedRecordsForBenchmark !== 'function') {
      throw new Error('Histogram export serialization hook is unavailable.');
    }

    return hook.serializeSelectedRecordsForBenchmark();
  });
}

async function runHistogramHoverTrace(page: Page): Promise<PointerTraceSummary> {
  const startedAt = performance.now();
  const box = await histogramCanvasBox(page);
  const samples: number[] = [];
  const ratios = [
    [0.18, 0.22],
    [0.3, 0.35],
    [0.42, 0.48],
    [0.54, 0.62],
    [0.66, 0.72],
    [0.78, 0.55],
  ] as const;

  await page.keyboard.down('Shift');
  try {
    for (const [xRatio, yRatio] of ratios) {
      await page.mouse.move(box.x + box.width * xRatio, box.y + box.height * yRatio);
      await page.waitForTimeout(40);
      const durationMs = await page.evaluate(() => {
        const hover = (
          globalThis as {
            __histogramFastHoverTestHook?: () => { durationMs?: number } | null;
          }
        ).__histogramFastHoverTestHook?.();
        return typeof hover?.durationMs === 'number' ? hover.durationMs : null;
      });
      if (durationMs !== null) {
        samples.push(durationMs);
      }
    }
  } finally {
    await page.keyboard.up('Shift');
  }

  return {
    metricMsP50: medianNumbers(samples),
    metricMsP95: percentileNumbers(samples, 0.95),
    okCount: samples.length,
    observedMs: performance.now() - startedAt,
    sampleCount: ratios.length,
  };
}

async function runHistogramMeasurementTrace(page: Page): Promise<PointerTraceSummary> {
  const startedAt = performance.now();
  const box = await histogramCanvasBox(page);
  const samples: number[] = [];
  const points = [
    [0.25, 0.3],
    [0.35, 0.42],
    [0.48, 0.56],
    [0.62, 0.68],
    [0.72, 0.48],
  ] as const;
  let pointerDown = false;

  await page.keyboard.down('Shift');
  try {
    await page.mouse.move(box.x + box.width * points[0][0], box.y + box.height * points[0][1]);
    await page.mouse.down({ button: 'right' });
    pointerDown = true;
    for (const [xRatio, yRatio] of points.slice(1)) {
      const sampleStartedAt = performance.now();
      await page.mouse.move(box.x + box.width * xRatio, box.y + box.height * yRatio, {
        steps: 3,
      });
      const active = await page
        .waitForFunction(
          () =>
            (
              globalThis as {
                __histogramFastMeasurementTestHook?: () => unknown | null;
              }
            ).__histogramFastMeasurementTestHook?.() !== null,
          undefined,
          { timeout: 1_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (active) {
        samples.push(performance.now() - sampleStartedAt);
      }
    }
  } finally {
    if (pointerDown) {
      await page.mouse.up({ button: 'right' }).catch(() => {});
    }
    await page.keyboard.up('Shift');
  }

  return {
    metricMsP50: medianNumbers(samples),
    metricMsP95: percentileNumbers(samples, 0.95),
    okCount: samples.length,
    observedMs: performance.now() - startedAt,
    sampleCount: points.length - 1,
  };
}

async function histogramCanvasBox(page: Page): Promise<{
  height: number;
  width: number;
  x: number;
  y: number;
}> {
  const deadline = performance.now() + ACTION_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const host = page.locator(HISTOGRAM_HOST_SELECTOR).first();
    await host.waitFor({ state: 'attached', timeout: 1_000 }).catch(() => {});
    const box = await host.boundingBox().catch(() => null);
    if (box !== null && box.width > 0 && box.height > 0) {
      return box;
    }
    await page.waitForTimeout(100);
  }

  throw new Error('Histogram host is unavailable.');
}

async function readElapsedFromNavigation(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const startedAt = (globalThis as { __histogramNavigationStartedAt?: number })
      .__histogramNavigationStartedAt;

    return startedAt === undefined ? null : performance.now() - startedAt;
  });
}

async function isCanvasNonblank(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((canvasSelector) => {
    const hasContent = (globalThis as {
      __histogramCanvasHasContent?: (selector: string) => boolean;
    }).__histogramCanvasHasContent;

    return hasContent?.(canvasSelector) === true;
  }, selector);
}

function createMetricSnapshot(
  finalHistory: readonly HistogramMetric[],
  startupHistory: readonly HistogramMetric[],
): RouteBenchmarkResult['metrics'] {
  const history = finalHistory.length > 0 ? finalHistory : startupHistory;
  const render = latestMetric(history, 'render');
  const bufferUpload = latestMetric(history, 'buffer-upload');
  const aggregation = latestMetric(history, 'aggregation');

  return {
    aggregationBuildMs: aggregation?.aggregateBuildMs ?? null,
    bufferUploadBytes: bufferUpload?.uploadBytes ?? null,
    bufferUploadMs: bufferUpload?.durationMs ?? null,
    drawCalls: render?.drawCalls ?? null,
    renderGpuMs: render?.gpuDurationMs ?? null,
    renderMs: render?.durationMs ?? null,
    visibleBinCount: render?.visibleBinCount ?? null,
  };
}

function latestMetric(
  history: readonly HistogramMetric[],
  phase: HistogramMetric['phase'],
): HistogramMetric | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const metric = history[index];
    if (metric?.phase === phase) {
      return metric;
    }
  }

  return null;
}

export function createHistogramFastBenchmarkUrl(
  baseUrl: string,
  scenario: HistogramScenarioId,
): string {
  const searchParams = new URLSearchParams({
    __benchmark: '1',
    __e2ePreserveDrawingBuffer: '1',
    __e2eScatterFastSchemaDataUrl: HISTOGRAM_FAST_SCATTER_DATASET_URL,
    __e2eScatterFastSchemaUrl: HISTOGRAM_FAST_SCATTER_SCHEMA_URL,
  });

  if (scenario === 'rawMixedTable') {
    searchParams.set('tables', 'multi');
    searchParams.set('__e2eFastTableFixture', HISTOGRAM_FAST_MIXED_TABLE_URL);
  } else if (scenario === 'barMode') {
    searchParams.set('histMode', 'bar');
  }

  return `${baseUrl}/m-histogram?${searchParams}`;
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

function requireBenchmarkData(): void {
  const missing = REQUIRED_DATA_PATHS.filter((path) => !existsSync(path));
  if (missing.length === 0) {
    return;
  }

  throw new Error(
    `Missing histogram benchmark data: ${missing.join(', ')}. Run pnpm generate:data:local before benchmarking.`,
  );
}

function validateBenchmarkResult(result: BenchmarkResult): void {
  const routes = [result.rawSingleTable, result.rawMixedTable, result.barMode];
  for (const route of routes) {
    if (route.renderState.status === 'error') {
      throw new Error(
        `${route.scenario} route reported error state: ${route.renderState.message ?? 'unknown'}`,
      );
    }
    if (!route.canvasNonblank || route.firstNonblankFromNavigationMs === null) {
      throw new Error(`${route.scenario} canvas stayed blank.`);
    }
    if (route.metricHistoryCount === 0) {
      throw new Error(`${route.scenario} metric hook did not emit events.`);
    }
    if (route.metrics.renderMs === null) {
      throw new Error(`${route.scenario} render timing is unavailable.`);
    }
    assertFiniteNonnegativeObject(route, route.scenario);
  }

  if (result.rawSingleTable.recordCount !== 1_000_000) {
    throw new Error(
      `rawSingleTable expected 1,000,000 records; received ${result.rawSingleTable.recordCount}.`,
    );
  }
  if (result.rawMixedTable.recordCount < 1_000_000) {
    throw new Error(
      `rawMixedTable expected at least 1,000,000 records; received ${result.rawMixedTable.recordCount}.`,
    );
  }
  validateRawRouteActions(result.rawSingleTable);
  validateRawRouteActions(result.rawMixedTable);
  if (result.barMode.barModeRenderMs === null) {
    throw new Error('barMode render timing is unavailable.');
  }
}

function validateRawRouteActions(route: RouteBenchmarkResult): void {
  if (route.binSizeChange?.status !== 'ok') {
    throw new Error(`${route.scenario} bin-size change failed.`);
  }
  if (
    route.binSizeChange.effectiveBinSize === null ||
    route.binSizeChange.visibleBinCount === null
  ) {
    throw new Error(`${route.scenario} bin-size observability is unavailable.`);
  }
  if (route.selection?.status !== 'ok' || (route.selection.selectedBinCount ?? 0) <= 0) {
    throw new Error(`${route.scenario} rectangle selection failed.`);
  }
  if (route.exportSerialization?.available !== true) {
    throw new Error(`${route.scenario} export serialization is unavailable.`);
  }
  if (route.hoverTrace === null || route.hoverTrace.okCount === 0) {
    throw new Error(`${route.scenario} hover trace produced no samples.`);
  }
}

function assertFiniteNonnegativeObject(value: unknown, path: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${path} has impossible timing/count value: ${value}`);
    }
    return;
  }
  if (value === null || value === undefined || typeof value !== 'object') {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    assertFiniteNonnegativeObject(nested, `${path}.${key}`);
  }
}

function createSummary(results: readonly BenchmarkResult[]) {
  return {
    barMode: summarizeRoute(results.map((result) => result.barMode)),
    rawMixedTable: summarizeRoute(results.map((result) => result.rawMixedTable)),
    rawSingleTable: summarizeRoute(results.map((result) => result.rawSingleTable)),
  };
}

function summarizeRoute(results: readonly RouteBenchmarkResult[]) {
  return {
    aggregationBuildMsMedian: medianNumbers(
      results.map((result) => result.metrics.aggregationBuildMs),
    ),
    barModeRenderMsMedian: medianNumbers(
      results.map((result) => result.barModeRenderMs),
    ),
    binSizeChangeDebounceMsMedian: medianNumbers(
      results.map((result) => result.binSizeChange?.debounceMs ?? null),
    ),
    binSizeChangeComputeMsMedian: medianNumbers(
      results.map((result) => result.binSizeChange?.computeMs ?? null),
    ),
    binSizeChangeEffectiveBinSizeMedian: medianNumbers(
      results.map((result) => result.binSizeChange?.effectiveBinSize ?? null),
    ),
    binSizeChangeMsMedian: medianNumbers(
      results.map((result) => result.binSizeChange?.observedMs ?? null),
    ),
    binSizeChangeObservableMsMedian: medianNumbers(
      results.map((result) => result.binSizeChange?.observableMs ?? null),
    ),
    binSizeChangeRequestedBinSizeMedian: medianNumbers(
      results.map((result) => result.binSizeChange?.finalBinSize ?? null),
    ),
    binSizeChangeRequestedVisibleBinCountMedian: medianNumbers(
      results.map((result) => result.binSizeChange?.requestedVisibleBinCount ?? null),
    ),
    binSizeChangeVisibleBinCountMedian: medianNumbers(
      results.map((result) => result.binSizeChange?.visibleBinCount ?? null),
    ),
    bufferUploadBytesMedian: medianNumbers(
      results.map((result) => result.metrics.bufferUploadBytes),
    ),
    bufferUploadMsMedian: medianNumbers(
      results.map((result) => result.metrics.bufferUploadMs),
    ),
    canvasNonblank: results.every((result) => result.canvasNonblank),
    exportSerializationBytesMedian: medianNumbers(
      results.map((result) => result.exportSerialization?.byteLength ?? null),
    ),
    exportSerializationMsMedian: medianNumbers(
      results.map((result) => result.exportSerialization?.ms ?? null),
    ),
    firstNonblankFromNavigationMsMedian: medianNumbers(
      results.map((result) => result.firstNonblankFromNavigationMs),
    ),
    hoverTraceMsP50Median: medianNumbers(
      results.map((result) => result.hoverTrace?.metricMsP50 ?? null),
    ),
    hoverTraceMsP95Median: medianNumbers(
      results.map((result) => result.hoverTrace?.metricMsP95 ?? null),
    ),
    measurementTraceMsP50Median: medianNumbers(
      results.map((result) => result.measurementTrace?.metricMsP50 ?? null),
    ),
    measurementTraceMsP95Median: medianNumbers(
      results.map((result) => result.measurementTrace?.metricMsP95 ?? null),
    ),
    membershipFinalizeMsMedian: medianNumbers(
      results.map((result) => result.binSizeChange?.membershipFinalizeMs ?? null),
    ),
    recordCount: results[0]?.recordCount ?? 0,
    rectangleSelectionComputeMsMedian: medianNumbers(
      results.map((result) => result.selection?.selectionComputeMs ?? null),
    ),
    rectangleSelectionMsMedian: medianNumbers(
      results.map((result) => result.selection?.observedMs ?? null),
    ),
    renderDrawCallsMedian: medianNumbers(
      results.map((result) => result.metrics.drawCalls),
    ),
    renderGpuMsMedian: medianNumbers(
      results.map((result) => result.metrics.renderGpuMs),
    ),
    renderMsMedian: medianNumbers(results.map((result) => result.metrics.renderMs)),
    routeReadyFromNavigationMsMedian: medianNumbers(
      results.map((result) => result.routeReadyFromNavigationMs),
    ),
    selectedVisualUpdateMsMedian: medianNumbers(
      results.map((result) => result.selection?.selectedVisualUpdateMs ?? null),
    ),
    selectedVisualUpdateObservable: results.some(
      (result) => result.selection?.selectedVisualUpdateObservable === true,
    ),
    visibleBinCountMedian: medianNumbers(
      results.map((result) => result.metrics.visibleBinCount),
    ),
  };
}

function medianNumbers(values: readonly (number | null)[]): number | null {
  const numberValues = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );

  if (numberValues.length === 0) {
    return null;
  }

  const sorted = [...numberValues].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[midpoint] ?? null;
  }

  const lower = sorted[midpoint - 1];
  const upper = sorted[midpoint];
  return lower === undefined || upper === undefined ? null : (lower + upper) / 2;
}

function percentileNumbers(
  values: readonly number[],
  percentile: number,
): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentile) - 1),
  );

  return sorted[index] ?? null;
}

function classifyTimedError(error: unknown): TimedStatus {
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  return message.includes('timeout') ? 'timeout' : 'unavailable';
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
      reject(new Error(`Timed out waiting for Vite dev server at ${baseUrl}.`));
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
      reject(new Error(`Vite dev server exited before ${baseUrl}; code ${code}.`));
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

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
