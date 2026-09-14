import * as parallel from '../../packages/m-charts/src/m-parallel-webgpu/index.js';

const status = document.querySelector('#status')!;
const results = document.querySelector('#results')!;
const errors: string[] = [];
const plots: parallel.ParallelWebgpuPlotInstance[] = [];
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
window.addEventListener('pagehide', () => plots.forEach((plot) => plot.dispose()));
const originalError = console.error;
console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); originalError(...args); };
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean) {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > 15_000) throw new Error('Timed out waiting for plot state');
    await frame();
  }
}
const host = () => {
  const element = document.createElement('div'); element.className = 'host';
  document.querySelector('#charts')!.append(element); return element;
};
async function run(name: string, action: () => Promise<void>) {
  const item = document.createElement('li'); item.textContent = `Running: ${name}`; results.append(item);
  try { await action(); item.textContent = `PASS: ${name}`; item.className = 'pass'; }
  catch (error) { item.textContent = `FAIL: ${name}: ${String(error)}`; item.className = 'fail'; }
}
const query = (normalizedValue: number, maxDistancePx = 6) => ({
  axisPosition: 0.5, normalizedValue, maxDistancePx, plotWidthPx: 800, plotHeightPx: 400,
});

await run('partial workgroups, ties, missing values, overflow, filtering and zoom reset', async () => {
  const values = Float32Array.from({ length: 513 }, (_, i) => [NaN, 0, 1, 0.5][i % 4]!);
  values[512] = 0.75;
  const buffers = parallel.createParallelWebgpuBuffers({
    axisOrder: ['a', 'b'], ids: Array.from(values, (_, i) => String(i)), valuesByAxis: { a: values, b: values },
  });
  const view = parallel.createParallelClientDataView({ buffers });
  const plot = parallel.createParallelWebgpuPlot(host(), { buffers, renderMode: 'direct', clientView: { view }, aggregationBackend: 'rust-wasm' });
  plots.push(plot); await plot.ready;
  const hit = async (value: number) => (await plot.commands.resolveInspectionAtPoint(query(value)))?.recordIndex ?? null;
  assert(await hit(0.5) === 3, 'equal distances must pick the lowest source index');
  assert(await hit(0.75) === 512, 'winner in the partial final workgroup');
  assert(await hit(parallel.PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y) === 0, 'missing values');
  plot.commands.setAxisViewports({ a: { min: 0.25, max: 0.75 }, b: { min: 0.25, max: 0.75 } });
  await plot.waitForGpuIdle();
  assert(await hit(parallel.PARALLEL_BELOW_VIEWPORT_ROUTE_NORMALIZED_Y) === 1, 'below-viewport records');
  assert(await hit(parallel.PARALLEL_ABOVE_VIEWPORT_ROUTE_NORMALIZED_Y) === 2, 'above-viewport records');
  assert(await hit(0.5) === 3, 'zoomed center');
  const overlapping = await Promise.all(Array.from({ length: 8 }, (_, i) => hit(i % 2 ? 0.5 : parallel.PARALLEL_ABOVE_VIEWPORT_ROUTE_NORMALIZED_Y)));
  assert(overlapping.every((value, i) => value === (i % 2 ? 3 : 2)), 'overlapping programmatic lookups must not share scratch storage');
  view.addFilter({ id: 'empty', predicate: { op: 'gt', field: 'a', value: 2 } });
  await until(() => !plot.getWebgpuDiagnostics().clientView?.pending);
  await plot.waitForGpuIdle();
  assert(await hit(0.5) === null, 'inactive rows cannot be inspected');
  view.replaceState({ ...view.exportState(), filters: [] });
  await until(() => !plot.getWebgpuDiagnostics().clientView?.pending);
  plot.commands.resetAxisViewports(); await plot.waitForGpuIdle();
  assert(await hit(0.5) === 3, 'reset restores the original hit');
  plot.commands.commitBrushIntervals({ a: { min: 0.4, max: 0.6 } });
  await until(() => plot.commands.getStateSnapshot().selectedSourceIndices.length === 128);
  await plot.waitForGpuIdle();
  assert(plot.commands.getStateSnapshot().selectedSourceIndices.length === 128, 'brush selection remains exact');
  plot.commands.clearBrushes(); await plot.waitForGpuIdle();
  await until(() => plot.commands.getStateSnapshot().selectedSourceIndices.length === 0);
  assert(plot.commands.getStateSnapshot().selectedSourceIndices.length === 0, 'brush reset');
  plot.dispose();
});

await run('slow hover updates during movement, latest pointer, Shift release, leave, zoom and disposal', async () => {
  const element = host();
  const buffers = parallel.createParallelWebgpuBuffers({
    axisOrder: ['a', 'b'], ids: ['low', 'middle', 'high'],
    valuesByAxis: { a: new Float32Array([0, 0.5, 1]), b: new Float32Array([0, 0.5, 1]) },
  });
  const plot = parallel.createParallelWebgpuPlot(element, { buffers });
  plots.push(plot); await plot.ready;
  let active = 0; let maximumActive = 0; let updates = 0;
  const resolve = plot.commands.resolveInspectionAtPoint.bind(plot.commands);
  plot.commands.resolveInspectionAtPoint = async (point) => {
    active += 1; maximumActive = Math.max(maximumActive, active);
    try { const result = await resolve(point); await sleep(65); return result; }
    finally { active -= 1; }
  };
  plot.use(parallel.createDefaultParallelBindings({ inputElement: element, coordinateTarget: element, keyboardTarget: window }));
  plot.on('inspectionchange', (event) => { if (event.inspection !== null) updates += 1; });
  const move = (normalizedValue: number, shiftKey = true) => {
    const bounds = element.getBoundingClientRect();
    const display = parallel.parallelRenderedNormalizedValueToDisplayValue(normalizedValue);
    element.dispatchEvent(new PointerEvent('pointermove', {
      clientX: bounds.left + 400, clientY: bounds.top + (1 - display) * 400,
      shiftKey, bubbles: true, pointerId: 1,
    }));
  };
  for (let i = 0; i < 40; i += 1) { move(i % 2 ? 0.5 : 1); await frame(); }
  assert(updates >= 3, `continuous movement starved hover (${updates} updates)`);
  assert(maximumActive === 1, `overlapping lookups: ${maximumActive}`);
  move(0.5); await sleep(220);
  assert(plot.commands.getStateSnapshot().inspection?.recordIndex === 1, 'final pointer must win');
  move(1); await frame();
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
  await sleep(100);
  assert(plot.commands.getStateSnapshot().inspection === null, 'Shift release must clear an in-flight hover');
  move(1); await frame(); element.dispatchEvent(new PointerEvent('pointerleave'));
  await sleep(100);
  assert(plot.commands.getStateSnapshot().inspection === null, 'pointer leave must clear an in-flight hover');
  move(1); await frame();
  plot.commands.setAxisViewports({ a: { min: 0.4, max: 0.6 } });
  await sleep(100);
  assert(plot.commands.getStateSnapshot().inspection === null, 'old viewport result must be ignored');
  move(0.5); await frame();
  const beforeDispose = updates; plot.dispose(); await sleep(100);
  assert(updates === beforeDispose, 'disposal must suppress late events');
});

const rows = Number(new URLSearchParams(location.search).get('rows') ?? 1_000_000);
await run(`${rows.toLocaleString()} rows: zoomed fallback performance, precision and mapped source IDs`, async () => {
  const values = Float32Array.from({ length: rows }, (_, i) => (i % 1024) / 1023);
  const buffers = parallel.createParallelWebgpuBuffers({
    axisOrder: ['a', 'b'], ids: Array.from({ length: rows }, (_, i) => String(i)), valuesByAxis: { a: values, b: values },
  });
  const plot = parallel.createParallelWebgpuPlot(host(), {
    buffers, directSegmentLimit: 1, binResolution: 32, aggregationBackend: 'rust-wasm',
  });
  plots.push(plot); await plot.ready;
  assert(plot.getWebgpuDiagnostics().aggregationBackend === (rows <= 2_000_000 ? 'rust-wasm' : 'typescript'), 'expected selection backend');
  plot.commands.setAxisViewports({ a: { min: 0.49, max: 0.51 }, b: { min: 0.49, max: 0.51 } });
  await until(() => plot.getWebgpuDiagnostics().densityVisible && plot.getWebgpuDiagnostics().refinedRecordCount > 0);
  await plot.waitForGpuIdle();
  const samples: number[] = [];
  for (let i = 0; i < 21; i += 1) {
    const started = performance.now();
    const hit = await plot.commands.resolveInspectionAtPoint(query(parallel.PARALLEL_ABOVE_VIEWPORT_ROUTE_NORMALIZED_Y, 28));
    if (i > 0) samples.push(performance.now() - started);
    assert(hit?.recordIndex === 522, `wrong fallback identity: ${hit?.recordIndex}`);
  }
  assert(plot.getWebgpuDiagnostics().lastHoverUsedFullPopulation, 'exercise fallback outside the refined sample');
  const center = await plot.commands.resolveInspectionAtPoint(query(0.51, 28));
  assert(center?.recordIndex !== undefined && (center.recordIndex % 1024) === 512, 'refined source mapping');
  const miss = await plot.commands.resolveInspectionAtPoint(query(0.5, 1));
  assert(miss === null, 'empty space outside the hit tolerance');
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)]!;
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
  document.querySelector('#timings')!.textContent = JSON.stringify({ rows, medianMs: median, p95Ms: p95, samples, diagnostics: plot.getWebgpuDiagnostics() }, null, 2);
  assert(p95 < 50, `zoomed hover p95 ${p95.toFixed(1)} ms exceeds 50 ms budget`);
  plot.use(parallel.createDefaultParallelBindings({ inspection: { explicitHoverModeActive: () => true } }));
});
await run('no browser or GPU errors', async () => { await frame(); assert(errors.length === 0, errors.join('\n')); });
status.textContent = results.querySelector('.fail') === null ? 'PASS: all parallel hover checks' : 'FAIL: see results';
