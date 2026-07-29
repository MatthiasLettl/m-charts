import assert from 'node:assert/strict';

import {
  HistogramWebgpuAggregationProvider,
} from '../packages/m-charts/src/m-histogram-webgpu/index.ts';
import type {
  HistogramColumns,
  HistogramPlotSpec,
} from '../packages/m-charts/src/m-histogram/index.ts';

const pointCount = parsePointCount(process.argv.slice(2));
const values = new Float32Array(pointCount);
const categories = new Uint8Array(pointCount);
const colors = new Uint32Array(pointCount);

for (let index = 0; index < pointCount; index += 1) {
  values[index] = ((index * 73) % 100_000) / 1_000;
  categories[index] = index % 4;
  colors[index] = index % 2 === 0 ? 0x2563_ebff : 0x0596_69ff;
}

const columns: HistogramColumns = {
  color: colors,
  colorFormat: 'rgba32',
  ids: { length: pointCount } as readonly string[],
  valuesByParameter: {
    phase: categories,
    value: values,
  },
};
const spec: HistogramPlotSpec = {
  mode: 'histogram',
  parameters: [
    {
      domain: { max: 100, min: 0 },
      key: 'value',
      kind: 'numeric',
      label: 'Value',
    },
    {
      categories: [
        { encoded: 0, label: 'A', value: 'a' },
        { encoded: 1, label: 'B', value: 'b' },
        { encoded: 2, label: 'C', value: 'c' },
        { encoded: 3, label: 'D', value: 'd' },
      ],
      domain: { max: 3.5, min: -0.5 },
      key: 'phase',
      kind: 'categorical',
      label: 'Phase',
    },
  ],
  subplots: [
    { id: 'value', label: 'Value', parameterKey: 'value' },
    { id: 'phase', label: 'Phase', parameterKey: 'phase' },
  ],
};

const provider = new HistogramWebgpuAggregationProvider('rust-wasm');
provider.prepare(columns, spec);
const setup = provider.getDiagnostics();
const selectedSourceIndices = new Uint32Array([1, pointCount - 1]);

const full = timeBuild(() => provider.build(columns, {
  includeMembership: false,
  plotSpec: spec,
  selectedSourceIndices,
}));
const fullDiagnostics = provider.getDiagnostics();
assert.equal(fullDiagnostics.lastVisitedRowCount, pointCount * 2);

const viewport = {
  subplotById: {
    phase: {
      x: { max: 3.5, min: -0.5 },
      y: { max: pointCount, min: 0 },
    },
    value: {
      x: { max: 55, min: 45 },
      y: { max: pointCount, min: 0 },
    },
  },
};
const zoomed = timeBuild(() => provider.build(columns, {
  includeMembership: false,
  plotSpec: spec,
  selectedSourceIndices,
  viewport,
}));
const zoomedDiagnostics = provider.getDiagnostics();
assert.equal(zoomedDiagnostics.lastReusedSubplotCount, 1);
assert.ok(
  zoomedDiagnostics.lastVisitedRowCount <= Math.ceil(pointCount * 0.101),
  `Zoomed build visited ${zoomedDiagnostics.lastVisitedRowCount} of ${pointCount} continuous rows.`,
);

const resized = timeBuild(() => provider.build(columns, {
  binSizes: [{
    binSize: 0.25,
    mode: 'continuous',
    parameterKey: 'value',
    subplotId: 'value',
  }],
  includeMembership: false,
  plotSpec: spec,
  selectedSourceIndices,
  viewport,
}));
const resizedDiagnostics = provider.getDiagnostics();
assert.equal(resizedDiagnostics.lastReusedSubplotCount, 1);
assert.ok(resizedDiagnostics.lastVisitedRowCount <= Math.ceil(pointCount * 0.101));

const unchanged = timeBuild(() => provider.build(columns, {
  binSizes: [{
    binSize: 0.25,
    mode: 'continuous',
    parameterKey: 'value',
    subplotId: 'value',
  }],
  includeMembership: false,
  plotSpec: spec,
  selectedSourceIndices,
  viewport,
}));
const unchangedDiagnostics = provider.getDiagnostics();
assert.equal(unchangedDiagnostics.lastReusedSubplotCount, 2);
assert.equal(unchangedDiagnostics.lastVisitedRowCount, 0);

console.log(JSON.stringify({
  fullBuildMs: full.ms,
  fullVisitedRows: fullDiagnostics.lastVisitedRowCount,
  indexedRows: setup.indexedRowCount,
  pointCount,
  setupBytes: setup.setupBytes,
  setupMs: setup.setupMs,
  unchangedBuildMs: unchanged.ms,
  unchangedReusedSubplots: unchangedDiagnostics.lastReusedSubplotCount,
  zoomedBinSizeBuildMs: resized.ms,
  zoomedBinSizeVisitedRows: resizedDiagnostics.lastVisitedRowCount,
  zoomedBuildMs: zoomed.ms,
  zoomedReusedSubplots: zoomedDiagnostics.lastReusedSubplotCount,
  zoomedVisitedRows: zoomedDiagnostics.lastVisitedRowCount,
}, null, 2));

provider.dispose();

function parsePointCount(args: readonly string[]): number {
  const raw = args.find((argument) => argument.startsWith('--points='))?.slice(9);
  const value = raw === undefined ? 1_000_000 : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 25_000_000) {
    throw new Error('--points must be an integer between 1 and 25,000,000.');
  }
  return value;
}

function timeBuild<T>(build: () => T): { ms: number; result: T } {
  const startedAt = performance.now();
  const result = build();
  return {
    ms: performance.now() - startedAt,
    result,
  };
}
