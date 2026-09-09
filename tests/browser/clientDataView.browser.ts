import { createClientDataView, createClientDataViewWorkerEvaluator } from '../../packages/m-charts/src/client-data-view/index.js';
import * as scatter from '../../packages/m-charts/src/m-scatter-webgpu/index.js';
import * as parallel from '../../packages/m-charts/src/m-parallel-webgpu/index.js';
import * as histogram from '../../packages/m-charts/src/m-histogram-webgpu/index.js';

const results = document.querySelector('#results')!;
const status = document.querySelector('#status')!;
const errors: string[] = [];
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const equal = (a: unknown, b: unknown, message: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const plots: { dispose(): void }[] = [];
window.addEventListener('pagehide', () => plots.forEach((plot) => plot.dispose()));
function host(label: string) {
  const section = document.createElement('section'); const title = document.createElement('h2'); title.textContent = label;
  const element = document.createElement('div'); element.className = 'host';
  section.append(title, element); document.querySelector('#charts')!.append(section); return element;
}
async function run(name: string, action: () => Promise<void>) {
  const item = document.createElement('li'); item.textContent = `Running: ${name}`; results.append(item);
  try { await action(); item.textContent = `PASS: ${name}`; item.className = 'pass'; }
  catch (error) { item.textContent = `FAIL: ${name}: ${String(error)}`; item.className = 'fail'; }
}
async function settled(plot: { getWebgpuDiagnostics(): unknown }) {
  const start = performance.now();
  for (;;) {
    const d = plot.getWebgpuDiagnostics() as { initialized?: boolean; cacheReady?: boolean; clientView?: { pending?: boolean } };
    if (d.initialized !== false && d.cacheReady !== false && !d.clientView?.pending) break;
    if (performance.now() - start > 15000) throw new Error('GPU projection did not settle');
    await frame();
  }
  await frame(); await frame();
}
const rowCount = Number(new URLSearchParams(location.search).get('rows') ?? 100000);
await run('scatter indexed style, transforms, mapped-field guard, reset and overrides', async () => {
  const columns = { ids: Array.from({ length: 100 }, (_, i) => String(i)), x: Float64Array.from({ length: 100 }, (_, i) => i), y: { v: new Float64Array(100).fill(1) } };
  const spec = { xLabel: 'X', plots: [{ id: 'v', yKey: 'v', label: 'V' }] };
  const viewport = { x: { min: -1, max: 101 }, yByPlot: { v: { min: 0, max: 2 } } };
  const baseline = scatter.createScatterPlot(host('Indexed scatter — original'), { columns, mode: 'select', axisMode: 'xy', indexedStyle: true, spec, viewport }); plots.push(baseline);
  const view = scatter.createFastScatterClientDataView({ columns });
  const plot = scatter.createScatterPlot(host('Indexed scatter — empty client view (should match original)'), { columns, mode: 'select', axisMode: 'xy', indexedStyle: true, spec, viewport, clientView: { view } }); plots.push(plot);
  await Promise.all([baseline.ready, plot.ready]); await settled(plot);
  const buttons = document.createElement('div'); document.querySelector('#charts')!.append(buttons);
  for (const [label, action] of [
    ['Scatter: unmatched rule', () => view.replaceState({ ...view.exportState(), styles: [{ id: 'unmatched', when: { op: 'lt', field: 'v', value: -99 }, channels: { color: { op: 'constant', value: '#ff0000' } } }] })],
    ['Scatter: color only', () => view.replaceState({ ...view.exportState(), styles: [{ id: 'red', channels: { color: { op: 'constant', value: '#ff0000' } } }] })],
    ['Scatter: reset', () => view.replaceState({ ...view.exportState(), styles: [] })],
  ] as const) { const button = document.createElement('button'); button.textContent = label; button.onclick = action; buttons.append(button); }
  view.addTransformation({ id: 'double', op: 'calculate', output: 'v', expression: { op: 'multiply', left: { op: 'field', field: 'v' }, right: { op: 'literal', value: 2 } } });
  await settled(plot);
  view.replaceState({ ...view.exportState(), transformations: [] }); await settled(plot);
  const mappedView = scatter.createFastScatterClientDataView({ columns, state: { transformations: [{ id: 'mapped', op: 'affine', input: 'v', output: 'derived', factor: 1, offset: 0 }] } });
  const mappedPlot = scatter.createScatterPlot(host('Mapped-field validation'), { columns, mode: 'select', axisMode: 'xy', spec, viewport, clientView: { view: mappedView, yFieldByKey: { v: 'derived' } } }); plots.push(mappedPlot); await mappedPlot.ready;
  let rejected = false; try { mappedView.removeTransformation('mapped'); } catch { rejected = true; }
  assert(rejected, 'removing a bound transform must throw before commit'); equal(mappedView.getState().revision, 0, 'controller revision');
  equal(mappedPlot.getWebgpuDiagnostics().clientView?.revision, 0, 'plot revision');
});
await run('parallel mask-only uploads, exact WASM selection, metadata updates and empty/reset views', async () => {
  const buffers = parallel.createParallelWebgpuBuffers({ ids: Array.from({ length: rowCount }, (_, i) => String(i)), axisOrder: ['v', 'w'], valuesByAxis: { v: Float64Array.from({ length: rowCount }, (_, i) => i), w: Float64Array.from({ length: rowCount }, (_, i) => i % 11) } });
  const view = parallel.createParallelClientDataView({ buffers });
  const plot = parallel.createParallelWebgpuPlot(host(`Parallel (${rowCount.toLocaleString()} rows)`), { buffers, renderMode: 'density', clientView: { view } }); plots.push(plot); await plot.ready;
  view.addFilter({ id: 'half', predicate: { op: 'gte', field: 'v', value: rowCount / 2 } }); await settled(plot);
  const diagnostics = plot.getWebgpuDiagnostics();
  equal(diagnostics.clientView?.viewUploadBytes, Math.ceil(rowCount / 32) * 4, 'filter upload must contain only visibility');
  plot.commands.commitBrushIntervals({ v: { min: rowCount - 2, max: rowCount } });
  for (let i = 0; i < 120 && plot.commands.getStateSnapshot().selectedSourceIndices.length !== 2; i++) await frame();
  equal(Array.from(plot.commands.getStateSnapshot().selectedSourceIndices), [rowCount - 2, rowCount - 1], 'selection retains original row identities');
  view.updateFields({ membership: { kind: 'boolean', values: new Uint8Array(rowCount) } });
  view.addFilter({ id: 'empty', predicate: { op: 'eq', field: 'membership', value: true } }); await settled(plot);
  equal(plot.getWebgpuDiagnostics().clientView?.activeRowCount, 0, 'empty view');
  view.replaceState({ ...view.exportState(), filters: [] }); await settled(plot);
  equal(plot.getWebgpuDiagnostics().clientView?.activeRowCount, rowCount, 'reset');
});
for (const backend of ['typescript', 'rust-wasm'] as const) await run(`histogram ${backend}: semantic categories/time, styles, selection and mutable spec`, async () => {
  const columns: histogram.HistogramColumns = { ids: ['a', 'b', 'c'], parameters: [
    { key: 'v', label: 'Value', kind: 'numeric' },
    { key: 'time', label: 'Time', kind: 'datetime-ns', datetimeOriginNs: '1700000000000000000', epochNsValues: ['1700000000000000000', '1700000000000000001', '1700000000000000002'] },
    { key: 'cat', label: 'Category', kind: 'categorical', categories: [{ value: 'A', label: 'A', encoded: 0 }, { value: 'B', label: 'B', encoded: 1 }] },
  ], valuesByParameter: { time: new Float64Array([0, 0.000001, 0.000002]), v: new Float64Array([1, 2, 3]), cat: new Uint8Array([0, 1, 0]) } };
  const spec: histogram.HistogramPlotSpec = { mode: 'histogram', parameters: columns.parameters!, subplots: [{ id: 'v', label: 'Value', parameterKey: 'v' }] };
  const view = histogram.createHistogramClientDataView({ columns });
  const plot = histogram.createHistogramPlot(host(`Histogram ${backend}`), { columns, spec, aggregationBackend: backend, clientView: { view } }); plots.push(plot); await plot.ready;
  const stacks = () => plot.commands.getStateSnapshot().aggregation.subplots.flatMap((p) => p.bins).flatMap((b) => b.stack).map((s) => s.color);
  const originalColors = stacks();
  const originalViewport = plot.commands.getStateSnapshot().viewport;
  plot.commands.selectBins({ subplotId: 'v', binIndices: [0] });
  const selected = Array.from(plot.commands.getStateSnapshot().selectedSourceIndices);
  view.addStyle({ id: 'no-match', when: { op: 'lt', field: 'v', value: -99 }, channels: { color: { op: 'constant', value: '#ff0000' } } });
  equal(stacks(), originalColors, 'unmatched rule preserves unstyled bars');
  equal(Array.from(plot.commands.getStateSnapshot().selectedSourceIndices), selected, 'style-only edits preserve selection');
  view.addFilter({ id: 'time', predicate: { op: 'gte', field: 'time', value: '1700000000000000001' } });
  equal(plot.getWebgpuDiagnostics().clientView?.activeRowCount, 2, 'exact nanosecond filter');
  view.removeFilter('time');
  view.addFilter({ id: 'A', predicate: { op: 'eq', field: 'cat', value: 'A' } });
  equal(plot.getWebgpuDiagnostics().clientView?.activeRowCount, 2, 'semantic category filter');
  view.addTransformation({ id: 'multiply', op: 'calculate', output: 'v', expression: { op: 'multiply', left: { op: 'field', field: 'v' }, right: { op: 'literal', value: 10 } } });
  plot.update({ spec: { ...spec, subplots: [...spec.subplots].reverse().map((p) => ({ ...p, id: 'updated', label: 'Updated label' })) } });
  equal(plot.commands.getStateSnapshot().aggregation.subplots[0]?.subplotId, 'updated', 'spec update');
  view.replaceState({ ...view.exportState(), filters: [], transformations: [], styles: [] }); await settled(plot);
  plot.update({ spec, viewport: originalViewport });
  equal(stacks(), originalColors, 'histogram reset');
});
await run('worker evaluation: responsive million-row updates and stale-result protection', async () => {
  const count = Math.max(rowCount, 1000000);
  const evaluator = createClientDataViewWorkerEvaluator(new Worker(new URL('../../packages/m-charts/src/client-data-view/core/worker.ts', import.meta.url), { type: 'module' }));
  const view = createClientDataView({ dataset: { rowCount: count, fields: { v: { kind: 'numeric', values: Float64Array.from({ length: count }, (_, i) => i) } } }, asyncEvaluator: evaluator });
  try {
    let ticks = 0; const heartbeat = setInterval(() => ticks++, 0);
    try {
      await view.batchAsync(() => {
        view.addTransformation({ id: 'sqrt', op: 'calculate', output: 'sqrt', expression: { op: 'sqrt', input: { op: 'field', field: 'v' } } });
        view.addFilter({ id: 'half', stage: 'transformed', predicate: { op: 'gte', field: 'sqrt', value: Math.sqrt(count / 2) } });
      });
    } finally { clearInterval(heartbeat); }
    assert(ticks > 0, 'main thread must remain responsive while worker evaluates');
    equal(view.evaluate().metrics.activeRowCount, count / 2, 'worker result');
    const pending = view.replaceStateAsync({ ...view.exportState(), filters: [] });
    view.addFilter({ id: 'last', predicate: { op: 'eq', field: 'v', value: count - 1 } });
    equal(await pending, false, 'stale result rejected'); equal(view.evaluate().metrics.activeRowCount, 1, 'newer edit retained');
  } finally { view.dispose(); }
});
await run('scatter theme/filter/style/reset retain GPU source resources', async () => {
  const columns = { ids: ['a', 'b', 'c'], x: new Float64Array([0, 1, 2]), y: { v: new Float64Array([1, 2, 3]) } };
  const view = scatter.createFastScatterClientDataView({ columns });
  const binding = { view };
  const theme: scatter.FastScatterTheme = { backgroundColor: [1, 1, 1, 1], subplotBackgroundColor: [1, 1, 1, 1], defaultPointColor: [0, 0, 255, 255], selectedOverlayColor: [1, 0, 0, 1], alphaScaleMultiplier: 1 };
  const plot = scatter.createScatterPlot(host('Resident scatter — green after theme update'), { columns, theme, mode: 'select', axisMode: 'xy', spec: { xLabel: 'X', plots: [{ id: 'v', label: 'V', yKey: 'v' }] }, viewport: { x: { min: -1, max: 3 }, yByPlot: { v: { min: 0, max: 4 } } }, clientView: binding });
  plots.push(plot); await plot.ready; await settled(plot);
  const initial = plot.getWebgpuDiagnostics().clientView!;
  assert(initial.totalSourceUploadBytes > 0, 'source uploads must be measured');
  for (const defaultPointColor of [[0, 255, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255]] as const) {
    plot.update({ theme: { ...theme, defaultPointColor } }); await settled(plot);
    const next = plot.getWebgpuDiagnostics().clientView!;
    equal(next.sourceBufferBuildCount, initial.sourceBufferBuildCount, 'theme must not rebuild GPU sources');
    equal(next.totalSourceUploadBytes, initial.totalSourceUploadBytes, 'theme must not re-upload sources');
  }
  view.addFilter({ id: 'half', predicate: { op: 'gte', field: 'v', value: 2 } }); await settled(plot);
  equal(scatter.evaluateFastScatterClientView(binding, columns).interactionColumns.y.v === columns.y.v, true, 'no coordinate copy for interactions');
  view.addStyle({ id: 'size', channels: { size: { op: 'constant', value: 12 }, shape: { op: 'constant', value: 2 }, rotation: { op: 'constant', value: 0.5 } } }); await settled(plot);
  view.replaceState({ ...view.exportState(), filters: [], styles: [], transformations: [] }); await settled(plot);
  equal(plot.getWebgpuDiagnostics().clientView!.totalSourceUploadBytes, initial.totalSourceUploadBytes, 'reset must retain source buffers');
});
for (const mode of ['direct', 'density', 'auto'] as const) await run(`parallel ${mode}: visibility, style, transform, selection and reset`, async () => {
  const count = 4097;
  const buffers = parallel.createParallelWebgpuBuffers({ ids: Array.from({ length: count }, (_, i) => String(i)), axisOrder: ['a', 'b'], valuesByAxis: { a: Float32Array.from({ length: count }, (_, i) => i / (count - 1)), b: Float32Array.from({ length: count }, (_, i) => i / (count - 1)) } });
  const view = parallel.createParallelClientDataView({ buffers });
  const plot = parallel.createParallelWebgpuPlot(host(`Parallel ${mode}`), { buffers, renderMode: mode, directSegmentLimit: 1, representativeRecordLimit: 128, binResolution: 32, clientView: { view } });
  plots.push(plot); await plot.ready; await settled(plot);
  const initial = plot.getWebgpuDiagnostics().clientView!;
  view.addFilter({ id: 'sparse', predicate: { op: 'gte', field: 'a', value: 0.999 } });
  view.addTransformation({ id: 'scale', op: 'affine', input: 'b', output: 'b', factor: 0.5, offset: 0 });
  view.addStyle({ id: 'red', channels: { color: { op: 'constant', value: '#ff0000' }, opacity: { op: 'constant', value: 0.5 } } });
  await settled(plot);
  plot.commands.commitBrushIntervals({ a: { min: 0, max: 1 } });
  for (let i = 0; i < 120 && plot.commands.getStateSnapshot().selectedSourceIndices.length !== 5; i++) await frame();
  equal(Array.from(plot.commands.getStateSnapshot().selectedSourceIndices), [4092, 4093, 4094, 4095, 4096], 'exact selection after projection');
  view.addFilter({ id: 'empty', predicate: { op: 'lt', field: 'a', value: 0 } }); await settled(plot);
  equal(plot.getWebgpuDiagnostics().clientView!.activeRowCount, 0, 'empty view');
  view.replaceState({ ...view.exportState(), filters: [], styles: [], transformations: [] }); await settled(plot);
  equal(plot.getWebgpuDiagnostics().clientView!.activeRowCount, count, 'reset visibility');
  equal(plot.getWebgpuDiagnostics().clientView!.totalSourceUploadBytes, initial.totalSourceUploadBytes, 'parallel source uploads');
  equal(plot.getWebgpuDiagnostics().clientView!.sourceBufferBuildCount, initial.sourceBufferBuildCount, 'parallel GPU resource lifetime');
});
await run('no browser or GPU lifecycle errors', async () => { await frame(); equal(errors, [], 'browser errors'); });
status.textContent = results.querySelector('.fail') ? 'FAILED' : 'ALL PASSED';
