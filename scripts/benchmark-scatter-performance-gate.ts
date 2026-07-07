import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { chromium, type Locator, type Page } from '@playwright/test';

interface ScatterDataset {
  records: unknown[];
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

interface ScatterFastRouteResult {
  canvasNonblank: boolean;
  displayModes: {
    bubble: ScatterFastDisplayModeResult;
    heatmap: ScatterFastHeatmapDisplayModeResult;
    points: ScatterFastDisplayModeResult;
  };
  exportSerialization: ScatterFastExportResult | null;
  firstNonblankFromNavigationMs: number | null;
  hover: ScatterFastDiagnosticResult | null;
  hoverTrace: ScatterFastPointerTraceSummary | null;
  lassoSelection: ScatterFastSelectionResult | null;
  measurementPick: ScatterFastDiagnosticResult | null;
  measurementTrace: ScatterFastPointerTraceSummary | null;
  metrics: Record<string, number | string | boolean | null>;
  pan: ScatterFastDiagnosticResult | null;
  rectangleSelection: ScatterFastSelectionResult | null;
  rectangleZoom: ScatterFastDiagnosticResult | null;
  recordCount: number;
  route: '/m-scatter';
  routeReadyFromNavigationMs: number | null;
  screenshotNonblank: boolean;
  skipped: false;
  symbolSizeScaleChanges: {
    decrease: ScatterFastDiagnosticResult | null;
    reset: ScatterFastDiagnosticResult | null;
    increase: ScatterFastDiagnosticResult | null;
    stress10x: ScatterFastDiagnosticResult | null;
  };
  viewportHookMovement: TimedResult | null;
  wheelZoom: ScatterFastDiagnosticResult | null;
}

interface TimedResult {
  observedMs: number;
  status: 'ok' | 'timeout' | 'unavailable';
}

interface ScatterFastDiagnosticResult extends TimedResult {
  diagnostics: Record<string, number | string | boolean | null>;
}

interface ScatterFastPointerTraceSummary {
  drawCallsMedian: number | null;
  drawCallsP95: number | null;
  hoverLookupMsMedian: number | null;
  hoverLookupMsP95: number | null;
  hoverOverlayMsMedian: number | null;
  hoverOverlayMsP95: number | null;
  measurementMsMedian: number | null;
  measurementMsP95: number | null;
  okCount: number;
  observedMs: number;
  sampleCount: number;
  timeoutCount: number;
}

interface ScatterFastSelectionResult extends ScatterFastDiagnosticResult {
  selectedCount: number | null;
  selectedVisualUpdateMs: number | null;
  selectionComputeMs: number | null;
  selectionWorkerObservableMs: number | null;
  selectionWorkerTransferMs: number | null;
}

interface ScatterFastExportResult extends TimedResult {
  byteLength: number | null;
  idCount: number | null;
}

interface ScatterFastDisplayModeSnapshot {
  aggregateComputeMs: number | null;
  aggregateCount: number | null;
  aggregateObservableMs: number | null;
  aggregateStatus: string | null;
  aggregateTransferMs: number | null;
  aggregateUploadBytes: number | null;
  aggregateWorkerMode: string | null;
  cellCount: number | null;
  displayMode: ScatterFastVisualizationMode;
  effectiveRenderingMode: string | null;
  metrics: Record<string, number | string | boolean | null>;
  populatedCellCount: number | null;
  recordCount: number | null;
  renderDrawCalls: number | null;
  renderObservableMs: number | null;
  subplotCount: number | null;
  visiblePointCount: number | null;
}

interface ScatterFastDisplayModeResult {
  aggregateHover: ScatterFastAggregateHoverResult | null;
  aggregateSelection: ScatterFastSelectionResult | null;
  snapshot: ScatterFastDisplayModeSnapshot;
  switchMode: TimedResult;
}

interface ScatterFastHeatmapBinSizeChangeResult extends ScatterFastDiagnosticResult {
  binSizeSequencePx: readonly number[];
  finalAggregateComputeMs: number | null;
  finalAggregateObservableMs: number | null;
  finalBinSizePx: number | null;
}

interface ScatterFastHeatmapDisplayModeResult extends ScatterFastDisplayModeResult {
  heatmapBinSizeChange: ScatterFastHeatmapBinSizeChangeResult | null;
}

interface ScatterFastAggregateHoverResult extends ScatterFastDiagnosticResult {
  candidateCount: number | null;
  pointId: string | null;
  sourceIndex: number | null;
}

type ScatterFastVisualizationMode = 'bubble' | 'heatmap' | 'points';

interface BenchmarkResult {
  run: number;
  scatterFast: ScatterFastRouteResult;
}

interface Options {
  port: number;
  runs: number;
}

const DEFAULT_PORT = 5187;
const DEFAULT_RUNS = 1;
const ROUTE_READY_TIMEOUT_MS = 300_000;
const NONBLANK_TIMEOUT_MS = 300_000;
const ACTION_TIMEOUT_MS = 5_000;
const SCATTER_FAST_PROBE_TIMEOUT_MS = 30_000;
const METRIC_TIMEOUT_MS = 30_000;
const DATASET_PATH = new URL('../apps/demo/public/data/m-scatter-sample.json', import.meta.url);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const expectedRecordCount = readScatterDataset(DATASET_PATH).records.length;
  await assertPortAvailable(options.port);
  const server = startViteServer(options.port);
  const baseUrl = `http://127.0.0.1:${options.port}`;

  try {
    await waitForSpawnedViteServer(baseUrl, server);

    const results: BenchmarkResult[] = [];
    for (let run = 1; run <= options.runs; run += 1) {
      console.error(`benchmark:scatter run ${run}/${options.runs} /m-scatter`);
      const scatterFast = await benchmarkScatterFastRoute(baseUrl, expectedRecordCount);
      results.push({
        run,
        scatterFast,
      });
    }

    console.log(JSON.stringify({ results, summary: createSummary(results) }, null, 2));
  } finally {
    await stopViteServer(server);
  }
}

async function benchmarkScatterFastRoute(
  baseUrl: string,
  expectedRecordCount: number,
): Promise<ScatterFastRouteResult> {
  const { browser, page } = await createPage();

  try {
    await page.goto(
      `${baseUrl}/m-scatter?__benchmark=1&__e2eScatterFastRouteStateHook=1&__e2eScatterFastSelectionHook=1&__e2eScatterFastHoverHook=1&__e2eScatterFastMeasurementHook=1&mode=pan&axis=xy`,
      {
        timeout: ROUTE_READY_TIMEOUT_MS,
        waitUntil: 'domcontentloaded',
      },
    );

    const firstNonblankPromise = waitForFirstNonblankCanvas(
      page,
      '[data-testid="scatter-fast-webgl-canvas"]',
    );
    console.error('benchmark:scatter-fast wait route ready');
    await waitForScatterFastRenderState(page);
    console.error('benchmark:scatter-fast route ready');
    const routeReadyFromNavigationMs = await readElapsedFromNavigation(page);
    const firstNonblankFromNavigationMs = await firstNonblankPromise;
    console.error('benchmark:scatter-fast first nonblank sampled');
    const startupMetrics = await safeReadScatterFastMetrics(page);
    const pointsDisplayMode = await benchmarkScatterFastDisplayMode(page, 'points');
    console.error('benchmark:scatter-fast points display mode');
    const bubbleDisplayMode = await benchmarkScatterFastDisplayMode(page, 'bubble');
    console.error('benchmark:scatter-fast bubble display mode');
    const heatmapDisplayMode = await benchmarkScatterFastHeatmapDisplayMode(page);
    console.error('benchmark:scatter-fast heatmap display mode');
    await setScatterFastVisualizationModeWithoutReadinessGate(page, 'points');
    const symbolSizeScaleChanges = {
      decrease: await runScatterFastSymbolSizeScaleChange(page, 0.5),
      reset: await runScatterFastSymbolSizeScaleChange(page, 1),
      increase: await runScatterFastSymbolSizeScaleChange(page, 2),
      stress10x: await runScatterFastSymbolSizeScaleChange(page, 10),
    };
    await runScatterFastSymbolSizeScaleChange(page, 1);
    console.error('benchmark:scatter-fast symbol size scale');
    const viewportHookMovement = await runScatterFastViewportHookMovement(page);
    console.error('benchmark:scatter-fast viewport hook');
    const pan = await runScatterFastDrag(page, 'pan');
    console.error('benchmark:scatter-fast pan');
    const wheelZoom = await runScatterFastWheelZoom(page);
    console.error('benchmark:scatter-fast wheel');
    const rectangleZoom = await runScatterFastDrag(page, 'zoom');
    console.error('benchmark:scatter-fast rectangle zoom');
    const exportSerialization = await runScatterFastExportSerialization(page);
    console.error('benchmark:scatter-fast export');
    const rectangleSelection = await runScatterFastSelection(page, 'select');
    console.error('benchmark:scatter-fast rectangle selection');
    const lassoSelection = await runScatterFastSelection(page, 'lasso');
    console.error('benchmark:scatter-fast lasso selection');
    const hoverTrace = await runScatterFastPointerTrace(page, 'hover');
    console.error('benchmark:scatter-fast hover trace');
    const measurementTrace = await runScatterFastPointerTrace(page, 'measure');
    console.error('benchmark:scatter-fast measurement trace');
    const hover = await runScatterFastHover(page);
    console.error('benchmark:scatter-fast hover');
    const measurementPick = await runScatterFastMeasurementPick(page);
    console.error('benchmark:scatter-fast measurement');
    const canvasNonblank = await isCanvasNonblank(
      page,
      '[data-testid="scatter-fast-webgl-canvas"]',
    );
    const screenshotNonblank = await isScreenshotNonblank(page);
    const finalMetrics = await safeReadScatterFastMetrics(page);
    const retainedMetrics = firstNonEmptyMetrics(
      finalMetrics,
      startupMetrics,
      pointsDisplayMode.snapshot.metrics,
      bubbleDisplayMode.snapshot.metrics,
      heatmapDisplayMode.snapshot.metrics,
      heatmapDisplayMode.heatmapBinSizeChange?.diagnostics,
      symbolSizeScaleChanges.reset?.diagnostics,
      symbolSizeScaleChanges.decrease?.diagnostics,
      symbolSizeScaleChanges.increase?.diagnostics,
      symbolSizeScaleChanges.stress10x?.diagnostics,
      pan?.diagnostics,
      wheelZoom?.diagnostics,
      rectangleZoom?.diagnostics,
      rectangleSelection?.diagnostics,
      lassoSelection?.diagnostics,
      hover?.diagnostics,
      measurementPick?.diagnostics,
    );

    return {
      canvasNonblank,
      displayModes: {
        bubble: bubbleDisplayMode,
        heatmap: heatmapDisplayMode,
        points: pointsDisplayMode,
      },
      exportSerialization,
      firstNonblankFromNavigationMs,
      hover,
      hoverTrace,
      lassoSelection,
      measurementPick,
      measurementTrace,
      metrics: retainedMetrics,
      pan,
      rectangleSelection,
      rectangleZoom,
      recordCount: expectedRecordCount,
      route: '/m-scatter',
      routeReadyFromNavigationMs,
      screenshotNonblank,
      skipped: false,
      symbolSizeScaleChanges,
      viewportHookMovement,
      wheelZoom,
    };
  } finally {
    await page.close();
    await browser.close();
  }
}

async function createPage() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
  page.setDefaultTimeout(METRIC_TIMEOUT_MS);
  await page.addInitScript(() => {
    (globalThis as { __scatterNavigationStartedAt?: number })
      .__scatterNavigationStartedAt = performance.now();
    (globalThis as {
      __scatterCanvasHasContent?: (selector: string) => boolean;
    }).__scatterCanvasHasContent = (selector: string) => {
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

  return { browser, page };
}

async function waitForScatterFastRenderState(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const browserGlobals = globalThis as unknown as {
        document: BrowserDocument;
      };
      const element = browserGlobals.document.querySelector(
        '[data-testid="scatter-fast-chart-shell"]',
      );

      const diagnostics = browserGlobals.document.querySelector(
        '[data-testid="scatter-fast-route-diagnostics"]',
      );
      const firstCanvasVisiblePoints =
        diagnostics?.dataset.firstCanvasRenderVisiblePoints;

      return (
        element?.dataset.renderState === 'ready' ||
        (firstCanvasVisiblePoints !== undefined &&
          firstCanvasVisiblePoints !== 'pending')
      );
    },
    undefined,
    { timeout: ROUTE_READY_TIMEOUT_MS },
  );
}

async function waitForFirstNonblankCanvas(
  page: Page,
  selector: string,
): Promise<number | null> {
  try {
    const handle = await page.waitForFunction(
      (canvasSelector) => {
        const startedAt = (globalThis as { __scatterNavigationStartedAt?: number })
          .__scatterNavigationStartedAt;
        if (startedAt === undefined) {
          return false;
        }
        const hasContent = (globalThis as {
          __scatterCanvasHasContent?: (selector: string) => boolean;
        }).__scatterCanvasHasContent;

        return hasContent?.(canvasSelector) === true
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

async function runScatterFastViewportHookMovement(page: Page): Promise<TimedResult> {
  return timeAction(async () => {
    const viewportProbe = await page.evaluate(() => {
      const hook = (globalThis as unknown as {
        __scatterFastRouteStateTestHook: {
          getFastViewport?: () => {
            x: { max: number; min: number };
            yByPlot: Record<string, { max: number; min: number }>;
          } | null;
          getState: () => { viewport: Record<string, { max: number; min: number }> } | null;
          setFastViewport: (viewport: unknown, reason: string) => void;
        };
      }).__scatterFastRouteStateTestHook;
      if (typeof hook?.setFastViewport !== 'function') {
        throw new Error('Scatter-fast route viewport hook is unavailable.');
      }
      const originalViewport = hook.getFastViewport?.();
      if (originalViewport === null || originalViewport === undefined) {
        throw new Error('Scatter-fast route fast viewport hook returned no state.');
      }
      const routeViewport = hook.getState()?.viewport;
      if (routeViewport === undefined || routeViewport === null) {
        throw new Error('Scatter-fast route viewport hook returned no state.');
      }

      const yByPlot: Record<string, { max: number; min: number }> = {};
      for (const region of Array.from(
        globalThis.document.querySelectorAll('[data-testid="scatter-fast-hit-region"]'),
      )) {
        const plotId = region.getAttribute('data-plot-id');
        if (plotId === null) {
          continue;
        }
        const min = Number(region.getAttribute('data-y-min'));
        const max = Number(region.getAttribute('data-y-max'));
        if (Number.isFinite(min) && Number.isFinite(max)) {
          yByPlot[plotId] = { max, min };
          continue;
        }

        const routeRange = routeViewport[plotId];
        if (routeRange !== undefined) {
          yByPlot[plotId] = routeRange;
        }
      }

      const span = originalViewport.x.max - originalViewport.x.min;
      const movedViewport = {
        x: {
          max: originalViewport.x.max - span * 0.1,
          min: originalViewport.x.min + span * 0.1,
        },
        yByPlot: Object.keys(yByPlot).length > 0 ? yByPlot : originalViewport.yByPlot,
      };
      hook.setFastViewport(movedViewport, 'navigator');
      return {
        movedMin: movedViewport.x.min,
        originalViewport,
      };
    });
    await page.waitForTimeout(100);
    const moved = await page.evaluate((expectedMin) => {
      const fastViewport = (
        globalThis as unknown as {
          __scatterFastRouteStateTestHook?: {
            getFastViewport?: () => { x?: { min?: number } } | null;
          };
        }
      ).__scatterFastRouteStateTestHook?.getFastViewport?.();
      return Math.abs((fastViewport?.x?.min ?? Number.NaN) - expectedMin) < 1e-6;
    }, viewportProbe.movedMin);
    if (!moved) {
      throw new Error('scatter-fast viewport hook did not update the engine viewport');
    }
    await page.evaluate((originalViewport) => {
      const hook = (globalThis as unknown as {
        __scatterFastRouteStateTestHook?: {
          setFastViewport?: (viewport: unknown, reason: string) => void;
        };
      }).__scatterFastRouteStateTestHook;
      hook?.setFastViewport?.(originalViewport, 'navigator');
    }, viewportProbe.originalViewport);
  }, SCATTER_FAST_PROBE_TIMEOUT_MS);
}

async function runScatterFastDrag(
  page: Page,
  mode: 'lasso' | 'pan' | 'select' | 'zoom',
): Promise<ScatterFastDiagnosticResult> {
  const result = await timeAction(async () => {
    await setScatterFastMode(page, mode);
    if (mode === 'lasso') {
      await drawScatterFastLasso(page);
      await waitForScatterFastDiagnostic(page, 'data-lasso-selection-ms');
    } else {
      const box = await scatterFastHitRegionBox(page);
      const button =
        mode === 'pan' ? 'middle' : mode === 'select' ? 'right' : 'left';
      await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
      await page.mouse.down({ button });
      await page.mouse.move(box.x + box.width * 0.66, box.y + box.height * 0.62, {
        steps: 10,
      });
      await page.mouse.up({ button });
      await waitForScatterFastDiagnostic(
        page,
        mode === 'pan'
          ? 'data-drag-pan-ms'
          : mode === 'select'
            ? 'data-rectangle-selection-ms'
            : 'data-rectangle-zoom-ms',
      );
    }
  }, SCATTER_FAST_PROBE_TIMEOUT_MS);

  return { ...result, diagnostics: await safeReadScatterFastMetrics(page) };
}

async function runScatterFastWheelZoom(page: Page): Promise<ScatterFastDiagnosticResult> {
  const result = await timeAction(async () => {
    const box = await scatterFastHitRegionBox(page);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await dispatchScatterFastCtrlWheel(page);
    await page.waitForTimeout(100);
    const diagnostic = await page
      .getByTestId('scatter-fast-route-diagnostics')
      .getAttribute('data-wheel-zoom-ms')
      .catch(() => null);
    if (diagnostic === null || diagnostic === 'pending') {
      await page.keyboard.down('Control');
      try {
        await page.mouse.wheel(0, -450);
      } finally {
        await page.keyboard.up('Control');
      }
    }
    await waitForScatterFastDiagnostic(page, 'data-wheel-zoom-ms');
  }, SCATTER_FAST_PROBE_TIMEOUT_MS);

  return { ...result, diagnostics: await safeReadScatterFastMetrics(page) };
}

async function dispatchScatterFastCtrlWheel(
  page: Page,
  clientX?: number,
  clientY?: number,
): Promise<void> {
  if (clientX !== undefined && clientY !== undefined) {
    await page.evaluate(
      ({ x, y }) => {
        const target = globalThis.document.elementFromPoint(x, y);
        target?.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            composed: true,
            ctrlKey: true,
            deltaMode: 0,
            deltaY: -450,
          }),
        );
      },
      { x: clientX, y: clientY },
    );
    return;
  }

  await page.getByTestId('scatter-fast-hit-region').nth(1).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          composed: true,
          ctrlKey: true,
          deltaMode: 0,
          deltaY: -450,
        }),
    );
  });
}

async function benchmarkScatterFastDisplayMode(
  page: Page,
  displayMode: ScatterFastVisualizationMode,
): Promise<ScatterFastDisplayModeResult> {
  await clearScatterFastSelection(page);
  const switchMode = await runScatterFastVisualizationModeSwitch(page, displayMode);
  const snapshot = await captureScatterFastDisplayModeSnapshot(page, displayMode);
  const aggregateHover =
    displayMode === 'points'
      ? null
      : await runScatterFastAggregateHover(page);
  const aggregateSelection =
    displayMode === 'points'
      ? null
      : await runScatterFastSelection(page, 'select');

  return {
    aggregateHover,
    aggregateSelection,
    snapshot,
    switchMode,
  };
}

async function benchmarkScatterFastHeatmapDisplayMode(
  page: Page,
): Promise<ScatterFastHeatmapDisplayModeResult> {
  const baseResult = await benchmarkScatterFastDisplayMode(page, 'heatmap');
  await clearScatterFastSelection(page);
  const heatmapBinSizeChange = await runScatterFastHeatmapBinSizeChange(page, [8, 16, 24, 10]);

  return {
    ...baseResult,
    heatmapBinSizeChange,
  };
}

async function runScatterFastVisualizationModeSwitch(
  page: Page,
  displayMode: ScatterFastVisualizationMode,
): Promise<TimedResult> {
  const timeoutMs =
    displayMode === 'bubble'
      ? Math.max(SCATTER_FAST_PROBE_TIMEOUT_MS, 60_000)
      : SCATTER_FAST_PROBE_TIMEOUT_MS;

  return timeAction(async () => {
    await setScatterFastVisualizationMode(page, displayMode);
  }, timeoutMs);
}

async function clearScatterFastSelection(page: Page): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const diagnosticsSelectedCount = globalThis.document
          .querySelector('[data-testid="scatter-fast-route-diagnostics"]')
          ?.getAttribute('data-selected-count');
        const hookSelectedCount = (
          globalThis as unknown as {
            __scatterFastSelectionTestHook?: {
              getSelectedCount?: () => number;
            };
          }
        ).__scatterFastSelectionTestHook?.getSelectedCount?.();
        if (diagnosticsSelectedCount === '0' || hookSelectedCount === 0) {
          return true;
        }
        return (
          typeof (
            globalThis as unknown as {
              __scatterFastRouteStateTestHook?: {
                clearSelection?: () => void;
              };
            }
          ).__scatterFastRouteStateTestHook?.clearSelection === 'function'
        );
      },
      undefined,
      { timeout: ACTION_TIMEOUT_MS },
    );
  } catch (error) {
    const state = await readScatterFastSelectionClearState(page);
    if (state.diagnosticsSelectedCount === '0' || state.hookSelectedCount === 0) {
      return;
    }
    throw new Error(
      `Scatter-fast selection clear hook is unavailable: ${JSON.stringify(state)}`,
      { cause: error },
    );
  }
  const alreadyClear = await page.evaluate(() => {
    const diagnosticsSelectedCount = globalThis.document
      .querySelector('[data-testid="scatter-fast-route-diagnostics"]')
      ?.getAttribute('data-selected-count');
    const hookSelectedCount = (
      globalThis as unknown as {
        __scatterFastSelectionTestHook?: {
          getSelectedCount?: () => number;
        };
      }
    ).__scatterFastSelectionTestHook?.getSelectedCount?.();
    return diagnosticsSelectedCount === '0' || hookSelectedCount === 0;
  });
  if (alreadyClear) {
    return;
  }
  await page.evaluate(() => {
    (
      globalThis as unknown as {
        __scatterFastRouteStateTestHook?: {
          clearSelection?: () => void;
        };
      }
    ).__scatterFastRouteStateTestHook?.clearSelection?.();
  });
  try {
    await page.waitForFunction(
      () => {
        const diagnosticsSelectedCount = globalThis.document
          .querySelector('[data-testid="scatter-fast-route-diagnostics"]')
          ?.getAttribute('data-selected-count');
        const hookSelectedCount = (
          globalThis as unknown as {
            __scatterFastSelectionTestHook?: {
              getSelectedCount?: () => number;
            };
          }
        ).__scatterFastSelectionTestHook?.getSelectedCount?.();

        return diagnosticsSelectedCount === '0' || hookSelectedCount === 0;
      },
      undefined,
      { timeout: ACTION_TIMEOUT_MS },
    );
  } catch (error) {
    const state = await readScatterFastSelectionClearState(page);
    if (state.diagnosticsSelectedCount === '0' || state.hookSelectedCount === 0) {
      return;
    }
    throw new Error(
      `Scatter-fast selection clear did not settle: ${JSON.stringify(state)}`,
      { cause: error },
    );
  }
}

async function readScatterFastSelectionClearState(page: Page): Promise<{
  diagnosticsSelectedCount: string | null;
  hookSelectedCount: number | null;
  routeHookAvailable: boolean;
}> {
  return page.evaluate(() => ({
    diagnosticsSelectedCount:
      globalThis.document
        .querySelector('[data-testid="scatter-fast-route-diagnostics"]')
        ?.getAttribute('data-selected-count') ?? null,
    hookSelectedCount:
      (
        globalThis as unknown as {
          __scatterFastSelectionTestHook?: {
            getSelectedCount?: () => number;
          };
        }
      ).__scatterFastSelectionTestHook?.getSelectedCount?.() ?? null,
    routeHookAvailable:
      typeof (
        globalThis as unknown as {
          __scatterFastRouteStateTestHook?: {
            clearSelection?: () => void;
          };
        }
      ).__scatterFastRouteStateTestHook?.clearSelection === 'function',
  }));
}

async function captureScatterFastDisplayModeSnapshot(
  page: Page,
  displayMode: ScatterFastVisualizationMode,
): Promise<ScatterFastDisplayModeSnapshot> {
  const metrics = await safeReadScatterFastMetrics(page);

  return {
    aggregateComputeMs: numberMetric(metrics.aggregateBuildMs),
    aggregateCount: numberMetric(metrics.aggregateCount),
    aggregateObservableMs: numberMetric(metrics.aggregateWorkerObservableMs),
    aggregateStatus:
      typeof metrics.aggregateStatus === 'string' ? metrics.aggregateStatus : null,
    aggregateTransferMs: numberMetric(metrics.aggregateWorkerTransferMs),
    aggregateUploadBytes: numberMetric(metrics.aggregateUploadBytes),
    aggregateWorkerMode:
      typeof metrics.aggregateWorkerMode === 'string'
        ? metrics.aggregateWorkerMode
        : null,
    cellCount: numberMetric(metrics.aggregateCellCount),
    displayMode,
    effectiveRenderingMode:
      typeof metrics.effectiveRenderingMode === 'string'
        ? metrics.effectiveRenderingMode
        : null,
    metrics,
    populatedCellCount: numberMetric(metrics.aggregatePopulatedCellCount),
    recordCount: numberMetric(metrics.datasetRecordCount ?? metrics.recordCount),
    renderDrawCalls: numberMetric(metrics.rendererDrawCalls),
    renderObservableMs: numberMetric(metrics.rendererRedrawCpuMs),
    subplotCount: numberMetric(metrics.subplotCount),
    visiblePointCount: numberMetric(metrics.rendererVisiblePoints),
  };
}

async function runScatterFastSelection(
  page: Page,
  mode: 'lasso' | 'select',
): Promise<ScatterFastSelectionResult> {
  const result = await runScatterFastDrag(page, mode);
  const metrics = result.diagnostics;

  return {
    ...result,
    selectedCount: numberMetric(metrics.selectedCount),
    selectedVisualUpdateMs: numberMetric(metrics.selectedOverlayUpdateMs),
    selectionComputeMs: numberMetric(
      mode === 'lasso'
        ? metrics.lassoSelectionComputeMs
        : metrics.rectangleSelectionComputeMs,
    ),
    selectionWorkerObservableMs: numberMetric(metrics.selectionWorkerObservableMs),
    selectionWorkerTransferMs: numberMetric(metrics.selectionWorkerTransferMs),
  };
}

async function runScatterFastAggregateHover(
  page: Page,
): Promise<ScatterFastAggregateHoverResult> {
  const startedAt = performance.now();
  try {
    await setScatterFastMode(page, 'hover');
    const box = await scatterFastHitRegionBox(page);
    const ratios = [
      [0.2, 0.25],
      [0.35, 0.4],
      [0.5, 0.5],
      [0.65, 0.65],
      [0.8, 0.3],
    ] as const;
    let hoverResult: {
      candidateCount: number | null;
      pointId: string | null;
      sourceIndex: number | null;
    } | null = null;

    await page.keyboard.down('Shift');
    try {
      for (const [xRatio, yRatio] of ratios) {
        await page.mouse.move(box.x + box.width * xRatio, box.y + box.height * yRatio);
        hoverResult = await waitForScatterFastAggregateHoverResult(page, startedAt);
        if (hoverResult !== null) {
          break;
        }
      }
    } finally {
      await page.keyboard.up('Shift');
    }

    return {
      candidateCount: hoverResult?.candidateCount ?? null,
      diagnostics: await safeReadScatterFastMetrics(page),
      observedMs: performance.now() - startedAt,
      pointId: hoverResult?.pointId ?? null,
      sourceIndex: hoverResult?.sourceIndex ?? null,
      status: hoverResult === null ? 'timeout' : 'ok',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';

    return {
      candidateCount: null,
      diagnostics: await safeReadScatterFastMetrics(page),
      observedMs: performance.now() - startedAt,
      pointId: null,
      sourceIndex: null,
      status: message.toLowerCase().includes('timeout') ? 'timeout' : 'unavailable',
    };
  }
}

async function runScatterFastHover(page: Page): Promise<ScatterFastDiagnosticResult> {
  const result = await timeAction(async () => {
    await setScatterFastMode(page, 'hover');
    const box = await scatterFastHitRegionBox(page);
    await page.keyboard.down('Shift');
    try {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.waitForTimeout(100);
    } finally {
      await page.keyboard.up('Shift');
    }
  }, SCATTER_FAST_PROBE_TIMEOUT_MS);

  return { ...result, diagnostics: await safeReadScatterFastMetrics(page) };
}

async function runScatterFastPointerTrace(
  page: Page,
  mode: 'hover' | 'measure',
): Promise<ScatterFastPointerTraceSummary> {
  const startedAt = performance.now();
  try {
    await setScatterFastModeViaHook(page, mode);
  } catch {
    return createUnavailableScatterFastPointerTrace(performance.now() - startedAt);
  }

  let box: Awaited<ReturnType<typeof scatterFastHitRegionBox>>;
  try {
    box = await scatterFastHitRegionBox(page);
  } catch {
    return createUnavailableScatterFastPointerTrace(performance.now() - startedAt);
  }
  const samples: Record<string, number | string | boolean | null>[] = [];
  const ratios = [
    [0.18, 0.22],
    [0.3, 0.35],
    [0.42, 0.48],
    [0.54, 0.62],
    [0.66, 0.72],
    [0.78, 0.55],
  ] as const;

  if (mode === 'hover') {
    await page.keyboard.down('Shift');
  }

  try {
    for (const [xRatio, yRatio] of ratios) {
      await page.mouse.move(box.x + box.width * xRatio, box.y + box.height * yRatio);
      await page.waitForTimeout(32);
      samples.push(await safeReadScatterFastMetrics(page));
    }
  } finally {
    if (mode === 'hover') {
      await page.keyboard.up('Shift');
    }
  }

  return summarizeScatterFastPointerTrace(samples, performance.now() - startedAt);
}

async function setScatterFastModeViaHook(
  page: Page,
  mode: 'hover' | 'measure',
): Promise<void> {
  await page.evaluate((nextMode) => {
    (globalThis as unknown as {
      __scatterFastRouteStateTestHook?: {
        setMode: (mode: typeof nextMode) => void;
      };
    }).__scatterFastRouteStateTestHook?.setMode(nextMode);
  }, mode);
  await page.waitForFunction(
    (nextMode) =>
      globalThis.document
        .querySelector('[data-testid="scatter-fast-chart-shell"]')
        ?.getAttribute('data-mode') === nextMode,
    mode,
    { timeout: ACTION_TIMEOUT_MS },
  );
}

function createUnavailableScatterFastPointerTrace(
  observedMs: number,
): ScatterFastPointerTraceSummary {
  return {
    drawCallsMedian: null,
    drawCallsP95: null,
    hoverLookupMsMedian: null,
    hoverLookupMsP95: null,
    hoverOverlayMsMedian: null,
    hoverOverlayMsP95: null,
    measurementMsMedian: null,
    measurementMsP95: null,
    okCount: 0,
    observedMs,
    sampleCount: 0,
    timeoutCount: 0,
  };
}

function summarizeScatterFastPointerTrace(
  samples: readonly Record<string, number | string | boolean | null>[],
  observedMs: number,
): ScatterFastPointerTraceSummary {
  const hoverLookupMs = samples.map((sample) => numberMetric(sample.hoverLookupMs));
  const hoverOverlayMs = samples.map((sample) => numberMetric(sample.hoverOverlayUpdateMs));
  const measurementMs = samples.map((sample) => numberMetric(sample.measurementUpdateMs));
  const drawCalls = samples.map((sample) => numberMetric(sample.hoverOverlayDrawCalls));
  const okCount = hoverLookupMs.filter((value) => value !== null).length;

  return {
    drawCallsMedian: medianNumbers(drawCalls),
    drawCallsP95: percentileNumbers(drawCalls, 0.95),
    hoverLookupMsMedian: medianNumbers(hoverLookupMs),
    hoverLookupMsP95: percentileNumbers(hoverLookupMs, 0.95),
    hoverOverlayMsMedian: medianNumbers(hoverOverlayMs),
    hoverOverlayMsP95: percentileNumbers(hoverOverlayMs, 0.95),
    measurementMsMedian: medianNumbers(measurementMs),
    measurementMsP95: percentileNumbers(measurementMs, 0.95),
    okCount,
    observedMs,
    sampleCount: samples.length,
    timeoutCount: samples.length - okCount,
  };
}

async function runScatterFastMeasurementPick(
  page: Page,
): Promise<ScatterFastDiagnosticResult> {
  const result = await timeAction(async () => {
    await setScatterFastMode(page, 'measure');
    const box = await scatterFastHitRegionBox(page);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForTimeout(100);
  }, SCATTER_FAST_PROBE_TIMEOUT_MS);

  return { ...result, diagnostics: await safeReadScatterFastMetrics(page) };
}

async function runScatterFastExportSerialization(
  page: Page,
): Promise<ScatterFastExportResult> {
  const startedAt = performance.now();
  try {
    const result = await page.evaluate(() => {
      const hook = (globalThis as {
        __scatterFastSelectionTestHook?: {
          exportSelectedIdsText: () => string;
          getSelectedCount: () => number;
        };
      }).__scatterFastSelectionTestHook;
      if (hook === undefined || hook.getSelectedCount() === 0) {
        return null;
      }
      const text = hook.exportSelectedIdsText();

      return { byteLength: new Blob([text]).size, idCount: hook.getSelectedCount() };
    });

    return {
      byteLength: result?.byteLength ?? null,
      idCount: result?.idCount ?? null,
      observedMs: performance.now() - startedAt,
      status: result === null ? 'unavailable' : 'ok',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';

    return {
      byteLength: null,
      idCount: null,
      observedMs: performance.now() - startedAt,
      status: message.toLowerCase().includes('timeout') ? 'timeout' : 'unavailable',
    };
  }
}

async function scatterFastHitRegionBox(page: Page, plotIndex = 1) {
  const box = await page.getByTestId('scatter-fast-hit-region').nth(plotIndex).boundingBox();
  if (box === null) {
    throw new Error(`Scatter-fast plot ${plotIndex} hit region is unavailable.`);
  }

  return box;
}

async function drawScatterFastLasso(page: Page): Promise<void> {
  const box = await scatterFastHitRegionBox(page);
  const points = [
    { x: box.x + box.width * 0.28, y: box.y + box.height * 0.38 },
    { x: box.x + box.width * 0.52, y: box.y + box.height * 0.24 },
    { x: box.x + box.width * 0.74, y: box.y + box.height * 0.42 },
    { x: box.x + box.width * 0.66, y: box.y + box.height * 0.72 },
    { x: box.x + box.width * 0.34, y: box.y + box.height * 0.68 },
    { x: box.x + box.width * 0.28, y: box.y + box.height * 0.38 },
  ];

  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down({ button: 'right' });
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 4 });
  }
  await page.mouse.up({ button: 'right' });
}

async function waitForScatterFastDiagnostic(
  page: Page,
  attributeName: string,
): Promise<void> {
  await page.waitForFunction(
    (name) => {
      const value = globalThis.document
        .querySelector('[data-testid="scatter-fast-route-diagnostics"]')
        ?.getAttribute(name);

      return value !== null && value !== undefined && value !== 'pending';
    },
    attributeName,
    { timeout: ACTION_TIMEOUT_MS },
  );
}

async function setScatterFastMode(
  page: Page,
  mode: 'hover' | 'lasso' | 'measure' | 'pan' | 'select' | 'zoom',
): Promise<void> {
  const currentMode = await page
    .getByTestId('scatter-fast-chart-shell')
    .getAttribute('data-mode')
    .catch(() => null);
  if (currentMode !== mode) {
    await page
      .getByRole('button', { exact: true, name: scatterFastModeButtonName(mode) })
      .click({ timeout: ACTION_TIMEOUT_MS })
      .catch(async () => {
        await page.evaluate((nextMode) => {
          (globalThis as unknown as {
            __scatterFastRouteStateTestHook?: {
              setMode: (mode: typeof nextMode) => void;
            };
          }).__scatterFastRouteStateTestHook?.setMode(nextMode);
        }, mode);
      });
  }
  await page.waitForFunction(
    (nextMode) =>
      globalThis.document
        .querySelector('[data-testid="scatter-fast-chart-shell"]')
        ?.getAttribute('data-mode') === nextMode &&
      globalThis.document
        .querySelector('[data-testid="scatter-fast-route-diagnostics"]')
        ?.getAttribute('data-mode') === nextMode,
    mode,
    { timeout: ACTION_TIMEOUT_MS },
  );
}

async function setScatterFastVisualizationMode(
  page: Page,
  displayMode: ScatterFastVisualizationMode,
): Promise<void> {
  await page.evaluate((nextDisplayMode) => {
    (globalThis as unknown as {
      __scatterFastRouteStateTestHook?: {
        setVisualizationMode: (mode: typeof nextDisplayMode) => void;
      };
    }).__scatterFastRouteStateTestHook?.setVisualizationMode(nextDisplayMode);
  }, displayMode);

  await waitForScatterFastVisualizationMode(page, displayMode);
}

async function setScatterFastVisualizationModeWithoutReadinessGate(
  page: Page,
  displayMode: ScatterFastVisualizationMode,
): Promise<void> {
  await page.evaluate((nextDisplayMode) => {
    (globalThis as unknown as {
      __scatterFastRouteStateTestHook?: {
        setVisualizationMode: (mode: typeof nextDisplayMode) => void;
      };
    }).__scatterFastRouteStateTestHook?.setVisualizationMode(nextDisplayMode);
  }, displayMode);
  await page.waitForTimeout(100);
}

async function waitForScatterFastVisualizationMode(
  page: Page,
  displayMode: ScatterFastVisualizationMode,
): Promise<void> {
  const timeoutMs =
    displayMode === 'bubble'
      ? Math.max(SCATTER_FAST_PROBE_TIMEOUT_MS, 60_000)
      : SCATTER_FAST_PROBE_TIMEOUT_MS;

  await page.waitForFunction(
    (nextDisplayMode) => {
      const diagnostics = globalThis.document.querySelector(
        '[data-testid="scatter-fast-route-diagnostics"]',
      );
      const visualizationMode =
        diagnostics?.getAttribute('data-visualization-mode');
      const aggregateStatus = diagnostics?.getAttribute('data-aggregate-status');
      const aggregateBuildMs = diagnostics?.getAttribute('data-aggregate-build-ms');
      const aggregateCount = diagnostics?.getAttribute('data-aggregate-count');
      const aggregateCellCount = diagnostics?.getAttribute('data-aggregate-cell-count');
      const aggregateObservableMs = diagnostics?.getAttribute(
        'data-aggregate-worker-observable-ms',
      );
      const aggregateWorkerMode = diagnostics?.getAttribute(
        'data-aggregate-worker-mode',
      );
      const renderDrawCalls = diagnostics?.getAttribute('data-renderer-draw-calls');
      const subplotCount = diagnostics?.getAttribute('data-subplot-count');

      if (visualizationMode !== nextDisplayMode || subplotCount === 'pending') {
        return false;
      }

      if (renderDrawCalls !== null && renderDrawCalls !== 'pending') {
        return true;
      }

      if (nextDisplayMode === 'points') {
        return aggregateStatus === 'points';
      }

      if (nextDisplayMode === 'bubble') {
        return (
          aggregateStatus === 'ready' &&
          aggregateBuildMs !== null &&
          aggregateBuildMs !== 'pending' &&
          aggregateCount !== null &&
          aggregateCount !== 'pending' &&
          renderDrawCalls !== null &&
          renderDrawCalls !== 'pending' &&
          aggregateWorkerMode !== null &&
          aggregateWorkerMode !== 'pending' &&
          (
            aggregateWorkerMode === 'sync' ||
            (aggregateObservableMs !== null &&
              aggregateObservableMs !== 'pending')
          )
        );
      }

      return (
        aggregateStatus === 'ready' &&
        aggregateBuildMs !== null &&
        aggregateBuildMs !== 'pending' &&
        aggregateCellCount !== null &&
        aggregateCellCount !== 'pending' &&
        renderDrawCalls !== null &&
        renderDrawCalls !== 'pending' &&
        aggregateWorkerMode !== null &&
        aggregateWorkerMode !== 'pending' &&
        (
          aggregateWorkerMode === 'sync' ||
          aggregateObservableMs !== null &&
          aggregateObservableMs !== 'pending'
        )
      );
    },
    displayMode,
    { timeout: timeoutMs },
  );
}

async function waitForScatterFastAggregateHoverResult(
  page: Page,
  startedAt: number,
): Promise<{
  candidateCount: number | null;
  pointId: string | null;
  sourceIndex: number | null;
} | null> {
  try {
    await page.waitForFunction(
      () => {
        const hook = (globalThis as {
          __scatterFastHoverTestHook?: {
            getCurrentHover: () => {
              candidateCount?: number;
              point?: { id?: string; sourceIndex?: number };
            } | null;
          };
        }).__scatterFastHoverTestHook;
        const hover = hook?.getCurrentHover?.();

        return hover !== null && hover !== undefined && hover.point !== undefined;
      },
      undefined,
      {
        timeout: Math.max(1, SCATTER_FAST_PROBE_TIMEOUT_MS - (performance.now() - startedAt)),
      },
    );

    return await page.evaluate(() => {
      const hook = (globalThis as {
        __scatterFastHoverTestHook?: {
          getCurrentHover: () => {
            candidateCount?: number;
            point?: { id?: string; sourceIndex?: number };
          } | null;
        };
      }).__scatterFastHoverTestHook;
      const hover = hook?.getCurrentHover?.();
      if (hover === null || hover === undefined) {
        return null;
      }

      return {
        candidateCount:
          typeof hover.candidateCount === 'number' ? hover.candidateCount : null,
        pointId: typeof hover.point?.id === 'string' ? hover.point.id : null,
        sourceIndex:
          typeof hover.point?.sourceIndex === 'number'
            ? hover.point.sourceIndex
            : null,
      };
    });
  } catch {
    return null;
  }
}

async function runScatterFastHeatmapBinSizeChange(
  page: Page,
  binSizeSequencePx: readonly number[],
): Promise<ScatterFastHeatmapBinSizeChangeResult> {
  const startedAt = performance.now();
  const finalBinSizePx = binSizeSequencePx[binSizeSequencePx.length - 1] ?? null;

  try {
    await setScatterFastVisualizationMode(page, 'heatmap');
    await page.evaluate((sequence) => {
      const hook = (globalThis as {
        __scatterFastRouteStateTestHook?: {
          setHeatmapBinSizePx: (binSizePx: number) => void;
        };
      }).__scatterFastRouteStateTestHook;

      if (typeof hook?.setHeatmapBinSizePx !== 'function') {
        throw new Error('Scatter-fast heatmap bin-size hook is unavailable.');
      }

      for (const binSizePx of sequence) {
        hook.setHeatmapBinSizePx(binSizePx);
      }
    }, [...binSizeSequencePx]);

    await page.waitForFunction(
      (targetBinSizePx) => {
        const diagnostics = globalThis.document.querySelector(
          '[data-testid="scatter-fast-route-diagnostics"]',
        );
        return (
          diagnostics?.getAttribute('data-visualization-mode') === 'heatmap' &&
          diagnostics?.getAttribute('data-heatmap-bin-size-px') ===
            String(targetBinSizePx) &&
          diagnostics?.getAttribute('data-aggregate-status') === 'ready' &&
          diagnostics?.getAttribute('data-aggregate-cell-count') !== 'pending' &&
          diagnostics?.getAttribute('data-aggregate-worker-mode') !== 'pending' &&
          diagnostics?.getAttribute('data-aggregate-worker-observable-ms') !==
            'pending'
        );
      },
      finalBinSizePx,
      { timeout: SCATTER_FAST_PROBE_TIMEOUT_MS },
    );

    const diagnostics = await safeReadScatterFastMetrics(page);

    return {
      binSizeSequencePx: [...binSizeSequencePx],
      diagnostics,
      finalAggregateComputeMs: numberMetric(diagnostics.aggregateBuildMs),
      finalAggregateObservableMs: numberMetric(
        diagnostics.aggregateWorkerObservableMs,
      ),
      finalBinSizePx: numberMetric(diagnostics.heatmapBinSizePx),
      observedMs: performance.now() - startedAt,
      status: 'ok',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';

    return {
      binSizeSequencePx: [...binSizeSequencePx],
      diagnostics: await safeReadScatterFastMetrics(page),
      finalAggregateComputeMs: null,
      finalAggregateObservableMs: null,
      finalBinSizePx,
      observedMs: performance.now() - startedAt,
      status: message.toLowerCase().includes('timeout') ? 'timeout' : 'unavailable',
    };
  }
}

async function runScatterFastSymbolSizeScaleChange(
  page: Page,
  targetScale: number,
): Promise<ScatterFastDiagnosticResult> {
  const startedAt = performance.now();
  try {
    const previousMetrics = await safeReadScatterFastMetrics(page);

    await page.evaluate((scale) => {
      const hook = (
        globalThis as unknown as {
          __scatterFastRouteStateTestHook?: {
            setPointSizeScale?: (nextScale: number) => void;
          };
        }
      ).__scatterFastRouteStateTestHook;

      if (typeof hook?.setPointSizeScale !== 'function') {
        throw new Error('Scatter-fast point-size route hook is unavailable.');
      }

      hook.setPointSizeScale(scale);
    }, targetScale);

    await page.waitForFunction(
      (scale) => {
        const diagnostics = globalThis.document.querySelector(
          '[data-testid="scatter-fast-route-diagnostics"]',
        );
        const actual = Number(diagnostics?.getAttribute('data-user-point-size-scale'));
        const redraw = diagnostics?.getAttribute('data-renderer-redraw-cpu-ms');

        return (
          Number.isFinite(actual) &&
          Math.abs(actual - scale) < 0.0001 &&
          redraw !== null &&
          redraw !== 'pending'
        );
      },
      targetScale,
      { timeout: SCATTER_FAST_PROBE_TIMEOUT_MS },
    );

    const diagnostics = await safeReadScatterFastMetrics(page);
    diagnostics.rendererDrawCalls =
      diagnostics.rendererDrawCalls ?? previousMetrics.rendererDrawCalls ?? null;
    diagnostics.rendererRedrawCpuMs =
      diagnostics.rendererRedrawCpuMs ?? previousMetrics.rendererRedrawCpuMs ?? null;
    diagnostics.rendererRedrawGpuMs =
      diagnostics.rendererRedrawGpuMs ?? previousMetrics.rendererRedrawGpuMs ?? null;
    diagnostics.rendererUploadBytes =
      diagnostics.rendererUploadBytes ?? previousMetrics.rendererUploadBytes ?? null;
    diagnostics.rendererUploadMs =
      diagnostics.rendererUploadMs ?? previousMetrics.rendererUploadMs ?? null;
    diagnostics.symbolSizeUploadBytesBefore = previousMetrics.rendererUploadBytes ?? null;
    diagnostics.symbolSizeUploadMsBefore = previousMetrics.rendererUploadMs ?? null;
    diagnostics.symbolSizeScaleNote =
      targetScale === 10 ? '10x fill-rate stress case' : 'uniform scale update';

    return {
      diagnostics,
      observedMs: performance.now() - startedAt,
      status: 'ok',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';

    return {
      diagnostics: await safeReadScatterFastMetrics(page),
      observedMs: performance.now() - startedAt,
      status: message.toLowerCase().includes('timeout') ? 'timeout' : 'unavailable',
    };
  }
}

function scatterFastModeButtonName(
  mode: 'hover' | 'lasso' | 'measure' | 'pan' | 'select' | 'zoom',
): string {
  switch (mode) {
    case 'hover':
      return 'Hover';
    case 'lasso':
      return 'Lasso select';
    case 'measure':
      return 'Measure';
    case 'pan':
      return 'Pan';
    case 'select':
      return 'Rectangle select';
    case 'zoom':
      return 'Zoom';
  }
}

async function timeAction(
  action: () => Promise<void>,
  timeoutMs = METRIC_TIMEOUT_MS,
): Promise<TimedResult> {
  const startedAt = performance.now();
  try {
    await Promise.race([
      action(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`action timeout after ${timeoutMs} ms`));
        }, timeoutMs);
      }),
    ]);

    return { observedMs: performance.now() - startedAt, status: 'ok' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';

    return {
      observedMs: performance.now() - startedAt,
      status: message.toLowerCase().includes('timeout') ? 'timeout' : 'unavailable',
    };
  }
}

async function readElapsedFromNavigation(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const startedAt = (globalThis as { __scatterNavigationStartedAt?: number })
      .__scatterNavigationStartedAt;

    return startedAt === undefined ? null : performance.now() - startedAt;
  });
}

async function readScatterFastMetrics(
  page: Page,
): Promise<Record<string, number | string | boolean | null>> {
  const shellMetrics = await readDataAttributes(page.getByTestId('scatter-fast-chart-shell'));
  const diagnosticMetrics = await readDataAttributes(
    page.getByTestId('scatter-fast-route-diagnostics'),
  );

  return sanitizeBenchmarkMetrics({ ...shellMetrics, ...diagnosticMetrics });
}

async function safeReadScatterFastMetrics(
  page: Page,
): Promise<Record<string, number | string | boolean | null>> {
  try {
    return await readScatterFastMetrics(page);
  } catch {
    return {};
  }
}

function firstNonEmptyMetrics(
  ...candidates: Array<Record<string, number | string | boolean | null> | undefined>
): Record<string, number | string | boolean | null> {
  for (const candidate of candidates) {
    if (candidate !== undefined && Object.keys(candidate).length > 0) {
      return candidate;
    }
  }

  return {};
}

async function readDataAttributes(
  locator: Locator,
): Promise<Record<string, number | string | boolean | null>> {
  return locator.evaluate((element) => {
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

function sanitizeBenchmarkMetrics(
  metrics: Record<string, number | string | boolean | null>,
): Record<string, number | string | boolean | null> {
  const sanitized: Record<string, number | string | boolean | null> = {};

  for (const [key, value] of Object.entries(metrics)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes('idsample') ||
      normalizedKey.includes('sampleids') ||
      normalizedKey.includes('selectedids') ||
      normalizedKey.includes('idpayload')
    ) {
      continue;
    }
    sanitized[key] = value;
  }

  return sanitized;
}

async function isCanvasNonblank(page: Page, selector: string): Promise<boolean> {
  try {
    return await page.evaluate((canvasSelector) => {
      const hasContent = (globalThis as {
        __scatterCanvasHasContent?: (selector: string) => boolean;
      }).__scatterCanvasHasContent;

      return hasContent?.(canvasSelector) === true;
    }, selector);
  } catch {
    return false;
  }
}

async function isScreenshotNonblank(page: Page): Promise<boolean> {
  let screenshot: Buffer;
  try {
    screenshot = await page.screenshot({ fullPage: false });
  } catch {
    return false;
  }

  return screenshot.some((byte) => byte !== 0);
}

function numberMetric(value: number | string | boolean | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readScatterDataset(path: URL): ScatterDataset {
  return JSON.parse(readFileSync(path, 'utf8')) as ScatterDataset;
}

function parseArgs(args: string[]): Options {
  const options: Options = { port: DEFAULT_PORT, runs: DEFAULT_RUNS };

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

function createSummary(results: readonly BenchmarkResult[]) {
  const scatterFastResults = results.map((result) => result.scatterFast);

  return {
    scatterFast: {
      canvasNonblank: scatterFastResults.every((result) => result.canvasNonblank),
      firstNonblankFromNavigationMsMedian: medianNumbers(
        scatterFastResults.map((result) => result.firstNonblankFromNavigationMs),
      ),
      compatibilityObjectMaterializationMsMedian: medianNumbers(
        scatterFastResults.map((result) =>
          numberMetric(result.metrics.compatibilityObjectMaterializationMs),
        ),
      ),
      datasetFetchMsMedian: medianNumbers(
        scatterFastResults.map((result) => numberMetric(result.metrics.datasetFetchMs)),
      ),
      datasetLoadMsMedian: medianNumbers(
        scatterFastResults.map((result) => numberMetric(result.metrics.datasetLoadMs)),
      ),
      datasetParseMsMedian: medianNumbers(
        scatterFastResults.map((result) => numberMetric(result.metrics.datasetParseMs)),
      ),
      columnarDecodeMsMedian: medianNumbers(
        scatterFastResults.map((result) => numberMetric(result.metrics.columnarDecodeMs)),
      ),
      columnarBytesMedian: medianNumbers(
        scatterFastResults.map((result) => numberMetric(result.metrics.columnarBytes)),
      ),
      firstCanvasRenderScheduleMsMedian: medianNumbers(
        scatterFastResults.map((result) =>
          numberMetric(result.metrics.firstCanvasRenderScheduleMs),
        ),
      ),
      hoverLookupMsMedian: medianNumbers(
        scatterFastResults.map(
          (result) => numberMetric(result.hover?.diagnostics.hoverLookupMs),
        ),
      ),
      hoverTraceDrawCallsMedian: medianNumbers(
        scatterFastResults.map((result) => result.hoverTrace?.drawCallsMedian ?? null),
      ),
      hoverTraceDrawCallsP95: medianNumbers(
        scatterFastResults.map((result) => result.hoverTrace?.drawCallsP95 ?? null),
      ),
      hoverTraceLookupMsMedian: medianNumbers(
        scatterFastResults.map((result) => result.hoverTrace?.hoverLookupMsMedian ?? null),
      ),
      hoverTraceLookupMsP95: medianNumbers(
        scatterFastResults.map((result) => result.hoverTrace?.hoverLookupMsP95 ?? null),
      ),
      hoverTraceOverlayMsMedian: medianNumbers(
        scatterFastResults.map((result) => result.hoverTrace?.hoverOverlayMsMedian ?? null),
      ),
      hoverTraceOverlayMsP95: medianNumbers(
        scatterFastResults.map((result) => result.hoverTrace?.hoverOverlayMsP95 ?? null),
      ),
      measurementMsMedian: medianNumbers(
        scatterFastResults.map(
          (result) => numberMetric(result.measurementPick?.diagnostics.measurementUpdateMs),
        ),
      ),
      measurementTraceMsMedian: medianNumbers(
        scatterFastResults.map(
          (result) => result.measurementTrace?.measurementMsMedian ?? null,
        ),
      ),
      measurementTraceMsP95: medianNumbers(
        scatterFastResults.map((result) => result.measurementTrace?.measurementMsP95 ?? null),
      ),
      modeBenchmarks: {
        bubble: summarizeScatterFastDisplayMode(
          scatterFastResults.map((result) => result.displayModes.bubble),
        ),
        heatmap: summarizeScatterFastHeatmapDisplayMode(
          scatterFastResults.map((result) => result.displayModes.heatmap),
        ),
        points: summarizeScatterFastDisplayMode(
          scatterFastResults.map((result) => result.displayModes.points),
        ),
      },
      panFrameMsMedian: medianNumbers(
        scatterFastResults.map(
          (result) => numberMetric(result.pan?.diagnostics.dragPanMs),
        ),
      ),
      navigatorSummaryMsMedian: medianNumbers(
        scatterFastResults.map((result) =>
          numberMetric(result.metrics.navigatorSummaryMs),
        ),
      ),
      outOfRangeMsMedian: medianNumbers(
        scatterFastResults.map((result) => numberMetric(result.metrics.outOfRangeMs)),
      ),
      recordCount: scatterFastResults[0]?.recordCount ?? 0,
      rectangleSelectionComputeMsMedian: medianNumbers(
        scatterFastResults.map(
          (result) => result.rectangleSelection?.selectionComputeMs ?? null,
        ),
      ),
      renderCpuMsMedian: medianNumbers(
        scatterFastResults.map((result) =>
          numberMetric(result.metrics.rendererRedrawCpuMs),
        ),
      ),
      renderDrawCallsMedian: medianNumbers(
        scatterFastResults.map((result) => numberMetric(result.metrics.rendererDrawCalls)),
      ),
      renderGpuMsMedian: medianNumbers(
        scatterFastResults.map((result) =>
          numberMetric(result.metrics.rendererRedrawGpuMs),
        ),
      ),
      schemaEncodeMsMedian: medianNumbers(
        scatterFastResults.map((result) => numberMetric(result.metrics.schemaEncodeMs)),
      ),
      routeReadyFromNavigationMsMedian: medianNumbers(
        scatterFastResults.map((result) => result.routeReadyFromNavigationMs),
      ),
      screenshotNonblank: scatterFastResults.every(
        (result) => result.screenshotNonblank,
      ),
      selectedOverlayUpdateMsMedian: medianNumbers(
        scatterFastResults.map(
          (result) => result.rectangleSelection?.selectedVisualUpdateMs ?? null,
        ),
      ),
      summaryComputeMsMedian: medianNumbers(
        scatterFastResults.map((result) => numberMetric(result.metrics.summaryComputeMs)),
      ),
      summarySelectedMsMedian: medianNumbers(
        scatterFastResults.map((result) => numberMetric(result.metrics.summarySelectedMs)),
      ),
      symbolSizeChangeCpuMsMedian: medianNumbers(
        scatterFastResults.flatMap((result) =>
          scatterFastSymbolSizeResults(result).map((change) =>
            numberMetric(change?.diagnostics.rendererRedrawCpuMs),
          ),
        ),
      ),
      symbolSizeChangeDrawCallsMedian: medianNumbers(
        scatterFastResults.flatMap((result) =>
          scatterFastSymbolSizeResults(result).map((change) =>
            numberMetric(change?.diagnostics.rendererDrawCalls),
          ),
        ),
      ),
      symbolSizeChangeGpuMsMedian: medianNumbers(
        scatterFastResults.flatMap((result) =>
          scatterFastSymbolSizeResults(result).map((change) =>
            numberMetric(change?.diagnostics.rendererRedrawGpuMs),
          ),
        ),
      ),
      symbolSizeChangeMsMedian: medianNumbers(
        scatterFastResults.flatMap((result) =>
          scatterFastSymbolSizeResults(result).map((change) => change?.observedMs ?? null),
        ),
      ),
      symbolSizeStress10xGpuMsMedian: medianNumbers(
        scatterFastResults.map((result) =>
          numberMetric(
            result.symbolSizeScaleChanges.stress10x?.diagnostics.rendererRedrawGpuMs,
          ),
        ),
      ),
      symbolSizeUploadBytesMedian: medianNumbers(
        scatterFastResults.flatMap((result) =>
          scatterFastSymbolSizeResults(result).map((change) =>
            numberMetric(change?.diagnostics.rendererUploadBytes),
          ),
        ),
      ),
      symbolSizeStressNote:
        '10x symbol size is reported as a GPU fill-rate stress case, not a normal operating target.',
      uploadBytesMedian: medianNumbers(
        scatterFastResults.map((result) =>
          numberMetric(result.metrics.rendererUploadBytes),
        ),
      ),
      uploadMsMedian: medianNumbers(
        scatterFastResults.map((result) => numberMetric(result.metrics.rendererUploadMs)),
      ),
      wheelZoomFrameMsMedian: medianNumbers(
        scatterFastResults.map(
          (result) => numberMetric(result.wheelZoom?.diagnostics.wheelZoomMs),
        ),
      ),
    },
  };
}

function summarizeScatterFastDisplayMode(
  results: readonly ScatterFastDisplayModeResult[],
) {
  return {
    aggregateComputeMsMedian: medianNumbers(
      results.map((result) => result.snapshot.aggregateComputeMs),
    ),
    aggregateCountMedian: medianNumbers(
      results.map((result) => result.snapshot.aggregateCount),
    ),
    aggregateHoverCandidateCountMedian: medianNumbers(
      results.map((result) => result.aggregateHover?.candidateCount ?? null),
    ),
    aggregateHoverLookupMsMedian: medianNumbers(
      results.map((result) =>
        numberMetric(result.aggregateHover?.diagnostics.hoverLookupMs),
      ),
    ),
    aggregateObservableMsMedian: medianNumbers(
      results.map((result) => result.snapshot.aggregateObservableMs),
    ),
    aggregateSelectionComputeMsMedian: medianNumbers(
      results.map((result) => result.aggregateSelection?.selectionComputeMs ?? null),
    ),
    aggregateSelectionCountMedian: medianNumbers(
      results.map((result) => result.aggregateSelection?.selectedCount ?? null),
    ),
    aggregateSelectionObservableMsMedian: medianNumbers(
      results.map(
        (result) => result.aggregateSelection?.selectionWorkerObservableMs ?? null,
      ),
    ),
    aggregateSelectionTransferMsMedian: medianNumbers(
      results.map(
        (result) => result.aggregateSelection?.selectionWorkerTransferMs ?? null,
      ),
    ),
    aggregateStatus: results[0]?.snapshot.aggregateStatus ?? null,
    aggregateTransferMsMedian: medianNumbers(
      results.map((result) => result.snapshot.aggregateTransferMs),
    ),
    aggregateUploadBytesMedian: medianNumbers(
      results.map((result) => result.snapshot.aggregateUploadBytes),
    ),
    aggregateWorkerMode: results[0]?.snapshot.aggregateWorkerMode ?? null,
    cellCountMedian: medianNumbers(results.map((result) => result.snapshot.cellCount)),
    displayMode: results[0]?.snapshot.displayMode ?? 'points',
    populatedCellCountMedian: medianNumbers(
      results.map((result) => result.snapshot.populatedCellCount),
    ),
    recordCount: results[0]?.snapshot.recordCount ?? null,
    renderDrawCallsMedian: medianNumbers(
      results.map((result) => result.snapshot.renderDrawCalls),
    ),
    renderObservableMsMedian: medianNumbers(
      results.map((result) => result.snapshot.renderObservableMs),
    ),
    subplotCount: results[0]?.snapshot.subplotCount ?? null,
    switchModeMsMedian: medianNumbers(
      results.map((result) => result.switchMode.observedMs),
    ),
    visiblePointCountMedian: medianNumbers(
      results.map((result) => result.snapshot.visiblePointCount),
    ),
  };
}

function summarizeScatterFastHeatmapDisplayMode(
  results: readonly ScatterFastHeatmapDisplayModeResult[],
) {
  return {
    ...summarizeScatterFastDisplayMode(results),
    heatmapBinSizeChangeFinalBinPxMedian: medianNumbers(
      results.map((result) => result.heatmapBinSizeChange?.finalBinSizePx ?? null),
    ),
    heatmapBinSizeChangeFinalComputeMsMedian: medianNumbers(
      results.map(
        (result) => result.heatmapBinSizeChange?.finalAggregateComputeMs ?? null,
      ),
    ),
    heatmapBinSizeChangeFinalObservableMsMedian: medianNumbers(
      results.map(
        (result) => result.heatmapBinSizeChange?.finalAggregateObservableMs ?? null,
      ),
    ),
    heatmapBinSizeChangeMsMedian: medianNumbers(
      results.map((result) => result.heatmapBinSizeChange?.observedMs ?? null),
    ),
    heatmapBinSizeSequencePx: results[0]?.heatmapBinSizeChange?.binSizeSequencePx ?? [],
  };
}

function scatterFastSymbolSizeResults(
  result: ScatterFastRouteResult,
): readonly (ScatterFastDiagnosticResult | null)[] {
  return [
    result.symbolSizeScaleChanges.decrease,
    result.symbolSizeScaleChanges.reset,
    result.symbolSizeScaleChanges.increase,
    result.symbolSizeScaleChanges.stress10x,
  ];
}

function medianNumbers(values: readonly (number | null)[]): number | null {
  const numberValues = values.filter((value): value is number => value !== null);
  if (numberValues.length === 0) {
    return null;
  }
  const sorted = [...numberValues].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function percentileNumbers(
  values: readonly (number | null)[],
  percentile: number,
): number | null {
  const numberValues = values.filter((value): value is number => value !== null);
  if (numberValues.length === 0) {
    return null;
  }
  const sorted = [...numberValues].sort((a, b) => a - b);
  const clampedPercentile = Math.max(0, Math.min(1, percentile));
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(clampedPercentile * sorted.length) - 1,
  );

  return sorted[index] ?? null;
}

void main();
