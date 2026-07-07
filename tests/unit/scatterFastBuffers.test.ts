import assert from 'node:assert/strict';

import { SCATTER_STYLE_LIMITS, type ScatterDataset } from '../../apps/demo/src/data/types.ts';
import { createFastScatterBuffersFromDataset } from '../../packages/m-charts/src/m-scatter/adapters/scatterDataset.ts';
import {
  createFastScatterBuffers,
  FAST_SCATTER_SHAPE_CODES,
  normalizeRotationDegrees,
  normalizeRotationRadians,
  packRgba8Color,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

const dataset = makeDataset([
  {
    id: 'alpha',
    x: 1,
    a: 10,
    b: 20,
    c: 30,
    category: 'core',
    styleGroup: 'default',
    color: '#112233',
    opacity: 0,
    rotation: 90,
    size: 0,
    shape: 'circle',
  },
  {
    id: 'bravo',
    x: 1,
    a: 11,
    b: 21,
    c: 31,
    category: 'north',
    styleGroup: 'accent',
    color: '#aabbcc',
    opacity: 0.75,
    rotation: null,
    size: 7,
    shape: 'arrow',
  },
]);

const buffers = createFastScatterBuffersFromDataset(dataset);

assert.equal(buffers.recordCount, 2);
assert.deepEqual(buffers.ids, ['alpha', 'bravo']);
assert.deepEqual(Array.from(buffers.sourceIndex), [0, 1]);
assert.deepEqual(Array.from(buffers.x), [1, 1]);
assert.deepEqual(Array.from(buffers.y.a), [10, 11]);
assert.deepEqual(Array.from(buffers.y.b), [20, 21]);
assert.deepEqual(Array.from(buffers.y.c), [30, 31]);
assert.deepEqual(Array.from(buffers.color), [
  0x11,
  0x22,
  0x33,
  0xff,
  0xaa,
  0xbb,
  0xcc,
  0xff,
]);
const packedColors = new Uint8Array(8);
packRgba8Color(packedColors, 0, '#102030');
packRgba8Color(packedColors, 1, '#A0B0C0');
assert.deepEqual(Array.from(packedColors), [
  0x10,
  0x20,
  0x30,
  0xff,
  0xa0,
  0xb0,
  0xc0,
  0xff,
]);
assert.deepEqual(Array.from(buffers.shape), [
  FAST_SCATTER_SHAPE_CODES.circle,
  FAST_SCATTER_SHAPE_CODES.arrow,
]);
assert.equal(buffers.colorFormat, 'rgba8');
assert.equal(buffers.opacity[0], 0);
assert.equal(buffers.size[0], 0);
assert.equal(buffers.rotationDegrees[0], 90);
assertApproximatelyEqual(buffers.rotationRadians[0], Math.PI / 2);
assert.equal(buffers.rotationDegrees[1], 0);
assert.equal(buffers.rotationRadians[1], 0);
assert.equal(buffers.rotation, buffers.rotationRadians);
assert.equal(buffers.metrics.recordCount, 2);
assert.equal(buffers.metrics.yKeyCount, 3);
assert.equal(buffers.metrics.byteLength, 114);
assert.equal(buffers.metrics.buildMs >= 0, true);

const emptyBuffers = createFastScatterBuffersFromDataset(makeDataset([]));
assert.equal(emptyBuffers.recordCount, 0);
assert.deepEqual(Array.from(emptyBuffers.x), []);
assert.deepEqual(Object.keys(emptyBuffers.y), ['a', 'b', 'c']);
assert.equal(emptyBuffers.metrics.byteLength, 0);

assert.throws(
  () =>
    createFastScatterBuffersFromDataset(
      makeDataset([
        { ...dataset.records[0], id: 'first', x: 2 },
        { ...dataset.records[1], id: 'second', x: 1 },
      ]),
    ),
  /sorted by nondecreasing x/,
);

const allShapes = createFastScatterBuffers(
  [
    makeGenericRecord('circle', 0),
    makeGenericRecord('rectangle', 1),
    makeGenericRecord('triangle', 2),
    makeGenericRecord('pin', 3),
    makeGenericRecord('arrow', 4),
  ],
  {
    yAccessors: {
      y: (record) => record.y,
    },
  },
);
assert.deepEqual(Array.from(allShapes.shape), [0, 1, 2, 3, 4]);
assert.deepEqual(Array.from(allShapes.y.y), [0, 1, 2, 3, 4]);

const clamped = createFastScatterBuffersFromDataset(
  makeDataset([
    {
      ...dataset.records[0],
      opacity: -1,
      rotation: 999,
      size: 99,
    },
    {
      ...dataset.records[1],
      opacity: 2,
      rotation: -10,
      size: -10,
    },
  ]),
);
assert.deepEqual(Array.from(clamped.opacity), [
  SCATTER_STYLE_LIMITS.opacity.min,
  SCATTER_STYLE_LIMITS.opacity.max,
]);
assert.deepEqual(Array.from(clamped.size), [
  SCATTER_STYLE_LIMITS.size.max,
  SCATTER_STYLE_LIMITS.size.min,
]);
assert.deepEqual(Array.from(clamped.rotationDegrees), [
  0,
  SCATTER_STYLE_LIMITS.rotation.min,
]);
assert.equal(clamped.rotationRadians[0], 0);
assert.equal(clamped.rotationRadians[1], 0);
assert.equal(normalizeRotationDegrees(360), 0);
assert.equal(normalizeRotationDegrees(450), 90);
assert.equal(normalizeRotationDegrees(-90), 270);
assert.equal(normalizeRotationRadians(Math.PI * 2), 0);
assertApproximatelyEqual(normalizeRotationRadians(Math.PI * 2.5), Math.PI / 2);
assertApproximatelyEqual(normalizeRotationRadians(-Math.PI / 2), Math.PI * 1.5);

assert.throws(
  () =>
    createFastScatterBuffers([makeGenericRecord('circle', 0, '#abc')], {
      yAccessors: {
        y: (record) => record.y,
      },
    }),
  /#RRGGBB/,
);

function makeDataset(records: ScatterDataset['records']): ScatterDataset {
  return {
    metadata: {
      attributes: {
        category: 'category',
        id: 'id',
        styleGroup: 'styleGroup',
        x: 'x',
        y: ['a', 'b', 'c'],
        color: 'color',
        opacity: 'opacity',
        rotation: 'rotation',
        size: 'size',
        shape: 'shape',
      },
      categories: ['core', 'north', 'south', 'anomaly'],
      count: records.length,
      createdAt: '2026-01-01T00:00:00.000Z',
      seed: 1,
      styleGroups: [
        'default',
        'accent',
        'muted',
        'highlight',
        'low-opacity',
        'large',
      ],
      styles: {
        color: {
          attribute: 'color',
          format: '#RRGGBB',
        },
        opacity: {
          attribute: 'opacity',
          ...SCATTER_STYLE_LIMITS.opacity,
        },
        rotation: {
          attribute: 'rotation',
          nullable: true,
          ...SCATTER_STYLE_LIMITS.rotation,
        },
        size: {
          attribute: 'size',
          ...SCATTER_STYLE_LIMITS.size,
        },
        shape: {
          attribute: 'shape',
          values: ['circle', 'rectangle', 'triangle', 'pin', 'arrow'],
        },
      },
    },
    records,
  };
}

function makeGenericRecord(
  shape: 'circle' | 'rectangle' | 'triangle' | 'pin' | 'arrow',
  y: number,
  color = '#000000',
) {
  return {
    color,
    id: shape,
    opacity: 1,
    rotation: 0,
    shape,
    size: 4,
    x: y,
    y,
  };
}

function assertApproximatelyEqual(
  actual: number,
  expected: number,
  epsilon = 0.000001,
): void {
  assert.equal(
    Math.abs(actual - expected) <= epsilon,
    true,
    `${actual} should be within ${epsilon} of ${expected}`,
  );
}
