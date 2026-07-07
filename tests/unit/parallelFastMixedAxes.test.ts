import assert from 'node:assert/strict';

import {
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  createParallelFastAxisTicks,
  createParallelFastBuffers,
  findNearestParallelRecordByPoint,
  formatParallelFastAxisValue,
  formatParallelFastRecordAxisValue,
  selectParallelRecordIdsByBrushes,
  type ParallelFastColumns,
} from '../../packages/m-charts/src/m-parallel/core/index.ts';

const startNs = 1_717_200_000_000_000_000n;
const columns: ParallelFastColumns = {
  axes: [
    { key: 'latency', kind: 'numeric', label: 'Latency', unit: 'ms' },
    {
      categories: [
        { label: 'Queued', value: 'queued' },
        { label: 'Running', value: 'running' },
        { label: 'Done', value: 'done' },
      ],
      key: 'stage',
      kind: 'categorical',
      label: 'Stage',
    },
    { key: 'accepted', kind: 'boolean', label: 'Accepted' },
    { key: 'observedAt', kind: 'datetime-ns', label: 'Observed at' },
  ],
  axisOrder: ['latency', 'stage', 'accepted', 'observedAt'],
  ids: ['alpha', 'bravo', 'charlie', 'delta'],
  valuesByAxis: {
    accepted: [true, false, true, null],
    latency: new Float64Array([12, 24, Number.NaN, 36]),
    observedAt: [
      startNs.toString(),
      (startNs + 1_500_000n).toString(),
      undefined,
      (startNs + 4_000_000n).toString(),
    ],
    stage: ['queued', 'running', 'done', undefined],
  },
};

const buffers = createParallelFastBuffers(columns, {
  includeWebglSegmentBuffers: true,
});

assert.equal(buffers.axisCount, 4);
assert.deepEqual(buffers.axisOrder, ['latency', 'stage', 'accepted', 'observedAt']);
assert.equal(buffers.axisMetadataByAxis.latency.kind, 'numeric');
assert.equal(buffers.axisMetadataByAxis.stage.kind, 'categorical');
assert.equal(buffers.axisMetadataByAxis.accepted.kind, 'boolean');
assert.equal(buffers.axisMetadataByAxis.observedAt.kind, 'datetime-ns');

assert.deepEqual(buffers.domainsByAxis.stage, { min: -0.5, max: 2.5, span: 3 });
assert.deepEqual(buffers.domainsByAxis.accepted, { min: -0.5, max: 1.5, span: 2 });
assert.deepEqual(Array.from(buffers.rawValuesByAxis.stage), [0, 1, 2, Number.NaN]);
assert.deepEqual(Array.from(buffers.rawValuesByAxis.accepted), [
  1,
  0,
  1,
  Number.NaN,
]);
assert.equal(Number.isNaN(buffers.rawValuesByAxis.latency[2]), true);
assert.equal(Number.isNaN(buffers.rawValuesByAxis.observedAt[2]), true);

assert.deepEqual(
  createParallelFastAxisTicks(buffers.axisMetadataByAxis.stage, {
    range: buffers.domainsByAxis.stage,
  }),
  [
    { label: 'Queued', value: 0 },
    { label: 'Running', value: 1 },
    { label: 'Done', value: 2 },
  ],
);
assert.deepEqual(
  createParallelFastAxisTicks(buffers.axisMetadataByAxis.stage, {
    count: 2,
    range: buffers.domainsByAxis.stage,
  }),
  [
    { label: 'Queued', value: 0 },
    { label: 'Done', value: 2 },
  ],
);
assert.deepEqual(
  createParallelFastAxisTicks(buffers.axisMetadataByAxis.accepted, {
    range: buffers.domainsByAxis.accepted,
  }),
  [
    { label: 'false', value: 0 },
    { label: 'true', value: 1 },
  ],
);

const smallCategoryLabels = Array.from({ length: 12 }, (_, index) => `Label ${index}`);
const smallCategoryBuffers = createParallelFastBuffers({
  axes: [
    {
      categories: smallCategoryLabels.map((label, index) => ({
        label,
        value: `category-${index}`,
      })),
      key: 'category',
      kind: 'categorical',
      label: 'Category',
    },
  ],
  axisOrder: ['category'],
  ids: smallCategoryLabels.map((_, index) => `row-${index}`),
  valuesByAxis: {
    category: smallCategoryLabels.map((_, index) => `category-${index}`),
  },
});

assert.deepEqual(
  createParallelFastAxisTicks(smallCategoryBuffers.axisMetadataByAxis.category, {
    range: smallCategoryBuffers.domainsByAxis.category,
  }).map((tick) => tick.label),
  smallCategoryLabels,
);

const largeCategoryLabels = Array.from({ length: 18 }, (_, index) => `Large ${index}`);
const largeCategoryBuffers = createParallelFastBuffers({
  axes: [
    {
      categories: largeCategoryLabels.map((label, index) => ({
        label,
        value: `large-${index}`,
      })),
      key: 'category',
      kind: 'categorical',
      label: 'Category',
    },
  ],
  axisOrder: ['category'],
  ids: largeCategoryLabels.map((_, index) => `large-row-${index}`),
  valuesByAxis: {
    category: largeCategoryLabels.map((_, index) => `large-${index}`),
  },
});
const sampledLargeCategoryTicks = createParallelFastAxisTicks(
  largeCategoryBuffers.axisMetadataByAxis.category,
  {
    count: 5,
    range: largeCategoryBuffers.domainsByAxis.category,
  },
);

assert.equal(sampledLargeCategoryTicks.length, 5);
assert.equal(sampledLargeCategoryTicks[0]?.label, 'Large 0');
assert.equal(sampledLargeCategoryTicks.at(-1)?.label, 'Large 17');

assert.deepEqual(
  createParallelFastAxisTicks(buffers.axisMetadataByAxis.observedAt, {
    count: 3,
    range: buffers.domainsByAxis.observedAt,
  }),
  [
    {
      fullLabel: '2024-06-01T00:00:00.000Z',
      label: '00:00:00',
      value: 0,
    },
    {
      fullLabel: '2024-06-01T00:00:00.002Z',
      label: '00:00:00.002',
      value: 2,
    },
    {
      fullLabel: '2024-06-01T00:00:00.004Z',
      label: '00:00:00.004',
      value: 4,
    },
  ],
);
assert.equal(formatParallelFastAxisValue(buffers.axisMetadataByAxis.stage, 1), 'Running');
assert.equal(formatParallelFastAxisValue(buffers.axisMetadataByAxis.stage, -0.25), 'Queued');
assert.equal(formatParallelFastAxisValue(buffers.axisMetadataByAxis.stage, 2.25), 'Done');
assert.equal(formatParallelFastAxisValue(buffers.axisMetadataByAxis.accepted, 0), 'false');
assert.equal(formatParallelFastAxisValue(buffers.axisMetadataByAxis.accepted, 0.75), 'true');
assert.match(
  formatParallelFastAxisValue(buffers.axisMetadataByAxis.observedAt, 0, 0),
  /^2024-06-01T00:00:00\.000Z$/,
);
assert.equal(
  formatParallelFastAxisValue(buffers.axisMetadataByAxis.observedAt, 1.5),
  '2024-06-01T00:00:00.0015Z',
);
assert.equal(formatParallelFastRecordAxisValue(buffers, 'latency', 1), '24 ms');
assert.equal(formatParallelFastRecordAxisValue(buffers, 'stage', 1), 'Running');
assert.equal(formatParallelFastRecordAxisValue(buffers, 'accepted', 1), 'false');
assert.equal(
  formatParallelFastRecordAxisValue(buffers, 'observedAt', 1),
  '2024-06-01T00:00:00.0015Z',
);
assert.equal(formatParallelFastRecordAxisValue(buffers, 'stage', 3), 'n/a');

const datetimeAxis = buffers.axisMetadataByAxis.observedAt;
assert.equal(datetimeAxis.kind, 'datetime-ns');
if (datetimeAxis.kind === 'datetime-ns') {
  assert.equal(datetimeAxis.datetimeOriginNs, startNs.toString());
  assert.deepEqual(datetimeAxis.epochNsValues, [
    startNs.toString(),
    (startNs + 1_500_000n).toString(),
    undefined,
    (startNs + 4_000_000n).toString(),
  ]);
}

assert.equal(buffers.webglSegmentBuffers?.segmentCount, 10);
assert.deepEqual(Array.from(buffers.webglSegmentBuffers?.sourceIndices ?? []), [
  0,
  0,
  0,
  1,
  1,
  1,
  2,
  3,
  3,
  3,
]);
assert.deepEqual(
  Array.from(buffers.webglSegmentBuffers?.positions.slice(-12) ?? []),
  [
    0,
    1,
    1,
    PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
    1,
    PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
    2,
    PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
    2,
    PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
    3,
    1,
  ],
);
assert.equal(buffers.lineSeriesBuffers.gapCount, 4);
assert.equal(Number.isNaN(buffers.lineSeriesBuffers.y[2 * 5]), true);

assert.deepEqual(
  Array.from(
    selectParallelRecordIdsByBrushes(buffers, {
      latency: { min: 0, max: 40 },
      observedAt: { min: 0, max: 5 },
    }).sourceIndices,
  ),
  [0, 1, 3],
);
assert.deepEqual(
  Array.from(
    selectParallelRecordIdsByBrushes(buffers, {
      accepted: [{ min: 0.75, max: 1.25 }],
    }).sourceIndices,
  ),
  [0, 2],
);
assert.deepEqual(
  Array.from(
    selectParallelRecordIdsByBrushes(buffers, {
      observedAt: [{ min: 1.5, max: 1.5 }],
    }).sourceIndices,
  ),
  [1],
);
assert.deepEqual(
  Array.from(
    selectParallelRecordIdsByBrushes(buffers, {
      observedAt: [{ min: 1.49, max: 1.51 }],
    }).sourceIndices,
  ),
  [1],
);
assert.deepEqual(
  Array.from(
    selectParallelRecordIdsByBrushes(buffers, {
      latency: [
        { min: 10, max: 13 },
        { min: 35, max: 37 },
      ],
      stage: [
        { min: -0.25, max: 0.25 },
        { min: 1.75, max: 2.25 },
      ],
    }).sourceIndices,
  ),
  [0],
);
assert.deepEqual(
  Array.from(
    selectParallelRecordIdsByBrushes(buffers, {
      latency: [
        { min: 10, max: 13 },
        { min: 35, max: 37 },
      ],
    }).sourceIndices,
  ),
  [0, 3],
);
assert.equal(
  findNearestParallelRecordByPoint({
    axisPosition: 1,
    buffers,
    maxDistancePx: 120,
    normalizedValue: 1,
    plotHeightPx: 100,
    plotWidthPx: 300,
  })?.id,
  'charlie',
);

const consecutiveMissingColumns = createParallelFastBuffers(
  {
    axisOrder: ['presentA', 'missingA', 'missingB', 'presentB'],
    axes: [
      { key: 'presentA', kind: 'numeric', label: 'Present A' },
      { key: 'missingA', kind: 'numeric', label: 'Missing A' },
      { key: 'missingB', kind: 'numeric', label: 'Missing B' },
      { key: 'presentB', kind: 'numeric', label: 'Present B' },
    ],
    ids: ['bridged'],
    valuesByAxis: {
      missingA: [null],
      missingB: [null],
      presentA: [4],
      presentB: [8],
    },
  },
  { includeWebglSegmentBuffers: true },
);
assert.equal(consecutiveMissingColumns.webglSegmentBuffers?.segmentCount, 3);
assert.deepEqual(
  Array.from(consecutiveMissingColumns.webglSegmentBuffers?.positions ?? []),
  [
    0,
    0.5,
    1,
    PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
    1,
    PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
    2,
    PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
    2,
    PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
    3,
    0.5,
  ],
);

console.log('parallel-fast mixed axis tests passed');
