import assert from 'node:assert/strict';

import { SCATTER_STYLE_LIMITS, type ScatterDataset } from '../../apps/demo/src/data/types.ts';
import { adaptScatterDatasetForFastScatter } from '../../packages/m-charts/src/m-scatter/adapters/scatterDataset.ts';
import { FAST_SCATTER_SHAPE_CODES } from '../../packages/m-charts/src/m-scatter/core/index.ts';

const dataset: ScatterDataset = {
  metadata: {
    attributes: {
      category: 'category',
      color: 'color',
      id: 'id',
      opacity: 'opacity',
      rotation: 'rotation',
      shape: 'shape',
      size: 'size',
      styleGroup: 'styleGroup',
      x: 'x',
      y: ['a', 'b', 'c'],
    },
    categories: ['core', 'north', 'south', 'anomaly'],
    count: 3,
    createdAt: '2026-05-16T00:00:00.000Z',
    seed: 7,
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
      shape: {
        attribute: 'shape',
        values: ['circle', 'rectangle', 'triangle', 'pin', 'arrow'],
      },
      size: {
        attribute: 'size',
        ...SCATTER_STYLE_LIMITS.size,
      },
    },
  },
  records: [
    {
      a: 10,
      b: 20,
      c: 30,
      category: 'core',
      color: '#102030',
      id: 'source-alpha',
      opacity: 0,
      rotation: 0,
      shape: 'circle',
      size: 0,
      styleGroup: 'default',
      x: 1,
    },
    {
      a: 11,
      b: 21,
      c: 31,
      category: 'north',
      color: '#405060',
      id: 'source-bravo',
      opacity: 0.75,
      rotation: 180,
      shape: 'triangle',
      size: 6,
      styleGroup: 'accent',
      x: 2,
    },
    {
      a: 12,
      b: 22,
      c: 32,
      category: 'south',
      color: '#708090',
      id: 'source-charlie',
      opacity: 1,
      rotation: 360,
      shape: 'pin',
      size: 24,
      styleGroup: 'large',
      x: 3,
    },
  ],
};

const adapted = adaptScatterDatasetForFastScatter(dataset);

assert.deepEqual(adapted.columns.ids, [
  'source-alpha',
  'source-bravo',
  'source-charlie',
]);
assert.deepEqual(Array.from(adapted.columns.sourceIndex), [0, 1, 2]);
assert.deepEqual(Array.from(adapted.columns.x), [1, 2, 3]);
assert.deepEqual(Array.from(adapted.columns.y.a), [10, 11, 12]);
assert.deepEqual(Array.from(adapted.columns.y.b), [20, 21, 22]);
assert.deepEqual(Array.from(adapted.columns.y.c), [30, 31, 32]);

assert.equal(adapted.columns.colorFormat, 'rgba8');
assert.deepEqual(Array.from(adapted.columns.color), [
  0x10,
  0x20,
  0x30,
  0xff,
  0x40,
  0x50,
  0x60,
  0xff,
  0x70,
  0x80,
  0x90,
  0xff,
]);
assert.deepEqual(Array.from(adapted.columns.opacity), [0, 0.75, 1]);
assert.deepEqual(Array.from(adapted.columns.size), [0, 6, 24]);
assert.deepEqual(Array.from(adapted.columns.rotationDegrees), [0, 180, 0]);
assert.equal(adapted.columns.rotationRadians[0], 0);
assertApproximatelyEqual(adapted.columns.rotationRadians[1] ?? 0, Math.PI);
assert.equal(adapted.columns.rotationRadians[2], 0);
assert.equal(adapted.columns.rotation, adapted.columns.rotationRadians);
assert.deepEqual(Array.from(adapted.columns.shape), [
  FAST_SCATTER_SHAPE_CODES.circle,
  FAST_SCATTER_SHAPE_CODES.triangle,
  FAST_SCATTER_SHAPE_CODES.pin,
]);

assert.deepEqual(adapted.spec, {
  xLabel: 'x',
  plots: [
    { id: 'a', label: 'Metric A', yKey: 'a' },
    { id: 'b', label: 'Metric B', yKey: 'b' },
    { id: 'c', label: 'Metric C', yKey: 'c' },
  ],
});

assert.deepEqual(adapted.metadata, {
  attributes: dataset.metadata.attributes,
  categories: dataset.metadata.categories,
  count: 3,
  createdAt: '2026-05-16T00:00:00.000Z',
  seed: 7,
  styleGroups: dataset.metadata.styleGroups,
  styles: dataset.metadata.styles,
});
assert.equal(adapted.columns.metrics.recordCount, adapted.metadata.count);
assert.equal(adapted.columns.metrics.yKeyCount, adapted.spec.plots.length);

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
