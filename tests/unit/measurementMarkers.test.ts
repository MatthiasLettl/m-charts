import assert from 'node:assert/strict';

import { createMeasurementReferenceMarkers } from '../../apps/demo/src/data/measurementMarkers.ts';
import type { ScatterYAttribute } from '../../apps/demo/src/data/types.ts';

const attributes: ScatterYAttribute[] = ['a', 'b', 'c'];

assert.deepEqual(
  createMeasurementReferenceMarkers(attributes, (attribute, index) => ({
    x: 100 + index * 10,
    y: attribute === 'b' ? 250 : 200 + index * 10,
  })),
  [
    { anchor: { x: 100, y: 200 }, attribute: 'a' },
    { anchor: { x: 110, y: 250 }, attribute: 'b' },
    { anchor: { x: 120, y: 220 }, attribute: 'c' },
  ],
);

assert.deepEqual(
  createMeasurementReferenceMarkers(attributes, (attribute) => {
    if (attribute === 'a') {
      return null;
    }

    if (attribute === 'b') {
      return { x: Number.NaN, y: 20 };
    }

    return { x: 30, y: 40 };
  }),
  [{ anchor: { x: 30, y: 40 }, attribute: 'c' }],
);

console.log('measurement marker tests passed');
