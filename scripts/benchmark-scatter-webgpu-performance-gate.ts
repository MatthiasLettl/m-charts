import { spawn, type ChildProcess } from 'node:child_process';
import { chromium } from '@playwright/test';

interface Options {
  count: number;
  frames: number;
  maxFrameP95?: number;
  port: number;
  runs: number;
  visualizationMode: 'bubble' | 'heatmap' | 'points';
}

const options = parseOptions(process.argv.slice(2));
const server = startServer(options.port);
const baseUrl = `http://127.0.0.1:${options.port}`;

try {
  await waitForServer(baseUrl);
  const results = [];
  for (let run = 1; run <= options.runs; run += 1) {
    console.error(`benchmark:scatter-webgpu run ${run}/${options.runs}`);
    results.push(await runBenchmark(baseUrl, options));
  }
  console.log(JSON.stringify({ options, results }, null, 2));
  if (
    options.maxFrameP95 !== undefined &&
    results.some((result) =>
      result.frameMsP95 === null || result.frameMsP95 > options.maxFrameP95!,
    )
  ) {
    throw new Error(
      `WebGPU scatter p95 frame gate exceeded ${options.maxFrameP95}ms.`,
    );
  }
} finally {
  await stopServer(server);
}

async function runBenchmark(baseUrl: string, current: Options) {
  const browser = await chromium.launch({
    args: [
      '--disable-vulkan-surface',
      '--enable-features=Vulkan,WebGPU,UseSkiaRenderer',
      '--enable-unsafe-webgpu',
      '--use-angle=vulkan',
      '--use-vulkan=native',
    ],
  });
  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
  // A 25M-record cold route can keep the renderer main thread occupied for
  // longer than Playwright's 30s locator default even after the first frame is
  // ready. Keep all benchmark reads on the same budget as navigation/readiness.
  page.setDefaultTimeout(900_000);
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      console.error(`browser:${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => console.error(`browser:pageerror: ${error.message}`));
  const pageFailure = new Promise<never>((_resolve, reject) => {
    page.once('crash', () => reject(new Error('The WebGPU benchmark renderer process crashed.')));
    page.once('close', () => reject(new Error('The WebGPU benchmark page closed unexpectedly.')));
    browser.once('disconnected', () => reject(new Error('The WebGPU benchmark browser disconnected.')));
  });
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const probe = await page.evaluate(async () => {
      if (navigator.gpu === undefined) return { adapter: false, gpu: false };
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      return { adapter: adapter !== null, gpu: true };
    });
    if (!probe.gpu || !probe.adapter) {
      throw new Error(`WebGPU benchmark probe failed: ${JSON.stringify(probe)}`);
    }

    const navigationStartedAt = performance.now();
    await page.goto(
      `${baseUrl}/m-scatter-webgpu?points=${current.count}&mode=pan&axis=xy&viz=${current.visualizationMode}&__e2eScatterFastRouteStateHook=1&__e2eScatterFastHoverHook=1`,
      { timeout: 900_000, waitUntil: 'domcontentloaded' },
    );
    await Promise.race([
      page.waitForFunction(
        () => document.querySelector('[data-testid="scatter-fast-chart-shell"]')
          ?.getAttribute('data-render-state') === 'ready',
        undefined,
        { timeout: 900_000 },
      ),
      pageFailure,
    ]);
    const readyMs = performance.now() - navigationStartedAt;
    const trace = await page.evaluate(async (frameCount) => {
      const target = globalThis as typeof globalThis & {
        __scatterFastRouteStateTestHook?: {
          getFastViewport(): { x: { min: number; max: number } } | null;
          getWebgpuDiagnostics(): {
            lodStride: number;
            settledExact: boolean;
            settledFrameCount: number;
            submittedFrameCount: number;
          } | null;
          setSharedXRange(
            x: { min: number; max: number },
            reason?: 'wheel',
            phase?: 'preview' | 'commit',
          ): void;
        };
      };
      const hook = target.__scatterFastRouteStateTestHook;
      const viewport = hook?.getFastViewport();
      if (hook === undefined || viewport === null || viewport === undefined) {
        throw new Error('Scatter WebGPU benchmark route hook is unavailable.');
      }
      const activeHook = hook;
      const activeViewport = viewport;
      const span = activeViewport.x.max - activeViewport.x.min;
      const intervals: number[] = [];
      const longTasks: number[] = [];
      const observer = typeof PerformanceObserver === 'undefined'
        ? null
        : new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) longTasks.push(entry.duration);
          });
      observer?.observe({ entryTypes: ['longtask'] });
      for (let warmup = 0; warmup < 30; warmup += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const shift = Math.sin(warmup * 0.12) * span * 0.035;
        activeHook.setSharedXRange({
          max: activeViewport.x.max + shift,
          min: activeViewport.x.min + shift,
        }, 'wheel', 'preview');
      }
      let previous = performance.now();
      for (let frame = 0; frame < frameCount; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = performance.now();
        intervals.push(now - previous);
        previous = now;
        const shift = Math.sin(frame * 0.12) * span * 0.035;
        activeHook.setSharedXRange({
          max: activeViewport.x.max + shift,
          min: activeViewport.x.min + shift,
        }, 'wheel', 'preview');
      }
      activeHook.setSharedXRange(activeViewport.x, 'wheel', 'commit');
      observer?.disconnect();
      return { intervals, longTasks };
    }, current.frames);
    const interactionLatency = await page.evaluate(async () => {
      const target = globalThis as typeof globalThis & {
        __scatterFastRouteStateTestHook?: {
          getFastViewport(): { x: { min: number; max: number } } | null;
          getWebgpuDiagnostics(): {
            lodStride: number;
            settledExact: boolean;
            settledFrameCount: number;
            submittedFrameCount: number;
          } | null;
          getPointSizeScale(): number;
          setPointSizeScale(scale: number): void;
          setSharedXRange(
            x: { min: number; max: number },
            reason?: 'wheel',
            phase?: 'preview' | 'commit',
          ): void;
        };
      };
      const hook = target.__scatterFastRouteStateTestHook;
      const shell = document.querySelector<HTMLElement>('[data-testid="scatter-fast-route-diagnostics"]');
      const viewport = hook?.getFastViewport();
      if (hook === undefined || shell === null || viewport === null || viewport === undefined) {
        throw new Error('Scatter WebGPU latency hooks are unavailable.');
      }
      const span = viewport.x.max - viewport.x.min;
      const beforeViewport = hook.getWebgpuDiagnostics()?.submittedFrameCount ?? 0;
      const viewportStartedAt = performance.now();
      hook.setSharedXRange({
        max: viewport.x.max + span * 0.01,
        min: viewport.x.min + span * 0.01,
      }, 'wheel', 'preview');
      while (
        (hook.getWebgpuDiagnostics()?.submittedFrameCount ?? 0) === beforeViewport &&
        performance.now() - viewportStartedAt < 10_000
      ) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const viewportMs = (hook.getWebgpuDiagnostics()?.submittedFrameCount ?? 0) === beforeViewport
        ? null
        : performance.now() - viewportStartedAt;
      hook.setSharedXRange(viewport.x, 'wheel', 'commit');
      await new Promise((resolve) => setTimeout(resolve, 150));
      const pointSize = hook.getPointSizeScale();
      const beforePointSize = hook.getWebgpuDiagnostics()?.submittedFrameCount ?? 0;
      const pointSizeStartedAt = performance.now();
      hook.setPointSizeScale(pointSize === 1 ? 1.25 : 1);
      while (
        (hook.getWebgpuDiagnostics()?.submittedFrameCount ?? 0) === beforePointSize &&
        performance.now() - pointSizeStartedAt < 10_000
      ) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const pointSizeMs = (hook.getWebgpuDiagnostics()?.submittedFrameCount ?? 0) === beforePointSize
        ? null
        : performance.now() - pointSizeStartedAt;
      await new Promise((resolve) => setTimeout(resolve, 160));
      const beforeContention = hook.getWebgpuDiagnostics()?.submittedFrameCount ?? 0;
      const contentionStartedAt = performance.now();
      hook.setSharedXRange({
        max: viewport.x.max + span * 0.005,
        min: viewport.x.min + span * 0.005,
      }, 'wheel', 'preview');
      while (
        (hook.getWebgpuDiagnostics()?.submittedFrameCount ?? 0) === beforeContention &&
        performance.now() - contentionStartedAt < 10_000
      ) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const refinementContentionViewportMs =
        (hook.getWebgpuDiagnostics()?.submittedFrameCount ?? 0) === beforeContention
          ? null
          : performance.now() - contentionStartedAt;
      hook.setSharedXRange(viewport.x, 'wheel', 'commit');
      hook.setPointSizeScale(pointSize);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const beforeSettledViewport = hook.getWebgpuDiagnostics()?.settledFrameCount ?? 0;
      const settledViewportStartedAt = performance.now();
      hook.setSharedXRange({
        max: viewport.x.max - span * 0.2,
        min: viewport.x.min + span * 0.2,
      }, 'wheel', 'commit');
      while (
        (hook.getWebgpuDiagnostics()?.settledFrameCount ?? 0) === beforeSettledViewport &&
        performance.now() - settledViewportStartedAt < 10_000
      ) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const settledViewportMs =
        (hook.getWebgpuDiagnostics()?.settledFrameCount ?? 0) === beforeSettledViewport
          ? null
          : performance.now() - settledViewportStartedAt;
      const beforeReset = hook.getWebgpuDiagnostics()?.settledFrameCount ?? 0;
      const resetStartedAt = performance.now();
      hook.setSharedXRange(viewport.x, 'wheel', 'commit');
      while (
        (hook.getWebgpuDiagnostics()?.settledFrameCount ?? 0) === beforeReset &&
        performance.now() - resetStartedAt < 10_000
      ) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const resetViewportMs = (hook.getWebgpuDiagnostics()?.settledFrameCount ?? 0) === beforeReset
        ? null
        : performance.now() - resetStartedAt;
      const beforeDeepZoom = hook.getWebgpuDiagnostics()?.settledFrameCount ?? 0;
      const center = (viewport.x.min + viewport.x.max) / 2;
      const deepZoomStartedAt = performance.now();
      hook.setSharedXRange({
        max: center + span * 0.00025,
        min: center - span * 0.00025,
      }, 'wheel', 'commit');
      while (
        (
          (hook.getWebgpuDiagnostics()?.settledFrameCount ?? 0) === beforeDeepZoom ||
          hook.getWebgpuDiagnostics()?.settledExact !== true
        ) &&
        performance.now() - deepZoomStartedAt < 10_000
      ) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      const deepZoomDiagnostics = hook.getWebgpuDiagnostics();
      const beforeRestore = deepZoomDiagnostics?.settledFrameCount ?? 0;
      const restoreStartedAt = performance.now();
      hook.setSharedXRange(viewport.x, 'wheel', 'commit');
      while (
        (
          (hook.getWebgpuDiagnostics()?.settledFrameCount ?? 0) === beforeRestore ||
          (hook.getWebgpuDiagnostics()?.lodStride ?? 1) < 100
        ) &&
        performance.now() - restoreStartedAt < 10_000
      ) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return {
        deepZoomExact: deepZoomDiagnostics?.settledExact ?? false,
        deepZoomLodStride: deepZoomDiagnostics?.lodStride ?? null,
        pointSizeMs,
        refinementContentionViewportMs,
        resetViewportMs,
        settledViewportMs,
        viewportMs,
      };
    });
    const hoverRegion = await page.getByTestId('scatter-fast-hit-region').first().boundingBox();
    let hoverLatencyMs: number | null = null;
    if (hoverRegion !== null) {
      hoverLatencyMs = await page.evaluate(async (sourceIndex) => {
        const hook = (globalThis as typeof globalThis & {
          __scatterFastHoverTestHook?: {
            setHoverSourceIndex(sourceIndex: number | null): void;
          };
        }).__scatterFastHoverTestHook;
        if (hook === undefined) throw new Error('Scatter hover test hook is unavailable.');
        const startedAt = performance.now();
        hook.setHoverSourceIndex(sourceIndex);
        const expected = String(sourceIndex);
        const deadline = startedAt + 10_000;
        while (performance.now() < deadline) {
          const guide = document.querySelector(
            '[data-testid="scatter-fast-current-hover-guide"]',
          );
          if (guide?.getAttribute('data-source-index') === expected) {
            return performance.now() - startedAt;
          }
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        return null;
      }, Math.floor(current.count / 2));
    }
    const gestureLatency = hoverRegion === null
      ? { panMs: null, wheelMs: null }
      : await measureRealGestureLatency(page, hoverRegion);
    const diagnostics = {
      bufferBuildMs: await page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-buffer-build-ms'),
      cacheBytes: await page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-renderer-cache-bytes'),
      cachedFrame: await page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-renderer-cached-frame'),
      coalescedFrames: await page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-renderer-coalesced-frames'),
      estimatedPeakBytes: await page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-renderer-estimated-peak-bytes'),
      drawCalls: await page.getByTestId('scatter-fast-draw-calls').textContent(),
      datasetFetchMs: await page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-dataset-fetch-ms'),
      datasetLoadMs: await page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-dataset-load-ms'),
      gpuMs: await page.getByTestId('scatter-fast-redraw-gpu').textContent(),
      hoverCandidates: await page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-hover-lookup-candidates'),
      hoverLookupMs: await page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-hover-lookup-ms'),
      residentBytes: await page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-renderer-resident-bytes'),
      uploadBytes: await page.getByTestId('scatter-fast-upload-bytes').textContent(),
      uploadMs: await page.getByTestId('scatter-fast-route-diagnostics').getAttribute('data-renderer-upload-ms'),
      visiblePoints: await page.getByTestId('scatter-fast-visible-points').textContent(),
      webgpu: await page.evaluate(() => {
        const target = window as typeof window & {
          __scatterFastRouteStateTestHook?: { getWebgpuDiagnostics(): unknown };
        };
        return target.__scatterFastRouteStateTestHook?.getWebgpuDiagnostics() ?? null;
      }),
    };
    const sorted = [...trace.intervals].sort((a, b) => a - b);
    return {
      diagnostics,
      frameMsMedian: percentile(sorted, 0.5),
      frameMsP95: percentile(sorted, 0.95),
      frameMsP99: percentile(sorted, 0.99),
      hoverLatencyMs,
      gestureLatency,
      interactionLatency,
      longTaskCount: trace.longTasks.length,
      longTaskMaxMs: trace.longTasks.length === 0 ? 0 : Math.max(...trace.longTasks),
      readyMs,
      recordCount: current.count,
    };
  } finally {
    await page.close();
    await browser.close();
  }
}

async function measureRealGestureLatency(
  page: import('@playwright/test').Page,
  region: { height: number; width: number; x: number; y: number },
): Promise<{ panMs: number | null; wheelMs: number | null }> {
  const armInputProbe = (eventType: 'pointermove' | 'wheel') => page.evaluate((type) => {
    const target = window as typeof window & {
      __scatterFastInputProbe?: { before: number; eventAt: number | null };
      __scatterFastRouteStateTestHook?: {
        getWebgpuDiagnostics(): { submittedFrameCount: number } | null;
      };
    };
    target.__scatterFastInputProbe = {
      before: target.__scatterFastRouteStateTestHook?.getWebgpuDiagnostics()
        ?.submittedFrameCount ?? 0,
      eventAt: null,
    };
    window.addEventListener(type, () => {
      if (target.__scatterFastInputProbe !== undefined) {
        target.__scatterFastInputProbe.eventAt = performance.now();
      }
    }, { capture: true, once: true });
  }, eventType);
  const waitForSubmission = () => page.evaluate(async () => {
    const target = window as typeof window & {
      __scatterFastInputProbe?: { before: number; eventAt: number | null };
      __scatterFastRouteStateTestHook?: {
        getWebgpuDiagnostics(): { submittedFrameCount: number } | null;
      };
    };
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      const probe = target.__scatterFastInputProbe;
      const submitted = target.__scatterFastRouteStateTestHook?.getWebgpuDiagnostics()
        ?.submittedFrameCount ?? 0;
      if (probe?.eventAt !== null && probe?.eventAt !== undefined && submitted > probe.before) {
        return performance.now() - probe.eventAt;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return null;
  });
  const centerX = region.x + region.width * 0.5;
  const centerY = region.y + region.height * 0.5;
  await page.mouse.move(centerX, centerY);

  await armInputProbe('wheel');
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  const wheelMs = await waitForSubmission();
  // Isolate pan latency from the wheel binding's intentional 80 ms idle
  // commit; otherwise that commit can be mistaken for the first pan frame.
  await page.waitForTimeout(100);

  await armInputProbe('pointermove');
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(centerX + Math.min(24, region.width * 0.04), centerY);
  const panMs = await waitForSubmission();
  await page.mouse.move(centerX + Math.min(48, region.width * 0.08), centerY);
  await page.mouse.up({ button: 'middle' });
  return { panMs, wheelMs };
}

function parseOptions(args: readonly string[]): Options {
  const read = (flag: string, fallback: number) => {
    const index = args.indexOf(flag);
    const value = index >= 0 ? Number(args[index + 1]) : fallback;
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${flag}.`);
    return value;
  };
  const visualizationModeValue = readString(args, '--visualization-mode', 'points');
  if (
    visualizationModeValue !== 'points' &&
    visualizationModeValue !== 'bubble' &&
    visualizationModeValue !== 'heatmap'
  ) {
    throw new Error('Invalid --visualization-mode. Expected points, bubble, or heatmap.');
  }
  return {
    count: read('--count', 10_000_000),
    frames: read('--frames', 180),
    maxFrameP95: readOptionalPositiveNumber(args, '--max-frame-p95'),
    port: read('--port', 5188),
    runs: read('--runs', 1),
    visualizationMode: visualizationModeValue,
  };
}

function readString(args: readonly string[], flag: string, fallback: string): string {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : (args[index + 1] ?? fallback);
}

function readOptionalPositiveNumber(
  args: readonly string[],
  flag: string,
): number | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${flag}.`);
  return value;
}

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? null;
}

function startServer(port: number): ChildProcess {
  return spawn('pnpm', ['dev', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(),
    detached: true,
    env: process.env,
    stdio: 'ignore',
  });
}

async function waitForServer(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}.`);
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  if (server.pid !== undefined) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
  await Promise.race([
    new Promise<void>((resolve) => server.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null && server.pid !== undefined) {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      server.kill('SIGKILL');
    }
  }
}
