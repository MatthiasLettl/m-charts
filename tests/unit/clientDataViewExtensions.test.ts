import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createClientDataView, createClientDataFingerprint, createClientDataViewWorkerEvaluator, type ClientDataExpression, type ClientDataSet } from '../../packages/m-charts/src/client-data-view/index.ts';
import { createFastScatterClientDataView, evaluateFastScatterClientView, calculateFastScatterDomain } from '../../packages/m-charts/src/m-scatter/core/index.ts';
import { createHistogramClientDataView, evaluateHistogramClientView, buildHistogramAggregation } from '../../packages/m-charts/src/m-histogram/core/index.ts';
import { createParallelWebgpuBuffers, createParallelClientDataView, evaluateParallelClientView } from '../../packages/m-charts/src/m-parallel/index.ts';

const dataset: ClientDataSet = { rowCount: 4, fields: {
  a: { kind: 'numeric', values: new Float64Array([10, 20, 50, NaN]) },
  b: { kind: 'numeric', values: [2, 0, 5, null] },
  text: { kind: 'categorical', values: [' Alpha ', 'Beta', 'alpha', null] },
  time: { kind: 'datetime-ns', values: ['1700000000000000000', '1700000000000000001', '1700000000000000002', null] },
} };
const field = (key: string): ClientDataExpression => ({ op: 'field', field: key });
const literal = (value: number): ClientDataExpression => ({ op: 'literal', value });
const expressionValues = (expression: ClientDataExpression) => {
  const view = createClientDataView({ dataset });
  view.addTransformation({ id: 'expression', op: 'calculate', output: 'result', expression });
  return Array.from(view.evaluate().fields.result!.values);
};
assert.deepEqual(expressionValues({ op: 'divide', left: field('a'), right: field('b') }), [5, NaN, 10, NaN]);
assert.deepEqual(expressionValues({ op: 'coalesce', args: [{ op: 'divide', left: field('a'), right: field('b') }, literal(-1)] }), [5, -1, 10, -1]);
assert.deepEqual(expressionValues({ op: 'sqrt', input: { op: 'negate', input: field('a') } }), [NaN, NaN, NaN, NaN]);
assert.deepEqual(expressionValues({ op: 'trim', input: { op: 'lower', input: field('text') } }), ['alpha', 'beta', 'alpha', null]);
assert.deepEqual(expressionValues({ op: 'subtract', left: field('time'), right: field('time') }), [0, 0, 0, NaN]);
assert.deepEqual(expressionValues({ op: 'case', branches: [{ when: { op: 'gt', field: 'a', value: 15 }, value: literal(1) }], fallback: literal(0) }), [0, 1, 1, 0]);
for (const [op, input, expected] of [
  ['abs', -4, 4], ['negate', 4, -4], ['log', 1, 0], ['log10', 100, 2], ['sqrt', 9, 3], ['exp', 0, 1], ['round', 1.6, 2], ['floor', 1.6, 1], ['ceil', 1.4, 2],
] as const) assert.equal(expressionValues({ op, input: literal(input) })[0], expected);
for (const [op, expected] of [['add', 8], ['subtract', 4], ['multiply', 12], ['divide', 3], ['modulo', 0], ['power', 36], ['min', 2], ['max', 6]] as const) {
  assert.equal(expressionValues({ op, left: literal(6), right: literal(2) })[0], expected);
}
assert.deepEqual(expressionValues({ op: 'case', branches: [{ when: { op: 'gt', field: 'a', value: 15 }, value: { op: 'literal', value: null } }], fallback: { op: 'literal', value: 'missing' } }), ['missing', null, null, 'missing']);
const view = createClientDataView({ dataset });
view.addTransformation({ id: 'delta', op: 'difference', input: 'a', output: 'delta', direction: 'forward' });
view.addFilter({ id: 'large-delta', stage: 'transformed', predicate: { op: 'gte', field: 'delta', value: 20 } });
assert.deepEqual(Array.from(view.evaluate().activeSourceIndices), [1]);
assert.equal(view.evaluate().fields.delta!.values[1], 30, 'post-filter does not recalculate neighbors');
assert.equal(view.exportState().version, 2, 'old readers must reject extended semantics');
view.removeFilter('large-delta');
assert.deepEqual(Array.from(view.evaluate().activeSourceIndices), [0, 1, 2, 3]);
view.addFilter({ id: 'compare', predicate: { op: 'compare', comparison: 'gt', left: field('a'), right: field('b') } });
assert.deepEqual(Array.from(view.evaluate().activeSourceIndices), [0, 1, 2]);
for (const op of ['contains', 'startsWith', 'endsWith'] as const) {
  const textView = createClientDataView({ dataset });
  textView.addFilter({ id: 'text', predicate: { op, field: 'text', value: 'ALPHA', caseSensitive: false } });
  assert.deepEqual(Array.from(textView.evaluate().activeSourceIndices), op === 'contains' ? [0, 2] : [2]);
}
const dateView = createClientDataView({ dataset });
dateView.addTransformation({ id: 'affine', op: 'affine', input: 'time', output: 'epochNumber', factor: 1, offset: 0 });
assert.equal(dateView.evaluate().fields.epochNumber!.values[0], 1700000000000000000);
dateView.addTransformation({ id: 'ns', op: 'difference', input: 'time', output: 'delta', direction: 'forward' });
assert.equal(dateView.evaluate().fields.delta!.values[0], 1);
const invalid = createClientDataView({ dataset });
for (const expression of [{ op: 'divide', left: field('text'), right: literal(2) }, { op: 'unknown' }] as unknown as ClientDataExpression[]) {
  assert.throws(() => invalid.addTransformation({ id: 'bad', op: 'calculate', output: 'bad', expression }));
  assert.equal(invalid.getState().revision, 0);
}
const events: number[] = [];
view.on('change', (event) => events.push(event.state.revision));
const stop = view.validateWith((evaluation) => { if (!evaluation.fields.delta) throw new TypeError('Plotted delta is required.'); });
const saved = view.getState();
assert.throws(() => view.removeTransformation('delta'), /required/);
assert.equal(view.getState(), saved);
assert.deepEqual(events, []);
stop(); view.removeTransformation('delta');
assert.equal(events.length, 1);
const cache = createClientDataView({ dataset });
const initialFields = cache.evaluate().fields;
cache.addFilter({ id: 'filter', predicate: { op: 'gt', field: 'a', value: 10 } });
assert.equal(cache.evaluate().fields, initialFields, 'filter-only edits keep coordinate identities');
cache.updateFields({ a: { kind: 'numeric', values: [100, 0, 200, 0] } }, 'changed');
assert.deepEqual(Array.from(cache.evaluate().activeSourceIndices), [0, 2]);
assert.equal(cache.exportState().datasetVersion, 'changed');
assert.throws(() => cache.updateFields({ a: { kind: 'numeric', values: [1] } }), /values/);
assert.deepEqual(Array.from(cache.evaluate().activeSourceIndices), [0, 2]);
assert.notEqual(createClientDataFingerprint(dataset, ['a', 'b', 'c', 'd']), createClientDataFingerprint(dataset, ['b', 'a', 'c', 'd']));
assert.notEqual(createClientDataFingerprint(dataset), createClientDataFingerprint({ ...dataset, fields: { ...dataset.fields, b: { kind: 'numeric', values: [2, 1, 5, null] } } }));
assert.equal(createClientDataFingerprint(dataset), createClientDataFingerprint(dataset));

const categories = [{ encoded: 0, label: 'A', value: 'A' }, { encoded: 1, label: 'B', value: 'B' }];
const axis = { columnKey: 'phase', kind: 'categorical' as const, title: 'Phase', parameterName: 'Phase', categories, domain: { min: 0, max: 1 } };
const columns = { ids: ['a', 'b'], x: new Float64Array([0, 1]), y: { value: new Float64Array([10, 20]), phase: new Uint8Array([0, 1]) }, axisByColumn: { phase: axis, value: { ...axis, columnKey: 'value', kind: 'numeric' as const, domain: { min: 10, max: 20 } } } };
const fingerprintView = createFastScatterClientDataView({ columns, fingerprint: true });
const fingerprintState = fingerprintView.exportState();
fingerprintView.updateFields({ membership: { kind: 'boolean', values: [true, false] } });
assert.notEqual(fingerprintView.getState().datasetVersion, fingerprintState.datasetVersion);
assert.throws(() => fingerprintView.replaceState(fingerprintState), /dataset/);
const scatter = createFastScatterClientDataView({ columns });
scatter.addFilter({ id: 'A', predicate: { op: 'eq', field: 'phase', value: 'A' } });
assert.deepEqual(Array.from(scatter.evaluate().activeSourceIndices), [0]);
scatter.removeFilter('A');
scatter.addTransformation({ id: 'scaled', input: 'value', output: 'value', op: 'affine', factor: 10, offset: 0 });
const projected = evaluateFastScatterClientView({ view: scatter }, columns);
assert.deepEqual(calculateFastScatterDomain(projected.renderColumns, { plots: [{ id: 'v', label: 'V', yKey: 'value' }], xLabel: 'X' }).yByPlot.v, { min: 95, max: 205 });
const invalidCategory = createFastScatterClientDataView({ columns: { ...columns, y: { ...columns.y, phase: new Float64Array([0, 999]) } } });
invalidCategory.addFilter({ id: 'valid-category', predicate: { op: 'isValid', field: 'phase' } });
assert.deepEqual(Array.from(invalidCategory.evaluate().activeSourceIndices), [0]);
const timeParameter = { key: 'time', label: 'Time', kind: 'datetime-ns' as const, datetimeOriginNs: '1700000000000000000', epochNsValues: ['1700000000000000000', '1700000000000000001'] };
const histogramColumns = { ids: ['a', 'b'], parameters: [{ key: 'phase', label: 'Phase', kind: 'categorical' as const, categories }, timeParameter], valuesByParameter: { phase: new Uint8Array([0, 1]), time: new Float64Array([0, 0.000001]) } };
const histogram = createHistogramClientDataView({ columns: histogramColumns });
histogram.addFilter({ id: 'time', predicate: { op: 'gte', field: 'time', value: '1700000000000000001' } });
assert.deepEqual(Array.from(histogram.evaluate().activeSourceIndices), [1]);
histogram.removeFilter('time');
histogram.addFilter({ id: 'A', predicate: { op: 'eq', field: 'phase', value: 'A' } });
const h = evaluateHistogramClientView({ view: histogram }, histogramColumns);
assert.equal(h.columns.valuesByParameter.phase, histogramColumns.valuesByParameter.phase);
assert.deepEqual(Array.from(h.activeMask), [1]);
const spec = { mode: 'histogram' as const, parameters: histogramColumns.parameters, subplots: [{ id: 'phase', label: 'Phase', parameterKey: 'phase' }] };
assert.equal(buildHistogramAggregation(h.columns, { plotSpec: spec }).metrics.totalCount, 1);
const buffers = createParallelWebgpuBuffers({ ids: ['a', 'b'], axisOrder: ['a', 'b'], valuesByAxis: { a: [1, 2], b: [3, 4] } });
const parallel = { view: createParallelClientDataView({ buffers }) };
const p0 = evaluateParallelClientView(parallel, buffers).buffers;
parallel.view.addFilter({ id: 'half', predicate: { op: 'eq', field: 'a', value: 1 } });
const p1 = evaluateParallelClientView(parallel, buffers).buffers;
assert.equal(p1.rawValuesByAxis, p0.rawValuesByAxis);
assert.equal(p1.domainsByAxis, p0.domainsByAxis);
assert.notEqual(p1.activeMask, p0.activeMask);

// Execute the actual published module worker in a Node worker thread.
const moduleUrl = new URL('../../packages/m-charts/dist/client-data-view/core/worker.js', import.meta.url).href;
const nodeWorker = new NodeWorker(`const { parentPort } = require('node:worker_threads'); globalThis.postMessage = message => parentPort.postMessage(message); import(${JSON.stringify(moduleUrl)}).then(() => parentPort.on('message', data => globalThis.onmessage({data})));`, { eval: true });
const browserWorker = {
  onmessage: null as null | ((event: MessageEvent) => void), onerror: null as null | ((event: ErrorEvent) => void), onmessageerror: null,
  postMessage: (message: unknown) => nodeWorker.postMessage(message), terminate: () => { void nodeWorker.terminate(); },
};
nodeWorker.on('message', (data) => browserWorker.onmessage?.({ data } as MessageEvent));
nodeWorker.on('error', (error) => browserWorker.onerror?.({ message: error.message, preventDefault() {} } as ErrorEvent));
const asyncView = createClientDataView({ dataset, asyncEvaluator: createClientDataViewWorkerEvaluator(browserWorker as unknown as Worker) });
try {
  const state = asyncView.exportState();
  assert.equal(await asyncView.batchAsync(() => {
    asyncView.addTransformation({ id: 'ratio', op: 'calculate', output: 'ratio', expression: { op: 'divide', left: field('a'), right: field('b') } });
    asyncView.addFilter({ id: 'ratio-filter', stage: 'transformed', predicate: { op: 'gt', field: 'ratio', value: 5 } });
  }), true);
  assert.equal(asyncView.getState().revision, 1);
  assert.deepEqual(Array.from(asyncView.evaluate().activeSourceIndices), [2]);
  assert.equal(asyncView.evaluate().fields.a, dataset.fields.a, 'worker restores original source references');
  const before = asyncView.evaluate();
  await asyncView.batchAsync(() => asyncView.addStyle({ id: 'style', channels: { size: { op: 'constant', value: 8 } } }));
  assert.equal(asyncView.evaluate().fields, before.fields);
  assert.equal(asyncView.evaluate().activeMask, before.activeMask);
  const pending = asyncView.replaceStateAsync(state);
  asyncView.addFilter({ id: 'newer', predicate: { op: 'gte', field: 'a', value: 50 } });
  assert.equal(await pending, false, 'older worker result cannot overwrite a synchronous mutation');
  assert.ok(asyncView.getFilters().some((f) => f.id === 'newer'));
  await asyncView.batchAsync(() => asyncView.addTransformation({ id: 'overwrite', op: 'calculate', output: 'a', expression: { op: 'abs', input: field('a') } }));
  assert.deepEqual(Object.keys(asyncView.evaluate().fields).slice(0, 4), Object.keys(dataset.fields), 'worker preserves source field ordering when overwriting a field');
  const queue = [asyncView.replaceStateAsync(state), asyncView.replaceStateAsync(state), asyncView.replaceStateAsync({ ...state, filters: [{ id: 'latest', predicate: { op: 'gt', field: 'a', value: 20 } }] })];
  assert.deepEqual(await Promise.all(queue), [false, false, true]);
  assert.deepEqual(Array.from(asyncView.evaluate().activeSourceIndices), [2]);
  const stable = asyncView.getState();
  await assert.rejects(asyncView.batchAsync(() => asyncView.addFilter({ id: 'bad', predicate: { op: 'gt', field: 'missing', value: 0 } })), /Unknown/);
  assert.equal(asyncView.getState(), stable);
} finally { asyncView.dispose(); }
console.log('Client expression, semantic projection, atomicity, persistence and real worker regressions passed.');
