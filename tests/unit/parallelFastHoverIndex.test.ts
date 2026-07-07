import assert from 'node:assert/strict';

import {
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  createParallelFastBuffers,
  createParallelHoverIndex,
  findNearestParallelRecordByIndexedPoint,
  writeOneRecordSegmentPositions,
} from '../../packages/m-charts/src/m-parallel/core/index.ts';

const buffers = createParallelFastBuffers(
  {
    axisOrder: ['left', 'middle', 'right'],
    axes: [
      { key: 'left', kind: 'numeric', label: 'Left' },
      { key: 'middle', kind: 'numeric', label: 'Middle' },
      { key: 'right', kind: 'numeric', label: 'Right' },
    ],
    ids: ['low', 'high', 'missing'],
    valuesByAxis: {
      left: [0, 1, null],
      middle: [0.05, 0.95, null],
      right: [0.1, 0.9, 0.5],
    },
  },
  { includeWebglSegmentBuffers: true },
);

const index = createParallelHoverIndex(buffers, {
  candidatesPerCell: 8,
  searchRadiusCells: 8,
  xBinsPerAxisPair: 16,
  yBins: 32,
});

assert.equal(index.axisPairCount, 2);
assert.equal(index.metrics.byteLength, index.candidates.byteLength);
assert.equal(index.metrics.candidateCount > 0, true);

const nearestLow = findNearestParallelRecordByIndexedPoint({
  axisPosition: 0.5,
  buffers,
  index,
  maxDistancePx: 40,
  normalizedValue: 0.05,
  plotHeightPx: 100,
  plotWidthPx: 100,
});
assert.equal(nearestLow?.id, 'low');

const nearestHigh = findNearestParallelRecordByIndexedPoint({
  axisPosition: 0.5,
  buffers,
  index,
  maxDistancePx: 40,
  normalizedValue: 0.95,
  plotHeightPx: 100,
  plotWidthPx: 100,
});
assert.equal(nearestHigh?.id, 'high');

const tooFar = findNearestParallelRecordByIndexedPoint({
  axisPosition: 0.5,
  buffers,
  index,
  maxDistancePx: 0.1,
  normalizedValue: 0.5,
  plotHeightPx: 100,
  plotWidthPx: 100,
});
assert.equal(tooFar, null);

const adjacentCellBuffers = createParallelFastBuffers(
  {
    axisOrder: ['left', 'right'],
    axes: [
      { key: 'left', kind: 'numeric', label: 'Left' },
      { key: 'right', kind: 'numeric', label: 'Right' },
    ],
    ids: ['far-same-cell', 'near-adjacent-cell', 'domain-min', 'domain-max'],
    valuesByAxis: {
      left: [0.52, 0.499, 0, 1],
      right: [0.52, 0.499, 0, 1],
    },
  },
  { includeWebglSegmentBuffers: true },
);
const adjacentCellIndex = createParallelHoverIndex(adjacentCellBuffers, {
  candidatesPerCell: 8,
  searchRadiusCells: 1,
  xBinsPerAxisPair: 4,
  yBins: 4,
});
const adjacentCellNearest = findNearestParallelRecordByIndexedPoint({
  axisPosition: 0.5,
  buffers: adjacentCellBuffers,
  index: adjacentCellIndex,
  maxDistancePx: 20,
  normalizedValue: 0.501,
  plotHeightPx: 100,
  plotWidthPx: 100,
});
assert.equal(adjacentCellNearest?.id, 'near-adjacent-cell');

const continuousSegmentBuffers = createParallelFastBuffers(
  {
    axisOrder: ['left', 'right'],
    axes: [
      { key: 'left', kind: 'numeric', label: 'Left' },
      { key: 'right', kind: 'numeric', label: 'Right' },
    ],
    ids: ['diagonal', 'domain-max'],
    valuesByAxis: {
      left: [0, 1],
      right: [1, 0],
    },
  },
  { includeWebglSegmentBuffers: true },
);
const continuousSegmentIndex = createParallelHoverIndex(continuousSegmentBuffers, {
  candidatesPerCell: 4,
  samplesPerSegment: 3,
  searchRadiusCells: 0,
  xBinsPerAxisPair: 64,
  yBins: 128,
});
const continuousSegmentNearest = findNearestParallelRecordByIndexedPoint({
  axisPosition: 0.333,
  buffers: continuousSegmentBuffers,
  index: continuousSegmentIndex,
  maxDistancePx: 4,
  normalizedValue: 0.333,
  plotHeightPx: 128,
  plotWidthPx: 128,
});
assert.equal(continuousSegmentNearest?.id, 'diagonal');

assert.equal(
  buffers.webglSegmentBuffers?.sourceIndices.includes(2),
  false,
  'fully missing rows should still not create routed segments',
);

const oneRecordPositions = new Float32Array(8);
const oneRecordFloatCount = writeOneRecordSegmentPositions(
  buffers,
  0,
  oneRecordPositions,
);
assert.equal(oneRecordFloatCount, 8);
assert.deepEqual(Array.from(oneRecordPositions), [0, 0, 1, 0, 1, 0, 2, 0]);

const missingRecordPositions = new Float32Array(4);
const missingRecordFloatCount = writeOneRecordSegmentPositions(
  buffers,
  2,
  missingRecordPositions,
);
assert.equal(missingRecordFloatCount, 0);
assert.deepEqual(Array.from(missingRecordPositions), [0, 0, 0, 0]);

const routedBuffers = createParallelFastBuffers(
  {
    axisOrder: ['left', 'middle', 'right', 'table'],
    axes: [
      { key: 'left', kind: 'numeric', label: 'Left' },
      { key: 'middle', kind: 'numeric', label: 'Middle' },
      { key: 'right', kind: 'numeric', label: 'Right' },
      {
        categories: [
          { label: 'Primary', value: 'primary' },
          { label: 'Secondary', value: 'secondary' },
        ],
        key: 'table',
        kind: 'categorical',
        label: 'Table',
      },
    ],
    ids: ['bridged'],
    valuesByAxis: {
      left: [0],
      middle: [null],
      right: [1],
      table: ['primary'],
    },
  },
  { includeWebglSegmentBuffers: true },
);
const routedPositions = new Float32Array(12);
const routedFloatCount = writeOneRecordSegmentPositions(
  routedBuffers,
  0,
  routedPositions,
);
assert.equal(routedFloatCount, 12);
assert.deepEqual(Array.from(routedPositions), [
  0,
  0.5,
  1,
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  1,
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  2,
  0.5,
  2,
  0.5,
  3,
  0.25,
]);

const routedIndex = createParallelHoverIndex(routedBuffers, {
  candidatesPerCell: 8,
  searchRadiusCells: 8,
  xBinsPerAxisPair: 16,
  yBins: 32,
});
const routedNearest = findNearestParallelRecordByIndexedPoint({
  axisPosition: 1.5,
  buffers: routedBuffers,
  index: routedIndex,
  maxDistancePx: 30,
  normalizedValue: PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  plotHeightPx: 120,
  plotWidthPx: 300,
});
assert.equal(routedNearest?.id, 'bridged');
assert.equal(routedNearest?.segmentStartAxis, 'middle');
assert.equal(routedNearest?.segmentEndAxis, 'right');

const consecutiveMissingBuffers = createParallelFastBuffers(
  {
    axisOrder: ['left', 'missingA', 'missingB', 'right'],
    axes: [
      { key: 'left', kind: 'numeric', label: 'Left' },
      { key: 'missingA', kind: 'numeric', label: 'Missing A' },
      { key: 'missingB', kind: 'numeric', label: 'Missing B' },
      { key: 'right', kind: 'numeric', label: 'Right' },
    ],
    ids: ['routed', 'fully-missing'],
    valuesByAxis: {
      left: [0, null],
      missingA: [null, null],
      missingB: [null, null],
      right: [1, null],
    },
  },
  { includeWebglSegmentBuffers: true },
);
const consecutivePositions = new Float32Array(12);
const consecutiveFloatCount = writeOneRecordSegmentPositions(
  consecutiveMissingBuffers,
  0,
  consecutivePositions,
);
assert.equal(consecutiveFloatCount, 12);
assert.deepEqual(Array.from(consecutivePositions), [
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
]);
assert.equal(
  consecutiveMissingBuffers.webglSegmentBuffers?.sourceIndices.includes(1),
  false,
);
const consecutiveIndex = createParallelHoverIndex(consecutiveMissingBuffers, {
  candidatesPerCell: 8,
  searchRadiusCells: 8,
  xBinsPerAxisPair: 16,
  yBins: 32,
});
const consecutiveNearest = findNearestParallelRecordByIndexedPoint({
  axisPosition: 1.5,
  buffers: consecutiveMissingBuffers,
  index: consecutiveIndex,
  maxDistancePx: 30,
  normalizedValue: PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  plotHeightPx: 120,
  plotWidthPx: 300,
});
assert.equal(consecutiveNearest?.id, 'routed');
assert.equal(consecutiveNearest?.segmentStartAxis, 'missingA');
assert.equal(consecutiveNearest?.segmentEndAxis, 'missingB');

console.log('parallel-fast hover index tests passed');
