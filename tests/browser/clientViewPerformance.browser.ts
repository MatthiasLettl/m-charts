import { createClientDataViewWorkerEvaluator, type ClientDataView, type ClientDataViewState } from '../../packages/m-charts/src/client-data-view/index.js';
import * as scatter from '../../packages/m-charts/src/m-scatter-webgpu/index.js';
import * as parallel from '../../packages/m-charts/src/m-parallel-webgpu/index.js';
import * as histogram from '../../packages/m-charts/src/m-histogram-webgpu/index.js';

const query = new URLSearchParams(location.search);
const rows = Number(query.get('rows') ?? 1000000);
const samples = Number(query.get('samples') ?? 3);
// Explicit, conservative smoke budgets. Deployments should supply their own latency SLO.
const budgetMs = Number(query.get('budgetMs') ?? (rows <= 1000000 ? 1000 : rows <= 10000000 ? 5000 : 10000));
const status = document.querySelector('#status')!;
const results = document.querySelector('#results')!;
const failures: string[] = [];
const measurements: object[] = [];
window.addEventListener('error', (event) => failures.push(event.message));
window.addEventListener('unhandledrejection', (event) => failures.push(String(event.reason)));
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const worker = () => createClientDataViewWorkerEvaluator(new Worker(new URL('../../packages/m-charts/src/client-data-view/core/worker.ts', import.meta.url), { type: 'module' }));
type Diagnostics = { uploadBytes?: number; initialized?: boolean; cacheReady?: boolean; clientView?: { revision?: number; pending?: boolean; viewUploadBytes?: number; totalSourceUploadBytes?: number; sourceBufferBuildCount?: number }; aggregation?: { setupBytes: number } };
type Plot = { dispose(): void; getWebgpuDiagnostics(): Diagnostics; ready: Promise<void>; waitForGpuIdle(): Promise<void> };
async function settle(plot: Plot) {
  const start = performance.now();
  for (;;) {
    const d = plot.getWebgpuDiagnostics();
    if (d.initialized !== false && d.cacheReady !== false && !d.clientView?.pending) break;
    if (performance.now() - start > 60000) throw new Error('GPU update timed out');
    await frame();
  }
  await frame(); await plot.waitForGpuIdle(); await frame();
}
async function measure(name: string, view: ClientDataView, plot: Plot, coordinateArrays: () => readonly ArrayBufferView[]) {
  await plot.ready; await settle(plot);
  const baseline = plot.getWebgpuDiagnostics().clientView;
  const empty = view.exportState();
  const operations: Record<string, Partial<ClientDataViewState>> = {
    filter: { filters: [{ id: 'half', predicate: { op: 'gte', field: 'v', value: 0.5 } }] },
    style: { styles: [{ id: 'color', channels: { color: { op: 'constant', value: '#d52f42' } } }] },
    transform: { transformations: [{ id: 'scale', op: 'affine', input: 'v', output: 'v', factor: 0.8, offset: 0.1 }] },
  };
  for (const [operation, state] of Object.entries(operations)) {
    const elapsed: number[] = [];
    const evaluation: number[] = [];
    let coordinateAllocationBytes = 0;
    let viewUploadBytes = 0;
    let wasmSetupBytes = 0;
    let longestFrameGapMs = 0;
    for (let sample = 0; sample < samples; sample++) {
      await view.replaceStateAsync(empty); await settle(plot);
      const previous = new Set(coordinateArrays().map((array) => array.buffer));
      let monitoring = true; let lastFrame = performance.now();
      const monitor = () => { const now = performance.now(); longestFrameGapMs = Math.max(longestFrameGapMs, now - lastFrame); lastFrame = now; if (monitoring) requestAnimationFrame(monitor); };
      requestAnimationFrame(monitor);
      const start = performance.now();
      try {
        await view.replaceStateAsync({ ...empty, ...state }); await settle(plot);
        elapsed.push(performance.now() - start);
      } finally { monitoring = false; }
      evaluation.push(view.evaluate().metrics.durationMs);
      const allocated = new Set<ArrayBufferLike>();
      coordinateAllocationBytes = 0;
      for (const array of coordinateArrays()) if (!previous.has(array.buffer) && !allocated.has(array.buffer)) {
        coordinateAllocationBytes += array.buffer.byteLength; allocated.add(array.buffer);
      }
      const d = plot.getWebgpuDiagnostics();
      viewUploadBytes = d.clientView?.viewUploadBytes ?? d.uploadBytes ?? 0;
      wasmSetupBytes = d.aggregation?.setupBytes ?? 0;
      assert(d.clientView?.sourceBufferBuildCount === baseline?.sourceBufferBuildCount, `${name}/${operation}: source GPU resources rebuilt`);
      assert(d.clientView?.totalSourceUploadBytes === baseline?.totalSourceUploadBytes, `${name}/${operation}: source GPU data re-uploaded`);
      if (operation !== 'transform') assert(coordinateAllocationBytes === 0, `${name}/${operation}: copied coordinate arrays`);
      if (operation === 'filter' && name === 'histogram') assert(wasmSetupBytes === Math.ceil(rows / 32) * 4, 'Histogram must copy only visibility to WASM');
      if (operation === 'filter' && name === 'parallel') assert(viewUploadBytes === Math.ceil(rows / 32) * 4, 'Parallel density filtering must upload only visibility');
    }
    elapsed.sort((a, b) => a - b);
    const p95Ms = elapsed[Math.ceil(elapsed.length * 0.95) - 1]!;
    measurements.push({ chart: name, operation, rows, samples, p95Ms: +p95Ms.toFixed(1), evaluationMs: +Math.max(...evaluation).toFixed(1), longestFrameGapMs: +longestFrameGapMs.toFixed(1), coordinateAllocationBytes, viewUploadBytes, wasmSetupBytes, budgetMs });
    results.textContent = JSON.stringify({ measurements, failures }, null, 2);
    assert(p95Ms <= budgetMs, `${name}/${operation}: ${p95Ms.toFixed(1)} ms exceeds ${budgetMs} ms budget`);
  }
}
try {
  assert([1000000, 10000000, 25000000].includes(rows), 'rows must be 1000000, 10000000, or 25000000');
  assert(Number.isSafeInteger(samples) && samples > 0 && samples <= 20, 'samples must be 1–20');
  assert(Number.isFinite(budgetMs) && budgetMs > 0, 'budgetMs must be positive');
  for (const name of ['scatter', 'histogram', 'parallel']) {
    status.textContent = `Running ${name} at ${rows.toLocaleString()} rows…`;
    const host = document.createElement('div'); host.className = 'host'; document.querySelector('#charts')!.replaceChildren(host);
    // Labels are shared deliberately; stable row indices are the benchmark identities.
    const ids = new Array<string>(rows).fill('row');
    const x = Float32Array.from({ length: rows }, (_, i) => i / rows);
    const v = Float32Array.from({ length: rows }, (_, i) => (i % 1000) / 1000);
    let view: ClientDataView | undefined; let plot: Plot | undefined;
    try {
      if (name === 'scatter') {
        const columns = { ids, x, y: { v } };
        view = scatter.createFastScatterClientDataView({ columns, asyncEvaluator: worker() });
        const binding = { view };
        plot = scatter.createScatterPlot(host, { columns, clientView: binding, mode: 'select', axisMode: 'xy', spec: { xLabel: 'X', plots: [{ id: 'v', yKey: 'v', label: 'V' }] }, viewport: { x: { min: 0, max: 1 }, yByPlot: { v: { min: 0, max: 1 } } } });
        await measure(name, view, plot, () => { const c = scatter.evaluateFastScatterClientView(binding, columns).interactionColumns; return [c.x, c.y.v!] as ArrayBufferView[]; });
      } else if (name === 'histogram') {
        const columns: histogram.HistogramColumns = { ids, valuesByParameter: { v }, parameters: [{ key: 'v', label: 'V', kind: 'numeric', domain: { min: 0, max: 1 } }] };
        view = histogram.createHistogramClientDataView({ columns, asyncEvaluator: worker() });
        const binding = { view };
        plot = histogram.createHistogramPlot(host, { columns, clientView: binding, aggregationBackend: 'rust-wasm', spec: { mode: 'histogram', parameters: columns.parameters!, subplots: [{ id: 'v', label: 'V', parameterKey: 'v' }] } });
        await measure(name, view, plot, () => [histogram.evaluateHistogramClientView(binding, columns).columns.valuesByParameter.v as ArrayBufferView]);
      } else {
        const buffers = parallel.createParallelWebgpuBuffers({ ids, axisOrder: ['x', 'v'], valuesByAxis: { x, v } });
        view = parallel.createParallelClientDataView({ buffers, asyncEvaluator: worker() });
        const binding = { view };
        plot = parallel.createParallelWebgpuPlot(host, { buffers, clientView: binding, renderMode: 'density', binResolution: 32 });
        await measure(name, view, plot, () => Object.values(parallel.evaluateParallelClientView(binding, buffers).buffers.rawValuesByAxis) as ArrayBufferView[]);
      }
    } finally { plot?.dispose(); view?.dispose(); }
    await frame();
  }
} catch (error) { failures.push(String(error)); }
results.textContent = JSON.stringify({ measurements, failures }, null, 2);
status.textContent = failures.length ? 'FAILED' : 'ALL PASSED';
