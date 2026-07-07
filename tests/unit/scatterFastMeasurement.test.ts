import assert from 'node:assert/strict';

import {
  createFastScatterMeasurementReferenceFromHover,
  type FastScatterDisplayColumns,
  type FastScatterHoverEvent,
  type FastScatterPlotSpec,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';
import {
  createFastScatterAggregateDisplayFields,
  createFastScatterAggregateMeasurementDisplayFields,
} from '../../packages/m-charts/src/m-scatter/core/axisDisplay.ts';
import {
  createFastScatterAggregateMeasurementReferenceFromHover,
} from '../../packages/m-charts/src/m-scatter/core/measurement.ts';

const hover = createHover(1, 'id-1', 'a');
const reference = createFastScatterMeasurementReferenceFromHover(hover);

assert.equal(reference.sourceIndex, 1);
assert.equal(reference.id, 'id-1');
assert.equal(reference.plotId, 'a');
assert.equal(reference.yKey, 'a');
assert.deepEqual(reference.canvasPoint, { canvasX: 10, canvasY: 20 });

const bubbleAggregateHover = createHover(2, 'id-2', 'a');
bubbleAggregateHover.aggregate = {
  axis: {
    x: { center: 12, max: 12, min: 12 },
    y: { center: 5, max: 5, min: 5 },
  },
  count: 7,
  kind: 'bubble',
  membership: {
    count: 7,
    maxSourceIndex: 8,
    minSourceIndex: 2,
    offset: 4,
  },
  sampleIds: ['id-2', 'id-3'],
  visual: {
    aggregateIndex: 3,
    kind: 'bubble',
    radiusCssPx: 9,
  },
  xLabel: '12.0',
  yLabel: '5.00',
};
const bubbleReference = createFastScatterMeasurementReferenceFromHover(
  bubbleAggregateHover,
);

assert.equal(bubbleReference.aggregate?.kind, 'bubble');
assert.equal(bubbleReference.aggregate?.count, 7);
assert.deepEqual(bubbleReference.aggregate?.axis, bubbleAggregateHover.aggregate.axis);
assert.deepEqual(
  bubbleReference.aggregate?.membership,
  bubbleAggregateHover.aggregate.membership,
);
assert.deepEqual(bubbleReference.aggregate?.sampleIds, ['id-2', 'id-3']);
assert.deepEqual(bubbleReference.aggregate?.visual, {
  aggregateIndex: 3,
  kind: 'bubble',
  radiusCssPx: 9,
});

const aggregateReference = createFastScatterAggregateMeasurementReferenceFromHover({
  aggregateKind: 'heatmap',
  axis: {
    x: { center: 15, max: 20, min: 10 },
    y: { center: 3, max: 4, min: 2 },
  },
  canvasPoint: { canvasX: 40, canvasY: 60 },
  cellIndex: 2,
  count: 5,
  membership: {
    count: 5,
    maxSourceIndex: 8,
    minSourceIndex: 4,
    offset: 12,
  },
  plotId: 'a',
  sampleIds: ['id-4', 'id-5'],
  xBin: 0,
  yBin: 1,
  yKey: 'a',
});

assert.equal(aggregateReference.aggregateKind, 'heatmap');
assert.equal(aggregateReference.count, 5);
assert.deepEqual(aggregateReference.sampleIds, ['id-4', 'id-5']);
assert.deepEqual(aggregateReference.membership, {
  count: 5,
  maxSourceIndex: 8,
  minSourceIndex: 4,
  offset: 12,
});

const displayColumns: FastScatterDisplayColumns = {
  ids: ['id-0'],
  x: new Float64Array([0]),
  y: {
    a: new Float64Array([0]),
  },
};
const spec: FastScatterPlotSpec = {
  xLabel: 'X Axis',
  plots: [{ id: 'a', label: 'Metric A', yKey: 'a' }],
};
const aggregateDisplayFields = createFastScatterAggregateDisplayFields({
  activeYKey: 'a',
  aggregate: aggregateReference,
  columns: displayColumns,
  spec,
});

assert.deepEqual(
  aggregateDisplayFields.map((field) => [field.key, field.value]),
  [
    ['x-center', '15.0'],
    ['x-range', '[10.0, 20.0]'],
    ['a', '3.00'],
    ['a-range', '[2.00, 4.00]'],
    ['count', '5'],
  ],
);

const aggregateMeasurementFields = createFastScatterAggregateMeasurementDisplayFields({
  activeYKey: 'a',
  columns: displayColumns,
  current: {
    ...aggregateReference,
    axis: {
      x: { center: 18, max: 22, min: 14 },
      y: { center: 4, max: 5, min: 3 },
    },
    count: 8,
  },
  reference: aggregateReference,
  spec,
});

assert.deepEqual(
  aggregateMeasurementFields.map((field) => [field.key, field.value, field.delta ?? null]),
  [
    ['x-center', '18.0', '+3.00'],
    ['x-range', '[14.0, 22.0]', null],
    ['a', '4.00', '+1.00'],
    ['a-range', '[3.00, 5.00]', null],
    ['count', '8', '+3'],
  ],
);

console.log('scatter-fast measurement tests passed');

function createHover(
  sourceIndex: number,
  id: string,
  plotId: 'a' | 'b' | 'c',
): FastScatterHoverEvent {
  return {
    candidateCount: 1,
    canvasPoint: { canvasX: 10, canvasY: 20 },
    distancePx: 0,
    durationMs: 0.1,
    pinned: false,
    point: {
      id,
      plotId,
      sourceIndex,
      x: sourceIndex,
      y: sourceIndex + 10,
      yKey: plotId,
    },
    source: 'measure',
    sourcePointIndex: sourceIndex,
  };
}
