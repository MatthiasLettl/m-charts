import assert from 'node:assert/strict';

import {
  computeMeasurementDelta,
  computeMeasurementDeltas,
  pinMeasurementReferenceId,
  placeMeasurementDeltaLabel,
} from '../../apps/demo/src/data/measurement.ts';
import type { ScatterRecord } from '../../apps/demo/src/data/types.ts';

const referenceRecord = makeRecord('reference', 10, 100, -20, 0.5);
const hoveredRecord = makeRecord('hovered', 15.5, 94, 12, -1.25);

assert.deepEqual(
  computeMeasurementDelta({
    activeAttribute: 'b',
    hoveredRecord,
    referenceRecord,
  }),
  {
    activeAttribute: 'b',
    activeDelta: 32,
    da: -6,
    db: 32,
    dc: -1.75,
    dx: 5.5,
    hoveredRecord,
    referenceRecord,
  },
);

assert.equal(
  computeMeasurementDelta({
    activeAttribute: 'a',
    hoveredRecord: referenceRecord,
    referenceRecord,
  }).activeDelta,
  0,
);

assert.equal(
  computeMeasurementDelta({
    activeAttribute: 'c',
    hoveredRecord,
    referenceRecord,
  }).activeDelta,
  -1.75,
);

assert.deepEqual(
  computeMeasurementDeltas({
    activeAttribute: 'a',
    hoveredRecord,
    referenceRecords: [
      referenceRecord,
      makeRecord('reference-2', 13, 90, 10, -2),
    ],
  }).map((delta) => ({
    activeDelta: delta.activeDelta,
    id: delta.referenceRecord.id,
  })),
  [
    { activeDelta: -6, id: 'reference' },
    { activeDelta: 4, id: 'reference-2' },
  ],
);

assert.deepEqual(pinMeasurementReferenceId([], 'record-1'), ['record-1']);
assert.deepEqual(pinMeasurementReferenceId(['record-1'], 'record-2'), [
  'record-2',
  'record-1',
]);
assert.deepEqual(
  pinMeasurementReferenceId(['record-2', 'record-1'], 'record-1'),
  ['record-1', 'record-2'],
);
assert.deepEqual(
  pinMeasurementReferenceId(['record-3', 'record-2', 'record-1'], 'record-4'),
  ['record-4', 'record-3', 'record-2'],
);
assert.deepEqual(pinMeasurementReferenceId(['record-1'], 'record-2', 0), []);

assert.deepEqual(
  placeMeasurementDeltaLabel({
    bounds: { height: 320, width: 420 },
    hoverAnchor: { x: 260, y: 180 },
    labelSize: { height: 40, width: 120 },
    referenceAnchor: { x: 140, y: 120 },
  }),
  { anchor: 'below-left', left: 66, top: 164 },
);

assert.deepEqual(
  placeMeasurementDeltaLabel({
    bounds: { height: 140, width: 180 },
    hoverAnchor: { x: 170, y: 12 },
    labelSize: { height: 40, width: 120 },
    referenceAnchor: { x: 150, y: 20 },
  }),
  { anchor: 'below-left', left: 26, top: 30 },
);

console.log('measurement tests passed');

function makeRecord(
  id: string,
  x: number,
  a: number,
  b: number,
  c: number,
): ScatterRecord {
  return {
    a,
    b,
    c,
    category: 'core',
    color: '#2563EB',
    id,
    opacity: 0.72,
    rotation: 45,
    shape: 'circle',
    size: 3,
    styleGroup: 'default',
    x,
  };
}
