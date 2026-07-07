import assert from 'node:assert/strict';

import {
  createSelectedParallelLineSeriesBuffers,
  createSelectedParallelWebglSegmentBuffers,
  createParallelBuffers,
  findNearestParallelRecordByPoint,
  materializeParallelSelectedIds,
  normalizeParallelBrushIntervals,
  sampleParallelSelectedIdsFromSourceIndices,
  selectParallelRecordIdsByBrushes,
  serializeParallelSelectedIdsForExport,
} from '../../apps/demo/src/data/parallelBuffers.ts';
import type { ParallelDataset, ParallelRecord } from '../../apps/demo/src/data/types.ts';

const dataset = makeDataset([
  makeRecord('alpha', 10, 100, 0, 50, 500),
  { ...makeRecord('bravo', 20, 50, 1, 75, 500), selected: true },
  makeRecord('charlie', -10, 75, 0.5, 100, 500),
]);

const buffers = createParallelBuffers(dataset, {
  includeWebglSegmentBuffers: true,
});

assert.equal(buffers.recordCount, 3);
assert.equal(buffers.axisCount, 5);
assert.deepEqual(buffers.axisOrder, [
  'throughput',
  'latency',
  'errorRate',
  'cpuLoad',
  'memoryUsage',
]);
assert.deepEqual(buffers.ids, ['alpha', 'bravo', 'charlie']);
assert.equal(buffers.preselectedCount, 1);
assert.deepEqual(Array.from(buffers.preselectedSourceIndices), [1]);

assert.deepEqual(buffers.domainsByAxis.throughput, {
  min: -10,
  max: 20,
  span: 30,
});
assert.deepEqual(buffers.domainsByAxis.latency, {
  min: 50,
  max: 100,
  span: 50,
});
assert.deepEqual(buffers.domainsByAxis.errorRate, {
  min: 0,
  max: 1,
  span: 1,
});
assert.deepEqual(buffers.domainsByAxis.cpuLoad, {
  min: 50,
  max: 100,
  span: 50,
});
assert.deepEqual(buffers.domainsByAxis.memoryUsage, {
  min: 500,
  max: 500,
  span: 0,
});

assert.deepEqual(Array.from(buffers.rawValuesByAxis.throughput), [10, 20, -10]);
assert.deepEqual(Array.from(buffers.rawValuesByAxis.memoryUsage), [500, 500, 500]);

assertApproximatelyEqual(buffers.normalizedValuesByAxis.throughput[0], 2 / 3);
assertApproximatelyEqual(buffers.normalizedValuesByAxis.throughput[1], 1);
assertApproximatelyEqual(buffers.normalizedValuesByAxis.throughput[2], 0);
assert.deepEqual(Array.from(buffers.normalizedValuesByAxis.latency), [1, 0, 0.5]);
assert.deepEqual(Array.from(buffers.normalizedValuesByAxis.errorRate), [0, 1, 0.5]);
assert.deepEqual(Array.from(buffers.normalizedValuesByAxis.cpuLoad), [0, 0.5, 1]);
assert.deepEqual(Array.from(buffers.normalizedValuesByAxis.memoryUsage), [
  0.5,
  0.5,
  0.5,
]);

assert.equal(buffers.lineSeriesBuffers.pointsPerRecord, 6);
assert.equal(buffers.lineSeriesBuffers.sampleCount, 18);
assert.equal(buffers.lineSeriesBuffers.gapCount, 3);
assert.deepEqual(Array.from(buffers.lineSeriesBuffers.x.slice(0, 6)), [
  0,
  1,
  2,
  3,
  4,
  Number.NaN,
]);
assertApproximatelyEqual(buffers.lineSeriesBuffers.y[0], 2 / 3);
assert.equal(buffers.lineSeriesBuffers.y[1], 1);
assert.equal(buffers.lineSeriesBuffers.y[2], 0);
assert.equal(buffers.lineSeriesBuffers.y[3], 0);
assert.equal(buffers.lineSeriesBuffers.y[4], 0.5);
assert.equal(Number.isNaN(buffers.lineSeriesBuffers.y[5]), true);
assert.equal(Number.isNaN(buffers.lineSeriesBuffers.x[11]), true);
assert.equal(Number.isNaN(buffers.lineSeriesBuffers.y[11]), true);
assert.equal(Number.isNaN(buffers.lineSeriesBuffers.x[17]), true);
assert.equal(Number.isNaN(buffers.lineSeriesBuffers.y[17]), true);

assert.equal(buffers.webglSegmentBuffers?.segmentCount, 12);
assert.equal(buffers.webglSegmentBuffers?.verticesPerSegment, 2);
assert.equal(buffers.webglSegmentBuffers?.valuesPerVertex, 2);
assert.deepEqual(
  Array.from(buffers.webglSegmentBuffers?.positions.slice(0, 8) ?? []),
  [0, buffers.normalizedValuesByAxis.throughput[0], 1, 1, 1, 1, 2, 0],
);
assert.deepEqual(
  Array.from(buffers.webglSegmentBuffers?.sourceIndices.slice(0, 6) ?? []),
  [0, 0, 0, 0, 1, 1],
);

assert.deepEqual(
  normalizeParallelBrushIntervals({
    latency: { min: 75, max: 50 },
    throughput: null,
  }),
  [{ axisRangeIndex: 0, parameter: 'latency', min: 50, max: 75 }],
);
assert.throws(
  () =>
    normalizeParallelBrushIntervals({
      throughput: { min: Number.NaN, max: 1 },
    }),
  /Parallel brush interval for throughput must use finite min and max values/,
);

const multiAxisSelection = selectParallelRecordIdsByBrushes(buffers, {
  latency: { min: 50, max: 75 },
  throughput: { min: -10, max: 20 },
});
assert.deepEqual(Array.from(multiAxisSelection.sourceIndices), [1, 2]);
assert.equal(multiAxisSelection.selectedCount, 2);
assert.deepEqual(multiAxisSelection.activeBrushes, [
  { axisRangeIndex: 0, parameter: 'throughput', min: -10, max: 20 },
  { axisRangeIndex: 0, parameter: 'latency', min: 50, max: 75 },
]);
assert.deepEqual(
  materializeParallelSelectedIds(buffers, multiAxisSelection.sourceIndices),
  ['bravo', 'charlie'],
);
assert.deepEqual(
  materializeParallelSelectedIds(
    buffers,
    selectParallelRecordIdsByBrushes(buffers, {
      latency: { min: 50, max: 75 },
      throughput: [
        { min: -10, max: -10 },
        { min: 20, max: 20 },
      ],
    }).sourceIndices,
  ),
  ['bravo', 'charlie'],
);
assert.deepEqual(
  materializeParallelSelectedIds(
    buffers,
    selectParallelRecordIdsByBrushes(buffers, {
      latency: { min: 50, max: 60 },
      throughput: [
        { min: -10, max: -10 },
        { min: 20, max: 20 },
      ],
    }).sourceIndices,
  ),
  ['bravo'],
);
assert.deepEqual(
  sampleParallelSelectedIdsFromSourceIndices(
    buffers,
    multiAxisSelection.sourceIndices,
    1,
  ),
  ['bravo'],
);
assert.equal(
  serializeParallelSelectedIdsForExport(buffers, multiAxisSelection.sourceIndices),
  'bravo\ncharlie',
);

const selectedLineBuffers = createSelectedParallelLineSeriesBuffers(
  buffers,
  multiAxisSelection.sourceIndices,
);
assert.equal(selectedLineBuffers.selectedRecordCount, 2);
assert.equal(selectedLineBuffers.sampleCount, 12);
assert.equal(selectedLineBuffers.gapCount, 2);
assert.deepEqual(Array.from(selectedLineBuffers.x.slice(0, 6)), [
  0,
  1,
  2,
  3,
  4,
  Number.NaN,
]);
assert.equal(selectedLineBuffers.y[0], 1);
assert.equal(selectedLineBuffers.y[1], 0);
assert.equal(selectedLineBuffers.y[2], 1);
assert.equal(selectedLineBuffers.y[3], 0.5);
assert.equal(selectedLineBuffers.y[4], 0.5);
assert.equal(Number.isNaN(selectedLineBuffers.y[5]), true);

const selectedWebglSegmentBuffers = createSelectedParallelWebglSegmentBuffers(
  buffers,
  multiAxisSelection.sourceIndices,
);
assert.equal(selectedWebglSegmentBuffers.selectedRecordCount, 2);
assert.equal(selectedWebglSegmentBuffers.segmentCount, 8);
assert.equal(selectedWebglSegmentBuffers.verticesPerSegment, 2);
assert.equal(selectedWebglSegmentBuffers.valuesPerVertex, 2);
assert.deepEqual(Array.from(selectedWebglSegmentBuffers.sourceIndices.slice(0, 6)), [
  1,
  1,
  1,
  1,
  2,
  2,
]);
assert.deepEqual(Array.from(selectedWebglSegmentBuffers.positions.slice(0, 8)), [
  0,
  1,
  1,
  0,
  1,
  0,
  2,
  1,
]);

const nearest = findNearestParallelRecordByPoint({
  axisPosition: 1,
  buffers,
  maxDistancePx: 20,
  normalizedValue: 0,
  plotHeightPx: 300,
  plotWidthPx: 400,
});
assert.equal(nearest?.id, 'bravo');
assert.equal(nearest?.activeAxis, 'latency');
assert.equal(nearest?.activeAxisValue, 50);
assert.equal(nearest?.segmentStartAxis, 'latency');
assert.equal(nearest?.segmentEndAxis, 'errorRate');

assert.equal(
  findNearestParallelRecordByPoint({
    axisPosition: 1,
    buffers,
    maxDistancePx: 0.1,
    normalizedValue: 0.9,
    plotHeightPx: 300,
    plotWidthPx: 400,
  }),
  null,
);

const allSelection = selectParallelRecordIdsByBrushes(buffers, {});
assert.deepEqual(Array.from(allSelection.sourceIndices), [0, 1, 2]);
assert.deepEqual(materializeParallelSelectedIds(buffers, allSelection.sourceIndices), [
  'alpha',
  'bravo',
  'charlie',
]);

const outlierDataset = makeDataset([
  makeRecord('ordinary', 1, 20, 0, 10, 100),
  makeRecord('outlier', 9_007_199_254_740_991, 20, 0, 10, 100),
]);
const outlierBuffers = createParallelBuffers(outlierDataset);
assert.equal(
  outlierBuffers.rawValuesByAxis.throughput[1],
  9_007_199_254_740_991,
);
assert.deepEqual(
  materializeParallelSelectedIds(
    outlierBuffers,
    selectParallelRecordIdsByBrushes(outlierBuffers, {
      throughput: {
        min: 9_007_199_254_740_991,
        max: 9_007_199_254_740_991,
      },
    }).sourceIndices,
  ),
  ['outlier'],
);

const emptyBuffers = createParallelBuffers(makeDataset([]));
assert.equal(emptyBuffers.recordCount, 0);
assert.equal(emptyBuffers.lineSeriesBuffers.sampleCount, 0);
assert.deepEqual(emptyBuffers.domainsByAxis.throughput, {
  min: 0,
  max: 0,
  span: 0,
});
assert.deepEqual(
  Array.from(selectParallelRecordIdsByBrushes(emptyBuffers, {}).sourceIndices),
  [],
);

const threeAxisBuffers = createParallelBuffers(
  makeVariableDataset(['alpha', 'beta', 'gamma'], [
    { alpha: 0, beta: 10, gamma: 100, id: 'three-a' },
    { alpha: 5, beta: 20, gamma: 200, id: 'three-b' },
    { alpha: 10, beta: 30, gamma: 300, id: 'three-c' },
  ]),
  { includeWebglSegmentBuffers: true },
);
assert.equal(threeAxisBuffers.axisCount, 3);
assert.deepEqual(threeAxisBuffers.axisOrder, ['alpha', 'beta', 'gamma']);
assert.equal(threeAxisBuffers.lineSeriesBuffers.pointsPerRecord, 4);
assert.equal(threeAxisBuffers.lineSeriesBuffers.sampleCount, 12);
assert.equal(threeAxisBuffers.webglSegmentBuffers?.segmentCount, 6);
assert.deepEqual(
  materializeParallelSelectedIds(
    threeAxisBuffers,
    selectParallelRecordIdsByBrushes(threeAxisBuffers, {
      beta: { min: 15, max: 25 },
    }).sourceIndices,
  ),
  ['three-b'],
);

const eightAxisNames = [
  'axisA',
  'axisB',
  'axisC',
  'axisD',
  'axisE',
  'axisF',
  'axisG',
  'axisH',
];
const eightAxisBuffers = createParallelBuffers(
  makeVariableDataset(eightAxisNames, [
    makeVariableRecord('eight-a', eightAxisNames, 0),
    makeVariableRecord('eight-b', eightAxisNames, 10),
  ]),
  { includeWebglSegmentBuffers: true },
);
assert.equal(eightAxisBuffers.axisCount, 8);
assert.deepEqual(eightAxisBuffers.axisOrder, eightAxisNames);
assert.equal(eightAxisBuffers.lineSeriesBuffers.pointsPerRecord, 9);
assert.equal(eightAxisBuffers.lineSeriesBuffers.sampleCount, 18);
assert.equal(eightAxisBuffers.webglSegmentBuffers?.segmentCount, 14);
assert.equal(
  createSelectedParallelWebglSegmentBuffers(eightAxisBuffers, new Uint32Array([1]))
    .segmentCount,
  7,
);

console.log('parallel buffer tests passed');

function makeDataset(records: ParallelRecord[]): ParallelDataset {
  return {
    metadata: {
      attributes: {
        id: 'id',
        parameters: [
          'throughput',
          'latency',
          'errorRate',
          'cpuLoad',
          'memoryUsage',
        ],
      },
      count: records.length,
      createdAt: '2026-05-15T00:00:00.000Z',
      seed: 1,
    },
    records,
  };
}

function makeVariableDataset(
  parameters: readonly string[],
  records: ParallelRecord[],
): ParallelDataset {
  return {
    metadata: {
      attributes: {
        id: 'id',
        parameters,
      },
      count: records.length,
      createdAt: '2026-05-15T00:00:00.000Z',
      seed: 1,
    },
    records,
  };
}

function makeVariableRecord(
  id: string,
  parameters: readonly string[],
  offset: number,
): ParallelRecord {
  return Object.fromEntries([
    ['id', id],
    ...parameters.map((parameter, index) => [parameter, offset + index]),
  ]) as ParallelRecord;
}

function makeRecord(
  id: string,
  throughput: number,
  latency: number,
  errorRate: number,
  cpuLoad: number,
  memoryUsage: number,
): ParallelRecord {
  return {
    cpuLoad,
    errorRate,
    id,
    latency,
    memoryUsage,
    throughput,
  };
}

function assertApproximatelyEqual(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `Expected ${actual} to be within 1e-6 of ${expected}`,
  );
}
