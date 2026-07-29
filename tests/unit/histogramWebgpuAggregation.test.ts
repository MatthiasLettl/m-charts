import assert from 'node:assert/strict';

import {
  buildHistogramAggregation,
  prepareHistogramAggregationState,
  type HistogramAggregationRequest,
  type HistogramAggregationSet,
  type HistogramColumns,
  type HistogramPlotSpec,
} from '../../packages/m-charts/src/m-histogram/index.ts';
import {
  HistogramWebgpuAggregationProvider,
} from '../../packages/m-charts/src/m-histogram-webgpu/index.ts';

const pointCount = 20_000;
const values = new Float32Array(pointCount);
for (let index = 0; index < pointCount; index += 1) {
  values[index] = ((index * 73) % 10_000) / 100;
}
const columns: HistogramColumns = {
  ids: { length: pointCount } as readonly string[],
  valuesByParameter: { value: values },
};
const spec: HistogramPlotSpec = {
  mode: 'histogram',
  parameters: [{
    domain: { min: 0, max: 100 },
    key: 'value',
    kind: 'numeric',
    label: 'Value',
  }],
  subplots: [{ id: 'value', label: 'Value', parameterKey: 'value' }],
};
const request: HistogramAggregationRequest = {
  hoverSourceIndex: 73,
  includeMembership: false,
  plotSpec: spec,
  selectedSourceIndices: new Uint32Array([4, 500]),
};

const provider = new HistogramWebgpuAggregationProvider('rust-wasm');
provider.prepare(columns, spec);
const wasm = provider.build(columns, request);
const typescript = buildHistogramAggregation(columns, {
  ...request,
  preparedState: prepareHistogramAggregationState(columns, spec),
});

assert.equal(provider.getDiagnostics().backend, 'rust-wasm');
assert.equal(provider.getDiagnostics().indexedRowCount, pointCount);
assert.equal(provider.getDiagnostics().lastReusedSubplotCount, 0);
assert.equal(provider.getDiagnostics().lastVisitedRowCount, pointCount);
assert.equal(wasm.metrics.totalCount, pointCount);
assert.deepEqual(toComparableAggregation(wasm), toComparableAggregation(typescript));
assert.equal(wasm.subplots[0]?.sourceIndicesState, 'pending');

const zoomedRequest: HistogramAggregationRequest = {
  ...request,
  viewport: {
    subplotById: {
      value: {
        x: { min: 20, max: 30 },
        y: { min: 0, max: pointCount },
      },
    },
  },
};
const zoomed = provider.build(columns, zoomedRequest);
const zoomedTypescript = buildHistogramAggregation(columns, {
  ...zoomedRequest,
  preparedState: prepareHistogramAggregationState(columns, spec),
});
assert.deepEqual(toComparableAggregation(zoomed), toComparableAggregation(zoomedTypescript));
assert.ok(provider.getDiagnostics().lastVisitedRowCount < pointCount / 2);
assert.equal(provider.getDiagnostics().lastReusedSubplotCount, 0);

provider.build(columns, zoomedRequest);
assert.equal(provider.getDiagnostics().lastVisitedRowCount, 0);
assert.equal(provider.getDiagnostics().lastReusedSubplotCount, 1);

const materialized = provider.build(columns, {
  ...zoomedRequest,
  includeMembership: true,
});
const materializedTypescript = buildHistogramAggregation(columns, {
  ...zoomedRequest,
  includeMembership: true,
  preparedState: prepareHistogramAggregationState(columns, spec),
});
assert.equal(provider.getDiagnostics().backend, 'rust-wasm');
assert.deepEqual(
  toComparableAggregation(materialized),
  toComparableAggregation(materializedTypescript),
);
assert.deepEqual(
  materialized.subplots[0]?.sourceIndices,
  materializedTypescript.subplots[0]?.sourceIndices,
);
assert.equal(materialized.subplots[0]?.sourceIndicesState, 'available');
assert.equal(
  materialized.subplots[0]?.sourceIndices?.length,
  materialized.metrics.totalCount,
);
assert.ok(provider.getDiagnostics().lastVisitedRowCount < pointCount / 2);

provider.build(columns, {
  ...zoomedRequest,
  includeMembership: true,
});
assert.equal(provider.getDiagnostics().lastVisitedRowCount, 0);
assert.equal(provider.getDiagnostics().lastReusedSubplotCount, 1);

const changedSelectionRequest: HistogramAggregationRequest = {
  ...zoomedRequest,
  selectedSourceIndices: new Uint32Array([5]),
};
const changedSelection = provider.build(columns, changedSelectionRequest);
const changedSelectionTypescript = buildHistogramAggregation(columns, {
  ...changedSelectionRequest,
  preparedState: prepareHistogramAggregationState(columns, spec),
});
assert.deepEqual(
  toComparableAggregation(changedSelection),
  toComparableAggregation(changedSelectionTypescript),
);
assert.equal(provider.getDiagnostics().lastReusedSubplotCount, 0);
assert.ok(provider.getDiagnostics().lastVisitedRowCount > 0);

const multiSubplotProvider = new HistogramWebgpuAggregationProvider('rust-wasm');
const multiSubplotSpec: HistogramPlotSpec = {
  ...spec,
  subplots: [
    { id: 'value-a', label: 'Value A', parameterKey: 'value' },
    { id: 'value-b', label: 'Value B', parameterKey: 'value' },
  ],
};
multiSubplotProvider.prepare(columns, multiSubplotSpec);
multiSubplotProvider.build(columns, {
  includeMembership: false,
  plotSpec: multiSubplotSpec,
});
assert.equal(multiSubplotProvider.getDiagnostics().lastVisitedRowCount, pointCount * 2);
multiSubplotProvider.build(columns, {
  binSizes: [{
    binSize: 2,
    mode: 'continuous',
    parameterKey: 'value',
    subplotId: 'value-a',
  }],
  includeMembership: false,
  plotSpec: multiSubplotSpec,
});
assert.equal(multiSubplotProvider.getDiagnostics().lastReusedSubplotCount, 1);
assert.equal(multiSubplotProvider.getDiagnostics().lastVisitedRowCount, pointCount);

const coloredProvider = new HistogramWebgpuAggregationProvider('auto');
const colors = new Uint32Array(pointCount);
for (let index = 0; index < pointCount; index += 1) {
  colors[index] = index % 2 === 0 ? 0x2563_ebff : 0x0596_69ff;
}
const coloredColumns: HistogramColumns = {
  ...columns,
  color: colors,
  colorFormat: 'rgba32',
};
coloredProvider.prepare(coloredColumns, spec);
const coloredWasm = coloredProvider.build(coloredColumns, request);
const coloredTypescript = buildHistogramAggregation(coloredColumns, request);
assert.equal(coloredProvider.getDiagnostics().backend, 'rust-wasm');
assert.deepEqual(
  toComparableAggregation(coloredWasm),
  toComparableAggregation(coloredTypescript),
);

const categoryColumns: HistogramColumns = {
  color: new Uint32Array([
    0x6474_8bff,
    0x2563_ebff,
    0x0596_69ff,
    0x7c3a_edff,
    0xdc26_26ff,
    0xea58_0cff,
  ]),
  colorFormat: 'rgba32',
  ids: { length: 6 } as readonly string[],
  valuesByParameter: {
    accepted: new Uint8Array([0, 1, 1, 0, 1, 0]),
    phase: new Uint8Array([0, 1, 2, 3, 2, 9]),
  },
};
const categorySpec: HistogramPlotSpec = {
  mode: 'histogram',
  parameters: [
    {
      categories: [
        { encoded: 0, label: 'Idle', value: 'idle' },
        { encoded: 1, label: 'Ramp', value: 'ramp' },
        { encoded: 2, label: 'Steady', value: 'steady' },
        { encoded: 3, label: 'Cooldown', value: 'cooldown' },
      ],
      domain: { min: -0.5, max: 3.5 },
      key: 'phase',
      kind: 'categorical',
      label: 'Process phase',
    },
    {
      categories: [
        { encoded: 0, label: 'false', value: false },
        { encoded: 1, label: 'true', value: true },
      ],
      domain: { min: -0.5, max: 1.5 },
      key: 'accepted',
      kind: 'boolean',
      label: 'Acceptance',
    },
  ],
  subplots: [
    { id: 'phase', label: 'Process phase', parameterKey: 'phase' },
    { id: 'accepted', label: 'Acceptance', parameterKey: 'accepted' },
  ],
};
const categoryRequest: HistogramAggregationRequest = {
  includeMembership: false,
  plotSpec: categorySpec,
};
const categoryProvider = new HistogramWebgpuAggregationProvider('rust-wasm');
categoryProvider.prepare(categoryColumns, categorySpec);
const categoryWasm = categoryProvider.build(categoryColumns, categoryRequest);
const categoryTypescript = buildHistogramAggregation(categoryColumns, categoryRequest);
assert.equal(categoryProvider.getDiagnostics().backend, 'rust-wasm');
assert.deepEqual(
  toComparableAggregation(categoryWasm),
  toComparableAggregation(categoryTypescript),
);

const customSourceIndexProvider = new HistogramWebgpuAggregationProvider('rust-wasm');
const customSourceIndexColumns: HistogramColumns = {
  ids: ['a', 'b', 'c'],
  sourceIndex: new Uint32Array([100, 101, 102]),
  valuesByParameter: { value: new Float32Array([10, 20, 30]) },
};
customSourceIndexProvider.prepare(customSourceIndexColumns, spec);
const customSourceIndexAggregation = customSourceIndexProvider.build(
  customSourceIndexColumns,
  {
    includeMembership: false,
    plotSpec: spec,
    selectedSourceIndices: new Uint32Array([101]),
  },
);
assert.equal(customSourceIndexProvider.getDiagnostics().backend, 'typescript');
assert.match(
  customSourceIndexProvider.getDiagnostics().fallbackReason ?? '',
  /outside the row range/u,
);
assert.equal(
  customSourceIndexAggregation.subplots[0]?.bins.reduce(
    (sum, bin) => sum + bin.selectedCount,
    0,
  ),
  1,
);

const fractionalCategoryProvider = new HistogramWebgpuAggregationProvider('rust-wasm');
const fractionalCategoryColumns: HistogramColumns = {
  ...categoryColumns,
  valuesByParameter: {
    ...categoryColumns.valuesByParameter,
    phase: new Float32Array([0, 1, 1.5, 2, 3, 0]),
  },
};
fractionalCategoryProvider.prepare(fractionalCategoryColumns, categorySpec);
const fractionalCategoryAggregation = fractionalCategoryProvider.build(
  fractionalCategoryColumns,
  categoryRequest,
);
const fractionalCategoryTypescript = buildHistogramAggregation(
  fractionalCategoryColumns,
  categoryRequest,
);
assert.equal(fractionalCategoryProvider.getDiagnostics().backend, 'typescript');
assert.deepEqual(
  toComparableAggregation(fractionalCategoryAggregation),
  toComparableAggregation(fractionalCategoryTypescript),
);

const boundaryProvider = new HistogramWebgpuAggregationProvider('rust-wasm');
const boundaryColumns: HistogramColumns = {
  ids: ['invalid', 'low', 'first', 'second', 'high'],
  valuesByParameter: {
    value: new Float64Array([Number.NaN, -5, 2, 2, 15]),
  },
};
const boundaryRequest: HistogramAggregationRequest = {
  hoverSourceIndex: 3,
  includeMembership: false,
  plotSpec: spec,
  selectedSourceIndices: new Uint32Array([2]),
  viewport: {
    subplotById: {
      value: {
        x: { min: 1, max: 4 },
        y: { min: 0, max: 10 },
      },
    },
  },
};
boundaryProvider.prepare(boundaryColumns, spec);
const boundaryWasm = boundaryProvider.build(boundaryColumns, boundaryRequest);
const boundaryTypescript = buildHistogramAggregation(
  boundaryColumns,
  boundaryRequest,
);
assert.equal(boundaryProvider.getDiagnostics().backend, 'rust-wasm');
assert.deepEqual(
  toComparableAggregation(boundaryWasm),
  toComparableAggregation(boundaryTypescript),
);

provider.dispose();
coloredProvider.dispose();
categoryProvider.dispose();
customSourceIndexProvider.dispose();
fractionalCategoryProvider.dispose();
boundaryProvider.dispose();
multiSubplotProvider.dispose();
console.log('histogram WebGPU aggregation tests passed');

function toComparableAggregation(aggregation: HistogramAggregationSet) {
  const { aggregateBuildMs: _aggregateBuildMs, ...metrics } = aggregation.metrics;
  void _aggregateBuildMs;
  return {
    metrics,
    mode: aggregation.mode,
    pointCount: aggregation.pointCount,
    subplots: aggregation.subplots.map((subplot) => ({
      binCount: subplot.binCount,
      bins: subplot.bins.map((bin) => ({
        descriptor: bin.descriptor,
        hovered: bin.hovered,
        selectedCount: bin.selectedCount,
        stack: bin.stack,
        totalCount: bin.totalCount,
      })),
      continuousBinResolution: subplot.continuousBinResolution,
      dataMode: subplot.dataMode,
      domain: subplot.domain,
      parameterKey: subplot.parameterKey,
      subplotId: subplot.subplotId,
    })),
  };
}
