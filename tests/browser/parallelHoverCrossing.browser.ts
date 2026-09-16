/// <reference types="vite/client" />
import { generateAndStoreScatterWebgpuDataset } from '../../apps/demo/src/data/scatterWebgpuDatasetStore.js';
import { loadParallelWebgpuDataset, LocalParallelWebgpuDatasetUnavailableError } from '../../apps/demo/src/data/parallelWebgpuDatasetAdapter.js';
import * as parallel from '../../packages/m-charts/src/m-parallel-webgpu/index.js';

const params = new URLSearchParams(location.search);
const rows = Number(params.get('rows') ?? 25_000_000);
const status = document.querySelector('#status')!;
const results = document.querySelector('#results')!;
const host = document.querySelector<HTMLDivElement>('#plot')!;
const errors: string[] = [];
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const summarize = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1) };
};
try {
  const load = () => loadParallelWebgpuDataset({ pointCount: rows, fixtureUrl: '', tableMode: 'single', residentClientView: true,
    signal: new AbortController().signal, startedAt: performance.now() });
  const loaded = await load().catch(async (error: unknown) => {
    if (!(error instanceof LocalParallelWebgpuDatasetUnavailableError)) throw error;
    status.textContent = `Generating ${rows.toLocaleString()} local rows…`;
    await generateAndStoreScatterWebgpuDataset({ pointCount: rows, signal: new AbortController().signal,
      onProgress: ({ completedPages, pageCount }) => { status.textContent = `Generating page ${completedPages}/${pageCount}`; } });
    return load();
  });
  const plot = parallel.createParallelWebgpuPlot(host, { buffers: loaded.buffers });
  window.addEventListener('pagehide', () => plot.dispose());
  await plot.ready;
  await plot.waitForGpuIdle();
  const lookup: number[] = [], submit: number[] = [], gpuComplete: number[] = [], frameComplete: number[] = [], counts: number[] = [];
  for (let i = 0; i < 50; i++) {
    await frame();
    const start = performance.now();
    const hit = await plot.commands.resolveInspectionAtPoint({ axisPosition: 2.55, normalizedValue: 0.42 + 0.07 * Math.sin(i * 0.27),
      maxDistancePx: 3, plotWidthPx: host.clientWidth, plotHeightPx: host.clientHeight });
    const picked = performance.now();
    if (hit === null) throw new Error('Expected crossing hover hit');
    plot.commands.setInspection({ ...hit, source: 'local-nearest-segment' });
    const submitted = performance.now();
    await plot.waitForGpuIdle();
    const completed = performance.now();
    await frame();
    if (i >= 5) {
      lookup.push(picked - start); submit.push(submitted - picked); gpuComplete.push(completed - start); frameComplete.push(performance.now() - start);
      counts.push(hit.sourceIndices!.length);
    }
    status.textContent = `Measuring ${i + 1}/50`;
  }
  // Drive the actual bindings at display cadence, separately from fenced timings.
  let active = 0, maximumActive = 0;
  const resolve = plot.commands.resolveInspectionAtPoint.bind(plot.commands);
  plot.commands.resolveInspectionAtPoint = async (point) => {
    active++; maximumActive = Math.max(maximumActive, active);
    try { return await resolve(point); } finally { active--; }
  };
  plot.commands.clearInspection();
  plot.use(parallel.createDefaultParallelBindings({ inputElement: host, coordinateTarget: host,
    inspection: { explicitHoverModeActive: () => true } }));
  const updateTimes: number[] = [];
  plot.on('inspectionchange', ({ inspection }) => { if (inspection !== null) updateTimes.push(performance.now()); });
  const bounds = host.getBoundingClientRect();
  const move = (value: number) => host.dispatchEvent(new PointerEvent('pointermove', {
    clientX: bounds.left + host.clientWidth * 2.55 / 3,
    clientY: bounds.top + (1 - parallel.parallelRenderedNormalizedValueToDisplayValue(value)) * host.clientHeight,
    pointerId: 1, bubbles: true,
  }));
  const movementStarted = performance.now();
  let sent = 0;
  while (performance.now() - movementStarted < 2_000) {
    move(0.42 + 0.07 * Math.sin(sent++ * 0.27));
    await frame();
  }
  const movementElapsed = performance.now() - movementStarted;
  const movementUpdates = updateTimes.length;
  move(0.42);
  const settleStarted = performance.now();
  while (performance.now() - settleStarted < 500) await frame();
  const finalInspection = plot.commands.getStateSnapshot().inspection;
  const expected = await resolve({ axisPosition: 2.55, normalizedValue: 0.42, maxDistancePx: 3,
    plotWidthPx: host.clientWidth, plotHeightPx: host.clientHeight });
  if (finalInspection === null || finalInspection.recordIndex !== expected?.recordIndex) throw new Error('Latest pointer did not win');
  if (maximumActive !== 1 || movementUpdates < 20) throw new Error(`Continuous hover stalled: ${movementUpdates} updates, ${maximumActive} active queries`);
  host.dispatchEvent(new PointerEvent('pointerleave'));
  await frame();
  if (plot.commands.getStateSnapshot().inspection !== null) throw new Error('Pointer leave did not clear hover');
  const intervals = updateTimes.slice(1, movementUpdates).map((time, i) => time - updateTimes[i]!);
  results.textContent = JSON.stringify({ rows, width: host.clientWidth, height: host.clientHeight, dpr: devicePixelRatio,
    matches: { min: Math.min(...counts), max: Math.max(...counts) }, lookup: summarize(lookup), submit: summarize(submit),
    gpuComplete: summarize(gpuComplete), frameComplete: summarize(frameComplete), movement: { sent, updates: movementUpdates, updatesPerSecond: movementUpdates * 1000 / movementElapsed, intervals: summarize(intervals), maximumActive }, errors }, null, 2);
  status.textContent = errors.length ? 'FAIL' : 'PASS';
} catch (error) { status.textContent = 'FAIL'; results.textContent = String(error); }
