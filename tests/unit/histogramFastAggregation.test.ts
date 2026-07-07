import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
  buildHistogramAggregation,
  materializeHistogramBinSourceIndices,
  resolveHistogramContinuousBinSize,
  type HistogramAggregationRequest,
  type HistogramColumns,
  type HistogramPlotSpec,
} from '../../packages/m-charts/src/m-histogram/core/index.ts';

const numericSpec = {
  mode: 'histogram',
  parameters: [
    {
      domain: { max: 10, min: 0 },
      key: 'temperature',
      kind: 'numeric',
      label: 'Temperature',
    },
  ],
  subplots: [
    {
      id: 'temperature',
      label: 'Temperature',
      parameterKey: 'temperature',
    },
  ],
} as const satisfies HistogramPlotSpec;

const numericColumns: HistogramColumns = {
  color: new Uint32Array([
    0xff0000ff,
    0xff0000ff,
    0x00ff00ff,
    0x0000ffff,
    0x0000ffff,
    0xffffffff,
    0xffffffff,
    0xffffffff,
    0xffffffff,
  ]),
  colorFormat: 'rgba32',
  ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
  sourceIndex: new Uint32Array([10, 4, 7, 8, 2, 99, 100, 101, 102]),
  valuesByParameter: {
    temperature: [0, 1.999, 2, 3.5, 10, -1, 10.1, Number.NaN, null],
  },
};

const numericAggregation = buildHistogramAggregation(numericColumns, {
  binSizes: [
    {
      binSize: 2,
      mode: 'continuous',
      parameterKey: 'temperature',
      subplotId: 'temperature',
    },
  ],
  hoverSourceIndex: 7,
  plotSpec: numericSpec,
  selectedSourceIndices: new Uint32Array([4, 2]),
});

assert.equal(numericAggregation.mode, 'histogram');
assert.equal(numericAggregation.pointCount, 9);
assert.deepEqual(
  numericAggregation.metrics,
  {
    binCount: 5,
    colorSegmentCount: 4,
    excludedValueCount: 4,
    invalidValueCount: 1,
    missingValueCount: 1,
    outOfDomainValueCount: 2,
    sourceIndexCount: 5,
    totalCount: 5,
  },
);

const numericSubplot = numericAggregation.subplots[0];
assert.equal(numericSubplot?.binCount, 5);
assert.deepEqual(
  numericSubplot?.bins.map((bin) => bin.totalCount),
  [2, 2, 0, 0, 1],
);
assert.deepEqual(
  numericSubplot?.bins.map((bin) => bin.descriptor.min),
  [0, 2, 4, 6, 8],
);
assert.deepEqual(
  numericSubplot?.bins.map((bin) => bin.descriptor.max),
  [2, 4, 6, 8, 10],
);
assert.deepEqual(
  numericSubplot?.bins.map((bin) => bin.selectedCount),
  [1, 0, 0, 0, 1],
);
assert.deepEqual(
  numericSubplot?.bins.map((bin) => bin.hovered),
  [false, true, false, false, false],
);
assert.deepEqual(
  numericSubplot?.bins[0]?.stack,
  [
    { color: 0xff0000ff, count: 2, endCount: 2, startCount: 0 },
  ],
);
assert.deepEqual(
  numericSubplot?.bins[1]?.stack,
  [
    { color: 0x00ff00ff, count: 1, endCount: 1, startCount: 0 },
    { color: 0x0000ffff, count: 1, endCount: 2, startCount: 1 },
  ],
);
assert.deepEqual(
  numericSubplot?.bins.map((bin) => bin.membership),
  [
    { count: 2, offset: 0, sourceIndicesAvailable: true },
    { count: 2, offset: 2, sourceIndicesAvailable: true },
    { count: 0, offset: 4, sourceIndicesAvailable: true },
    { count: 0, offset: 4, sourceIndicesAvailable: true },
    { count: 1, offset: 4, sourceIndicesAvailable: true },
  ],
);
assert.deepEqual(
  numericSubplot === undefined
    ? []
    : Array.from(materializeHistogramBinSourceIndices(numericSubplot, 0)),
  [10, 4],
);
assert.deepEqual(
  numericSubplot === undefined
    ? []
    : Array.from(materializeHistogramBinSourceIndices(numericSubplot, 1)),
  [7, 8],
);
assert.deepEqual(
  numericSubplot === undefined
    ? []
    : Array.from(materializeHistogramBinSourceIndices(numericSubplot, 4)),
  [2],
);
assert.deepEqual(numericSubplot?.continuousBinResolution, {
  effectiveBinSize: 2,
  effectiveVisibleBinCount: 5,
  hardMaxVisibleBinCount: 512,
  minBinSize: 0.00001,
  requestedBinSize: 2,
  requestedVisibleBinCount: 5,
  softMaxVisibleBinCount: 256,
  status: 'applied',
  visibleRange: { max: 10, min: 0 },
});
assert.deepEqual(numericSubplot?.domain, { max: 10, min: 0 });

const datetimeSpec = {
  mode: 'histogram',
  parameters: [
    {
      domain: { max: 5_000, min: 0 },
      key: 'timestampNs',
      kind: 'datetime-ns',
      label: 'Timestamp',
    },
  ],
  subplots: [
    {
      id: 'timestampNs',
      label: 'Timestamp',
      parameterKey: 'timestampNs',
    },
  ],
} as const satisfies HistogramPlotSpec;

const datetimeAggregation = buildHistogramAggregation(
  {
    ids: ['a', 'b', 'c', 'd', 'e'],
    valuesByParameter: {
      timestampNs: [0n, 1_000n, 1_999n, 2_000n, 5_000n],
    },
  },
  {
    binSizes: [
      {
        binSize: 1_000,
        mode: 'continuous',
        parameterKey: 'timestampNs',
        subplotId: 'timestampNs',
      },
    ],
    plotSpec: datetimeSpec,
  },
);
assert.deepEqual(
  datetimeAggregation.subplots[0]?.bins.map((bin) => bin.totalCount),
  [1, 2, 1, 0, 1],
);

const clampedResolution = resolveHistogramContinuousBinSize({
  parameter: datetimeSpec.parameters[0],
  requestedBinSize: 1,
  visibleRange: { max: 5_000, min: 0 },
});
assert.deepEqual(clampedResolution, {
  effectiveBinSize: 5000 / 512,
  effectiveVisibleBinCount: 512,
  hardMaxVisibleBinCount: 512,
  minBinSize: 1,
  requestedBinSize: 1,
  requestedVisibleBinCount: 5000,
  softMaxVisibleBinCount: 256,
  status: 'clamped',
  visibleRange: { max: 5_000, min: 0 },
});

const categorySpec = {
  mode: 'histogram',
  parameters: [
    {
      categories: [
        { encoded: 2, label: 'Blue', order: 1, value: 'blue' },
        { encoded: 1, label: 'Red', order: 0, value: 'red' },
      ],
      key: 'colorName',
      kind: 'categorical',
      label: 'Color',
    },
    {
      categories: [
        { encoded: 0, label: 'Off', value: false },
        { encoded: 1, label: 'On', value: true },
      ],
      key: 'active',
      kind: 'boolean',
      label: 'Active',
    },
  ],
  subplots: [
    {
      id: 'colorName',
      label: 'Color',
      parameterKey: 'colorName',
    },
    {
      id: 'active',
      label: 'Active',
      parameterKey: 'active',
    },
  ],
} as const satisfies HistogramPlotSpec;

const categoryAggregation = buildHistogramAggregation(
  {
    color: new Uint8Array([
      255, 0, 0, 255,
      0, 0, 255, 255,
      255, 0, 0, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]),
    colorFormat: 'rgba8',
    ids: ['a', 'b', 'c', 'd', 'e'],
    valuesByParameter: {
      active: [true, false, 1, 0, null],
      colorName: ['red', 'blue', 1, 'green', null],
    },
  },
  {
    plotSpec: categorySpec,
  },
);

const colorNameSubplot = categoryAggregation.subplots[0];
assert.deepEqual(
  colorNameSubplot?.bins.map((bin) => bin.descriptor.category?.label),
  ['Red', 'Blue'],
);
assert.deepEqual(
  colorNameSubplot?.bins.map((bin) => bin.totalCount),
  [2, 1],
);
assert.deepEqual(colorNameSubplot?.bins[0]?.stack, [
  { color: 0xff0000ff, count: 2, endCount: 2, startCount: 0 },
]);

const activeSubplot = categoryAggregation.subplots[1];
assert.deepEqual(
  activeSubplot?.bins.map((bin) => bin.totalCount),
  [2, 2],
);
assert.equal(categoryAggregation.metrics.binCount, 4);
assert.equal(categoryAggregation.metrics.totalCount, 7);
assert.equal(categoryAggregation.metrics.missingValueCount, 2);
assert.equal(categoryAggregation.metrics.invalidValueCount, 1);

const sharedParameterSpec = {
  mode: 'histogram',
  parameters: [
    {
      domain: { max: 4, min: 0 },
      key: 'shared',
      kind: 'numeric',
      label: 'Shared Metric',
      sourceTables: ['a', 'b'],
    },
  ],
  subplots: [
    {
      id: 'shared',
      label: 'Shared Metric',
      parameterKey: 'shared',
    },
  ],
} as const satisfies HistogramPlotSpec;

const sharedAggregation = buildHistogramAggregation(
  {
    ids: ['a0', 'a1', 'b0', 'b1'],
    tableBySourceIndex: ['a', 'a', 'b', 'b'],
    valuesByParameter: {
      shared: new Float64Array([0, 1, 2, 3]),
    },
  },
  {
    binSizes: [
      {
        binSize: 2,
        mode: 'continuous',
        parameterKey: 'shared',
        subplotId: 'shared',
      },
    ],
    plotSpec: sharedParameterSpec,
  },
);
assert.equal(sharedAggregation.subplots.length, 1);
assert.deepEqual(
  sharedAggregation.subplots[0]?.bins.map((bin) => bin.totalCount),
  [2, 2],
);

const timingRequest = createTimingRequest();
const timingStartedAt = performance.now();
const timingAggregation = buildHistogramAggregation(
  timingRequest.columns,
  timingRequest.request,
);
const timingMs = performance.now() - timingStartedAt;
assert.equal(timingAggregation.metrics.totalCount, 1_000_000);
assert.equal(timingAggregation.metrics.excludedValueCount, 0);
assert.equal(timingAggregation.subplots[0]?.binCount, 100);
console.log(`histogram-fast 1,000,000-row aggregation: ${timingMs.toFixed(2)}ms`);

console.log('histogram-fast aggregation tests passed');

function createTimingRequest(): {
  columns: HistogramColumns;
  request: HistogramAggregationRequest;
} {
  const rowCount = 1_000_000;
  const ids = new Array<string>(rowCount);
  const values = new Float64Array(rowCount);
  const colors = new Uint32Array(rowCount);

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    ids[rowIndex] = String(rowIndex);
    values[rowIndex] = rowIndex % 10_000;
    colors[rowIndex] = rowIndex % 2 === 0 ? 0xff3366ff : 0x22aa66ff;
  }

  return {
    columns: {
      color: colors,
      colorFormat: 'rgba32',
      ids,
      valuesByParameter: {
        value: values,
      },
    },
    request: {
      binSizes: [
        {
          binSize: 100,
          mode: 'continuous',
          parameterKey: 'value',
          subplotId: 'value',
        },
      ],
      plotSpec: {
        mode: 'histogram',
        parameters: [
          {
            domain: { max: 10_000, min: 0 },
            key: 'value',
            kind: 'numeric',
            label: 'Value',
          },
        ],
        subplots: [
          {
            id: 'value',
            label: 'Value',
            parameterKey: 'value',
          },
        ],
      },
    },
  };
}
