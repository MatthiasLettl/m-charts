import assert from 'node:assert/strict';
import { createClientDataView, type ClientDataPredicate, type ClientDataExpression } from '../../packages/m-charts/src/client-data-view/index.ts';
import { createHistogramClientDataView, evaluateHistogramClientView, type HistogramColumns } from '../../packages/m-charts/src/m-histogram/core/index.ts';
import { HistogramWebgpuAggregationProvider } from '../../packages/m-charts/src/m-histogram-webgpu/core/aggregation.ts';
import { createFastScatterClientDataView, evaluateFastScatterClientView, selectFastScatterSourceIndicesInBounds, buildFastScatterAggregation, calculateFastScatterDomain } from '../../packages/m-charts/src/m-scatter/core/index.ts';
import { FastScatterWebgpuWasmAggregationSession } from '../../packages/m-charts/src/m-scatter-webgpu/core/wasmAggregation.ts';
import { buildFastScatterWebgpuBubbleAggregation } from '../../packages/m-charts/src/m-scatter-webgpu/core/aggregation.ts';
import { composeClientRowColors } from '../../packages/m-charts/src/client-data-view/core/chartProjection.ts';

const dataset = { rowCount: 5, fields: {
  v: { kind: 'numeric' as const, values: [1, 2, null, NaN, Infinity] },
  flag: { kind: 'boolean' as const, values: [true, 1, false, 0, null] },
  category: { kind: 'categorical' as const, values: [1, '1', false, '', null] },
} };
const matching = (predicate: ClientDataPredicate) => {
  const view = createClientDataView({ dataset });
  view.addFilter({ id: 'filter', predicate });
  return Array.from(view.evaluate().activeSourceIndices);
};
assert.deepEqual(matching({ op: 'and', args: [] }), [0, 1, 2, 3, 4]);
assert.deepEqual(matching({ op: 'or', args: [] }), []);
assert.deepEqual(matching({ op: 'in', field: 'v', values: [] }), []);
assert.deepEqual(matching({ op: 'notIn', field: 'v', values: [] }), [0, 1]);
assert.deepEqual(matching({ op: 'ne', field: 'v', value: 1 }), [1]);
assert.deepEqual(matching({ op: 'not', arg: { op: 'eq', field: 'v', value: 1 } }), [1, 2, 3, 4]);
assert.deepEqual(matching({ op: 'isNull', field: 'v' }), [2, 3, 4]);
assert.deepEqual(matching({ op: 'eq', field: 'flag', value: true }), [0, 1]);
assert.deepEqual(matching({ op: 'eq', field: 'category', value: '1' }), [1]);
assert.deepEqual(matching({ op: 'eq', field: 'category', value: 1 }), [0]);
assert.throws(() => matching({ op: 'eq', field: 'v', value: '1' }), /finite numbers/);
const view = createClientDataView({ dataset });
for (const op of ['unknown', 'constructor', 'toString']) {
  assert.throws(() => view.addFilter({ id: 'bad', predicate: { op } as ClientDataPredicate }));
  assert.throws(() => view.addTransformation({ id: 'bad', op: 'calculate', output: 'out', expression: { op, input: { op: 'field', field: 'v' } } as ClientDataExpression }));
  assert.equal(view.getState().revision, 0);
}
const overflow = createClientDataView({ dataset: { rowCount: 2, fields: { v: { kind: 'numeric', values: [-Number.MAX_VALUE, Number.MAX_VALUE] } } } });
for (const direction of ['forward', 'backward'] as const) {
  overflow.replaceState({ ...overflow.exportState(), transformations: [{ id: 'delta', op: 'difference', input: 'v', output: 'delta', direction }] });
  assert.ok(Array.from(overflow.evaluate().fields.delta!.values).every((value) => typeof value === 'number' && Number.isNaN(value)));
}

// Uniform color packing must match ordinary composition, including Float32 opacity rounding.
const styled = createClientDataView({ dataset });
styled.addStyle({ id: 'uniform', channels: { color: { op: 'constant', value: '#123456ab' }, opacity: { op: 'constant', value: 0.5 / 171 } } });
const uniform = styled.evaluate();
const ordinary = { ...uniform, styles: Object.fromEntries(Object.entries(uniform.styles).map(([key, channel]) => [key, { ...channel, constant: undefined }])) };
for (const preserve of [true, false]) {
  assert.deepEqual(composeClientRowColors(uniform, preserve, undefined, false, [255, 255, 255, 255]), composeClientRowColors(ordinary, preserve, undefined, false, [255, 255, 255, 255]));
}
styled.addFilter({ id: 'some', predicate: { op: 'isValid', field: 'v' } });
assert.equal(styled.evaluate().styles.color?.constant, undefined, 'partial assignment cannot use uniform composition');

// Reuse sorted numeric indexes across filtering; preserve membership in both backends.
const columns: HistogramColumns = { ids: ['a', 'b', 'c', 'd'], valuesByParameter: { v: new Float64Array([4, 1, 3, 2]) }, parameters: [{ key: 'v', label: 'V', kind: 'numeric', domain: { min: 0, max: 5 } }] };
const spec = { mode: 'histogram' as const, parameters: columns.parameters!, subplots: [{ id: 'v', label: 'V', parameterKey: 'v' }] };
for (const backend of ['typescript', 'rust-wasm'] as const) {
  const binding = { view: createHistogramClientDataView({ columns }) };
  const provider = new HistogramWebgpuAggregationProvider(backend);
  const initial = evaluateHistogramClientView(binding, columns);
  const prepared = provider.prepare(initial.columns, spec);
  for (const min of [3, 99, 0]) {
    binding.view.replaceState({ ...binding.view.exportState(), filters: [{ id: 'keep', predicate: { op: 'gte', field: 'v', value: min } }] });
    const next = evaluateHistogramClientView(binding, columns);
    assert.equal(next.columns.valuesByParameter, initial.columns.valuesByParameter);
    assert.equal(provider.prepare(next.columns, spec), prepared);
    if (backend === 'rust-wasm') assert.equal(provider.getDiagnostics().setupBytes, 4, 'only the mask is copied to WASM');
    const result = provider.build(next.columns, { plotSpec: spec, preparedState: prepared, includeMembership: true });
    const expected = min === 3 ? [0, 2] : min === 99 ? [] : [0, 1, 2, 3];
    assert.deepEqual(Array.from(result.subplots[0]!.sourceIndices!).sort(), expected);
    assert.equal(result.metrics.totalCount, expected.length);
  }
  provider.dispose();
}

const scatterColumns = { ids: columns.ids, x: new Float64Array([0, 1, 1, 2]), y: { v: new Float64Array([1, 2, 2, 3]) } };
const binding = { view: createFastScatterClientDataView({ columns: scatterColumns }) };
binding.view.addFilter({ id: 'keep', predicate: { op: 'gte', field: 'v', value: 2 } });
const projected = evaluateFastScatterClientView(binding, scatterColumns).interactionColumns;
assert.equal(projected.y.v, scatterColumns.y.v, 'interaction filtering must never copy coordinates');
assert.deepEqual(Array.from(selectFastScatterSourceIndicesInBounds(projected, { x: { min: 0, max: 2 }, y: { min: 0, max: 4 }, yKey: 'v' })), [1, 2, 3]);
const plotSpec = { xLabel: 'X', plots: [{ id: 'v', label: 'V', yKey: 'v' }] };
assert.deepEqual(calculateFastScatterDomain(projected, plotSpec).yByPlot.v, { min: 1.95, max: 3.05 }, 'auto Y range excludes masked rows without copying coordinates');
const wasm = FastScatterWebgpuWasmAggregationSession.create(projected, plotSpec, true)!;
assert.ok(wasm);
assert.equal(FastScatterWebgpuWasmAggregationSession.create({ ...projected, activeMask: new Uint32Array(2) }, plotSpec, true), null, 'invalid masks cannot overwrite the WASM allocation');
assert.throws(() => wasm.updateActiveMask(new Uint32Array(0)), /mask length/);
for (const mode of ['bubble', 'heatmap'] as const) {
  const request = { mode, heatBinPx: 12, xRange: { min: 0, max: 2 }, subplots: [{ plotId: 'v', yKey: 'v', xRange: { min: 0, max: 2 }, yRange: { min: 0, max: 4 }, plotWidthPx: 400, plotHeightPx: 300 }] };
  const cpu = buildFastScatterAggregation(projected, request);
  const gpuCpu = mode === 'bubble' ? buildFastScatterWebgpuBubbleAggregation(projected, { ...request, mode }) : cpu;
  assert.equal(cpu.subplots[0]!.counts.reduce((sum, count) => sum + count, 0), 3);
  assert.equal(gpuCpu.subplots[0]!.counts.reduce((sum, count) => sum + count, 0), 3);
  const result = wasm.build(request)!;
  assert.equal(result.subplots[0]!.counts.reduce((sum, count) => sum + count, 0), 3);
}
console.log('Generic predicate contract, finite differences and resident-mask regressions passed.');
