import assert from 'node:assert/strict';
import {
  createParallelWebgpuBuffers, createParallelClientDataView, evaluateParallelClientView,
  createParallelClientDataSet, selectParallelRecordIdsByBrushes,
} from '../../packages/m-charts/src/m-parallel/index.ts';
import { ParallelWebgpuWasmSelectionSession } from '../../packages/m-charts/src/m-parallel-webgpu/core/wasmSelection.ts';
import { selectParallelRecordsFromCandidateMask } from '../../packages/m-charts/src/m-parallel-webgpu/core/selectionCandidates.ts';
import { createParallelRepresentativeSourceIndices } from '../../packages/m-charts/src/m-parallel-webgpu/core/representativeSampling.ts';
import {
  createHistogramClientDataView, evaluateHistogramClientView, buildHistogramAggregation,
  type HistogramColumns, type HistogramPlotSpec,
} from '../../packages/m-charts/src/m-histogram/index.ts';
import { HistogramWebgpuAggregationProvider } from '../../packages/m-charts/src/m-histogram-webgpu/index.ts';

const source = createParallelWebgpuBuffers({
  axisOrder: ['a', 'b', 'category', 'accepted', 'time'],
  axes: [{ key: 'a', kind: 'numeric' }, { key: 'b', kind: 'numeric' },
    { key: 'category', kind: 'categorical' }, { key: 'accepted', kind: 'boolean' }, { key: 'time', kind: 'datetime-ns' }],
  ids: ['first', 'second', 'third', 'fourth'],
  valuesByAxis: { a: new Float64Array([0, 1, 2, 3]), b: new Float64Array([10, 20, 40, 80]),
    category: ['A', 'B', 'A', 'C'], accepted: [true, false, true, false],
    time: [1700000000000000000n, 1700000000000000001n, 1700000000000000002n, 1700000000000000003n] },
  color: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]), colorFormat: 'rgba8',
});
const binding = { view: createParallelClientDataView({ buffers: source }) };
const baseline = evaluateParallelClientView(binding, source);
assert.equal(baseline.buffers.rawValuesByAxis.a, source.rawValuesByAxis.a);
assert.equal(baseline.buffers.ids, source.ids);
assert.equal(baseline.buffers.styleBuffers, source.styleBuffers);
assert.deepEqual(Array.from(baseline.buffers.rawValuesByAxis.time!), Array.from(source.rawValuesByAxis.time!));
assert.deepEqual(Array.from(createParallelClientDataSet({ buffers: source }).fields.category!.values), ['A', 'B', 'A', 'C']);
binding.view.addFilter({ id: 'category', predicate: { op: 'eq', field: 'category', value: 'A' } });
binding.view.addTransformation({ id: 'negative', op: 'affine', input: 'b', output: 'b', factor: -2, offset: 5 });
let projected = evaluateParallelClientView(binding, source);
assert.deepEqual(Array.from(projected.activeSourceIndices), [0, 2]);
assert.deepEqual(Array.from(projected.buffers.rawValuesByAxis.b!), [-15, NaN, -75, NaN]);
for (const brushes of [{}, { b: { min: -80, max: -10 } }, { a: { min: 1, max: 3 } }]) {
  const cpu = selectParallelRecordIdsByBrushes(projected.buffers, brushes);
  const wasm = ParallelWebgpuWasmSelectionSession.create(projected.buffers)!;
  assert.ok(wasm);
  assert.deepEqual(wasm.select(brushes).sourceIndices, cpu.sourceIndices);
  assert.deepEqual(selectParallelRecordsFromCandidateMask(projected.buffers, brushes, new Uint32Array([15])).sourceIndices, cpu.sourceIndices);
}
assert.deepEqual(Array.from(await createParallelRepresentativeSourceIndices(projected.buffers, 100)), [0, 2]);
const coordinates = projected.buffers.rawValuesByAxis;
binding.view.addStyle({ id: 'style', channels: { color: { op: 'constant', value: '#123456' }, opacity: { op: 'constant', value: 0.5 } } });
projected = evaluateParallelClientView(binding, source);
assert.equal(projected.buffers.rawValuesByAxis, coordinates, 'style changes reuse projected coordinates');
assert.deepEqual(Array.from(projected.buffers.styleBuffers!.color).slice(0, 4), [18, 52, 86, 128]);
binding.view.replaceState({ ...binding.view.exportState(), filters: [], transformations: [], styles: [], sourceStyleMode: 'ignore' });
assert.equal(evaluateParallelClientView(binding, source).buffers.styleBuffers, undefined);
binding.view.addFilter({ id: 'none', predicate: { op: 'lt', field: 'a', value: -100 } });
projected = evaluateParallelClientView(binding, source);
assert.deepEqual(Array.from(selectParallelRecordIdsByBrushes(projected.buffers, {}).sourceIndices), []);
assert.deepEqual(Array.from(await createParallelRepresentativeSourceIndices(projected.buffers, 100)), []);
assert.equal(source.rawValuesByAxis.b![2], 40);

const columns: HistogramColumns = {
  ids: ['a', 'b', 'c', 'd'], sourceIndex: new Uint32Array([10, 20, 30, 40]),
  parameters: [{ key: 'value', label: 'Value', kind: 'numeric', domain: { min: 0, max: 10 } }, { key: 'cat', label: 'Category', kind: 'categorical', domain: { min: 0, max: 1 }, categories: [{ encoded: 0, label: 'A', value: 'A' }, { encoded: 1, label: 'B', value: 'B' }] }],
  valuesByParameter: { value: new Float64Array([1, 2, 3, 4]), cat: new Uint8Array([0, 1, 0, 1]) },
  color: new Uint32Array([0xff0000ff, 0x00ff00ff, 0x0000ffff, 0xffff00ff]), colorFormat: 'rgba32',
};
const histogram = { view: createHistogramClientDataView({ columns }) };
const spec: HistogramPlotSpec = { mode: 'histogram', parameters: columns.parameters!, subplots: [{ id: 'value', label: 'Value', parameterKey: 'value' }, { id: 'cat', label: 'Category', parameterKey: 'cat' }] };
assert.equal(evaluateHistogramClientView(histogram, columns).columns.color, columns.color);
histogram.view.addFilter({ id: 'keep', predicate: { op: 'in', field: 'value', values: [1, 3] } });
histogram.view.addTransformation({ id: 'scale', op: 'affine', input: 'value', output: 'value', factor: 2, offset: 1 });
histogram.view.addStyle({ id: 'style', channels: { color: { op: 'constant', value: '#123456' }, opacity: { op: 'constant', value: 0.5 } } });
let h = evaluateHistogramClientView(histogram, columns);
assert.equal(h.columns.ids, columns.ids);
assert.equal(h.columns.sourceIndex, columns.sourceIndex);
assert.deepEqual(Array.from(h.columns.valuesByParameter.value!), [3, NaN, 7, NaN]);
assert.equal(h.columns.valuesByParameter.cat, columns.valuesByParameter.cat, 'filters retain categorical coordinates');
assert.deepEqual(Array.from(h.columns.activeMask!), [5]);
const comparable = (input: ReturnType<typeof buildHistogramAggregation>) => input.subplots.map((subplot) => ({
  counts: subplot.bins.map((bin) => bin.totalCount), stacks: subplot.bins.map((bin) => bin.stack), indices: Array.from(subplot.sourceIndices ?? []),
}));
for (const backend of ['typescript', 'rust-wasm'] as const) {
  const provider = new HistogramWebgpuAggregationProvider(backend);
  provider.prepare(h.columns, spec);
  const aggregation = provider.build(h.columns, { plotSpec: spec, includeMembership: true });
  assert.equal(provider.getDiagnostics().backend, backend);
  assert.deepEqual(comparable(aggregation), comparable(buildHistogramAggregation(h.columns, { plotSpec: spec, includeMembership: true })));
  for (const subplot of aggregation.subplots) {
    assert.equal(subplot.bins.reduce((sum, bin) => sum + bin.totalCount, 0), 2);
    assert.deepEqual(Array.from(subplot.sourceIndices!).sort(), [10, 30]);
    assert.ok(subplot.bins.flatMap((b) => b.stack).every((stack) => stack.color === 0x12345680));
  }
}
const previousValues = h.columns.valuesByParameter;
histogram.view.replaceState({ ...histogram.view.exportState(), sourceStyleMode: 'ignore', styles: [] });
h = evaluateHistogramClientView(histogram, columns);
assert.equal(h.columns.valuesByParameter, previousValues);
assert.deepEqual(Array.from(h.columns.color!), new Array(4).fill(0x1f6badeb), 'data-only styling uses the chart theme rather than the legacy uncolored white stack');
histogram.view.addFilter({ id: 'empty', predicate: { op: 'lt', field: 'value', value: 0 } });
h = evaluateHistogramClientView(histogram, columns);
assert.equal(buildHistogramAggregation(h.columns, { plotSpec: spec }).metrics.totalCount, 0);
assert.equal(columns.valuesByParameter.value![2], 3);
assert.throws(() => evaluateHistogramClientView(histogram, { ...columns, ids: [] }), /row count/);
assert.throws(() => evaluateParallelClientView(binding, { ...source, recordCount: 0 }), /row count/);
console.log('Parallel and histogram client-view projection, selection and WASM aggregation tests passed.');

const constantView = { view: createParallelClientDataView({ buffers: source }) };
constantView.view.addTransformation({ id: 'constant', op: 'affine', input: 'b', output: 'b', factor: 0, offset: 7 });
assert.deepEqual(evaluateParallelClientView(constantView, source).buffers.domainsByAxis.b, { min: 7, max: 7, span: 0 });

const differenceView = { view: createParallelClientDataView({ buffers: source }) };
differenceView.view.addFilter({ id: 'accepted', predicate: { op: 'eq', field: 'accepted', value: true } });
differenceView.view.addTransformation({ id: 'difference', op: 'difference', input: 'b', output: 'b', direction: 'forward', partitionBy: ['category'], missingValue: 'zero' });
assert.deepEqual(Array.from(evaluateParallelClientView(differenceView, source).buffers.rawValuesByAxis.b!), [30, NaN, 0, NaN]);
differenceView.view.addTransformation({ id: 'time-difference', op: 'difference', input: 'time', output: 'time', direction: 'forward', missingValue: 'zero' });
assert.deepEqual(Array.from(evaluateParallelClientView(differenceView, source).buffers.rawValuesByAxis.time!), [2, NaN, 0, NaN], 'nanosecond differences remain exact numeric results');

const packedArrayColumns = { ...columns, color: Array.from(columns.color!), colorFormat: 'rgba32' as const };
const opacityView = { view: createHistogramClientDataView({ columns: packedArrayColumns }) };
opacityView.view.addStyle({ id: 'alpha', channels: { opacity: { op: 'constant', value: 0.5 } } });
assert.deepEqual(Array.from(evaluateHistogramClientView(opacityView, packedArrayColumns).columns.color!), [0xff000080, 0x00ff0080, 0x0000ff80, 0xffff0080]);

const unstyledColumns = { ...columns, color: undefined };
const conditionalView = { view: createHistogramClientDataView({ columns: unstyledColumns }) };
conditionalView.view.addStyle({ id: 'conditional', when: { op: 'eq', field: 'value', value: 1 }, channels: { color: { op: 'constant', value: '#ff0000' } } });
assert.deepEqual(Array.from(evaluateHistogramClientView(conditionalView, unstyledColumns, [1, 2, 3, 255]).columns.color!), [0xff0000ff, 0xffffffff, 0xffffffff, 0xffffffff]);
assert.deepEqual(Array.from(evaluateHistogramClientView(conditionalView, unstyledColumns, [4, 5, 6, 255]).columns.color!), [0xff0000ff, 0xffffffff, 0xffffffff, 0xffffffff], 'preserve mode retains the legacy uncolored stack');

// Histogram color edits preserve indexes while changing the aggregate stacks.
const cachedHistogram = { view: createHistogramClientDataView({ columns }) };
for (const backend of ['typescript', 'rust-wasm'] as const) {
  const provider = new HistogramWebgpuAggregationProvider(backend);
  const initial = evaluateHistogramClientView(cachedHistogram, columns);
  const prepared = provider.prepare(initial.columns, spec);
  cachedHistogram.view.addStyle({ id: backend, channels: { color: { op: 'constant', value: '#654321' } } });
  const styled = evaluateHistogramClientView(cachedHistogram, columns);
  assert.equal(provider.prepare(styled.columns, spec), prepared);
  if (backend === 'rust-wasm') assert.equal(provider.getDiagnostics().setupBytes, columns.ids.length * 4);
  const aggregation = provider.build(styled.columns, { plotSpec: spec, includeMembership: true });
  assert.ok(aggregation.subplots.flatMap((p) => p.bins).flatMap((b) => b.stack).every((stack) => stack.color === 0x654321ff));
}

// Client controls must not discard decoder-prepared upload pages for a no-op view.
const preparedSource = { ...source, webgpuPackedData: { async *createPages() { /* already packed by a host worker */ } } };
const preparedView = { view: createParallelClientDataView({ buffers: preparedSource }) };
const untouched = evaluateParallelClientView(preparedView, preparedSource);
assert.equal(untouched.buffers.webgpuPackedData, preparedSource.webgpuPackedData);
assert.equal(untouched.buffers.rawValuesByAxis, source.rawValuesByAxis);
assert.equal(untouched.buffers.domainsByAxis, source.domainsByAxis);
preparedView.view.addFilter({ id: 'visible', predicate: { op: 'gt', field: 'a', value: 1 } });
assert.equal(evaluateParallelClientView(preparedView, preparedSource).buffers.webgpuPackedData, preparedSource.webgpuPackedData,
  'visibility can be appended to prepared coordinates without repacking them');
preparedView.view.addStyle({ id: 'override', channels: { color: { op: 'constant', value: '#123456' } } });
assert.equal(evaluateParallelClientView(preparedView, preparedSource).buffers.webgpuPackedData, undefined,
  'source-packed colors cannot override client styles');
preparedView.view.addTransformation({ id: 'move', op: 'affine', input: 'a', output: 'a', factor: 2, offset: 0 });
assert.equal(evaluateParallelClientView(preparedView, preparedSource).buffers.webgpuPackedData, undefined,
  'transformed coordinates must invalidate prepared pages');

// A 25M-row semantic column stays lazy; its declared length must not trigger
// row decoding, boxed arrays, or datetime BigInt allocations at attachment.
let columnReads = 0;
const compactBoolean = new Proxy({ length: 25_000_000, __parallelCompactGetValue(row: number) { columnReads++; return row % 2; } }, {
  get(target, property) {
    if (property in target) return target[property as keyof typeof target];
    columnReads++;
    return Number(property) % 2;
  },
});
const lazySource = { ...source, recordCount: 25_000_000, axisOrder: ['accepted'], rawValuesByAxis: { accepted: compactBoolean } };
const lazyDataset = createParallelClientDataSet({ buffers: lazySource, datasetVersion: 'fixture-v1' });
assert.ok(columnReads <= 1, 'creating semantic fields must not traverse the population');
assert.equal(lazyDataset.fields.accepted!.values.length, 25_000_000);
assert.equal(lazyDataset.fields.accepted!.values[24_999_999], true);
assert.equal(lazyDataset.fields.accepted!.values[24_999_998], false);
assert.equal(lazyDataset.fields.accepted!.values[25_000_000], undefined);
