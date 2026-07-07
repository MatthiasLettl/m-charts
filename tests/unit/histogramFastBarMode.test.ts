import assert from 'node:assert/strict';

import {
  materializeHistogramBinSourceIndices,
  normalizeHistogramBarBinSizeState,
  normalizeHistogramBarSeries,
  type HistogramBarSeries,
} from '../../packages/m-charts/src/m-histogram/core/index.ts';

const numericSeries = {
  bins: [
    {
      colorStack: [
        { color: 0xff0000ff, count: 2 },
        { color: 0x00ff00ff, count: 1 },
      ],
      count: 3,
      max: 10,
      min: 0,
      sourceIndices: new Uint32Array([40, 41, 42]),
    },
    {
      colorStack: [{ color: 0x0000ffff, count: 2 }],
      count: 2,
      max: 20,
      min: 10,
      sourceIndexRange: { count: 2, start: 90 },
    },
  ],
  parameterKey: 'temperature',
  parameterName: 'Temperature',
  subplotId: 'temperature',
} satisfies HistogramBarSeries;

const numericAggregation = normalizeHistogramBarSeries(numericSeries);
assert.equal(numericAggregation.mode, 'bar');
assert.equal(numericAggregation.pointCount, 5);
assert.deepEqual(numericAggregation.metrics, {
  binCount: 2,
  colorSegmentCount: 3,
  excludedValueCount: 0,
  invalidValueCount: 0,
  missingValueCount: 0,
  outOfDomainValueCount: 0,
  sourceIndexCount: 5,
  totalCount: 5,
});

const numericSubplot = numericAggregation.subplots[0];
assert.equal(numericSubplot?.dataMode, 'bar');
assert.equal(numericSubplot?.sourceIndicesAvailable, true);
assert.deepEqual(
  numericSubplot?.bins.map((bin) => bin.totalCount),
  [3, 2],
);
assert.deepEqual(numericSubplot?.bins[0]?.stack, [
  { color: 0xff0000ff, count: 2, endCount: 2, startCount: 0 },
  { color: 0x00ff00ff, count: 1, endCount: 3, startCount: 2 },
]);
assert.deepEqual(
  numericSubplot === undefined
    ? []
    : Array.from(materializeHistogramBinSourceIndices(numericSubplot, 0)),
  [40, 41, 42],
);
assert.deepEqual(
  numericSubplot === undefined
    ? []
    : Array.from(materializeHistogramBinSourceIndices(numericSubplot, 1)),
  [90, 91],
);

const missingMembershipAggregation = normalizeHistogramBarSeries({
  bins: [
    {
      count: 12,
      max: 1,
      metadata: { sourceFile: 'bar-fixture' },
      min: 0,
      source: 'summary-service',
      table: 'summary',
    },
  ],
  parameterKey: 'score',
  subplotId: 'score',
});
const missingMembershipSubplot = missingMembershipAggregation.subplots[0];
assert.equal(missingMembershipSubplot?.sourceIndicesAvailable, false);
assert.equal(
  missingMembershipSubplot?.bins[0]?.membership?.sourceIndicesAvailable,
  false,
);
assert.deepEqual(
  missingMembershipSubplot === undefined
    ? []
    : Array.from(materializeHistogramBinSourceIndices(missingMembershipSubplot, 0)),
  [],
);
assert.equal(missingMembershipSubplot?.bins[0]?.descriptor.table, 'summary');
assert.equal(
  missingMembershipSubplot?.bins[0]?.descriptor.metadata?.sourceFile,
  'bar-fixture',
);

const categoryAggregation = normalizeHistogramBarSeries({
  bins: [
    {
      categoryValue: 'critical',
      colorStack: [{ color: 0xaa0000ff, count: 8 }],
      count: 8,
      sourceIndices: [1, 3, 5, 7, 9, 11, 13, 15],
    },
    {
      category: { encoded: 5, label: 'Normal', value: 'normal' },
      count: 4,
      sourceIndices: [2, 4, 6, 8],
    },
  ],
  parameterKey: 'status',
  subplotId: 'status',
});
const categorySubplot = categoryAggregation.subplots[0];
assert.deepEqual(
  categorySubplot?.bins.map((bin) => bin.descriptor.category?.label),
  ['critical', 'Normal'],
);
assert.deepEqual(
  categorySubplot?.bins.map((bin) => [bin.descriptor.min, bin.descriptor.max]),
  [
    [-0.5, 0.5],
    [4.5, 5.5],
  ],
);

const datetimeAggregation = normalizeHistogramBarSeries({
  bins: [
    {
      count: 2,
      max: 1_700_000_000_000_999,
      min: 1_700_000_000_000_000,
      sourceMembership: { count: 2, offset: 1, sourceIndicesAvailable: true },
    },
  ],
  parameter: {
    key: 'timestampNs',
    kind: 'datetime-ns',
    label: 'Timestamp',
  },
  parameterKey: 'timestampNs',
  sourceIndices: new Uint32Array([99, 100, 101]),
  subplotId: 'timestampNs',
});
const datetimeSubplot = datetimeAggregation.subplots[0];
assert.equal(datetimeSubplot?.bins[0]?.descriptor.min, 1_700_000_000_000_000);
assert.equal(datetimeSubplot?.bins[0]?.descriptor.max, 1_700_000_000_000_999);
assert.deepEqual(
  datetimeSubplot === undefined
    ? []
    : Array.from(materializeHistogramBinSourceIndices(datetimeSubplot, 0)),
  [100, 101],
);

const multiParameterAggregation = normalizeHistogramBarSeries([
  {
    bins: [{ count: 1, max: 1, min: 0, sourceIndices: [11] }],
    parameterKey: 'latency',
    subplotId: 'latency',
  },
  {
    bins: [{ count: 2, max: 100, min: 50, sourceIndices: [21, 22] }],
    parameterKey: 'size',
    subplotId: 'size',
  },
]);
assert.deepEqual(
  multiParameterAggregation.subplots.map((subplot) => subplot.parameterKey),
  ['latency', 'size'],
);
assert.deepEqual(
  multiParameterAggregation.subplots.map((subplot) => subplot.bins[0]?.totalCount),
  [1, 2],
);

assert.deepEqual(
  normalizeHistogramBarBinSizeState({
    adjustment: 'increase',
    binSize: 10,
    mode: 'continuous',
    parameterKey: 'latency',
    subplotId: 'latency',
  }),
  {
    adjustment: 'none',
    binSize: 10,
    mode: 'continuous',
    parameterKey: 'latency',
    subplotId: 'latency',
  },
);

console.log('histogram-fast bar-mode tests passed');
