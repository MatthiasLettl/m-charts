import assert from 'node:assert/strict';

import {
  createAxisTitle,
  encodeFastScatterSchemaRows,
  FAST_SCATTER_SHAPE_CODES,
  type FastScatterDatasetSchema,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

const schema: FastScatterDatasetSchema = {
  version: 1,
  columns: [
    { key: 'id', role: 'id' },
    {
      axisType: 'datetime-ns',
      key: 'time',
      parameterName: 'Timestamp',
      role: 'x',
      unit: 'UTC',
    },
    {
      axisType: 'categorical',
      categories: [
        { label: 'Beta', order: 1, value: 'beta' },
        { label: 'Alpha', order: 0, value: 'alpha' },
      ],
      key: 'stage',
      parameterName: 'Stage',
    },
    {
      axisType: 'boolean',
      categories: [
        { label: 'Off', value: false },
        { label: 'On', value: true },
      ],
      key: 'enabled',
      parameterName: 'Enabled',
    },
    {
      axisType: 'numeric',
      key: 'score',
      parameterName: 'Score',
      unit: 'ms',
    },
    { key: 'color', role: 'style' },
    { key: 'opacity', role: 'style' },
    { key: 'rotation', role: 'style', unit: 'deg' },
    { key: 'size', role: 'style', unit: 'px' },
    { key: 'shape', role: 'style' },
  ],
  plots: [
    { id: 'stage', y: { column: 'stage' } },
    { id: 'enabled', y: { column: 'enabled' } },
    { id: 'score', y: { column: 'score' } },
  ],
  x: { column: 'time' },
};

const encoded = encodeFastScatterSchemaRows(
  [
    {
      color: '#112233',
      enabled: false,
      id: 'a',
      opacity: 0.4,
      rotation: 90,
      score: 10,
      shape: 'circle',
      size: 3.5,
      stage: 'alpha',
      time: '1717200000000000000',
    },
    {
      color: '#aabbcc',
      enabled: true,
      id: 'b',
      opacity: 0.75,
      rotation: 450,
      score: 25,
      shape: 'triangle',
      size: 5,
      stage: 'beta',
      time: '1717200001000000000',
    },
    {
      color: '#dc2626',
      enabled: true,
      id: 'c',
      opacity: 0.9,
      rotation: null,
      score: 15,
      shape: 'arrow',
      size: 6.25,
      stage: 'gamma',
      time: '1717200002500000000',
    },
    {
      color: '#7c3aed',
      enabled: false,
      id: 'd',
      opacity: 1,
      rotation: 0,
      score: 20,
      shape: 'pin',
      size: 7,
      stage: 'alpha',
      time: '1717200003000000000',
    },
  ],
  schema,
);

assert.deepEqual(encoded.columns.ids, ['a', 'b', 'c', 'd']);
assert.deepEqual(Array.from(encoded.columns.sourceIndex), [0, 1, 2, 3]);
assert.deepEqual(Array.from(encoded.columns.x), [0, 1000, 2500, 3000]);
assert.deepEqual(Array.from(encoded.columns.y.stage), [0, 1, 2, 0]);
assert.deepEqual(Array.from(encoded.columns.y.enabled), [0, 1, 1, 0]);
assert.deepEqual(Array.from(encoded.columns.y.score), [10, 25, 15, 20]);
assert.equal(encoded.columns.colorFormat, 'rgba8');
assert.deepEqual(Array.from(encoded.columns.color ?? []), [
  0x11,
  0x22,
  0x33,
  0xff,
  0xaa,
  0xbb,
  0xcc,
  0xff,
  0xdc,
  0x26,
  0x26,
  0xff,
  0x7c,
  0x3a,
  0xed,
  0xff,
]);
assertApproximatelyEqual(encoded.columns.opacity?.[0] ?? -1, 0.4);
assertApproximatelyEqual(encoded.columns.opacity?.[1] ?? -1, 0.75);
assertApproximatelyEqual(encoded.columns.opacity?.[2] ?? -1, 0.9);
assertApproximatelyEqual(encoded.columns.opacity?.[3] ?? -1, 1);
assert.deepEqual(Array.from(encoded.columns.size ?? []), [3.5, 5, 6.25, 7]);
assert.deepEqual(Array.from(encoded.columns.rotationDegrees ?? []), [90, 90, 0, 0]);
assertApproximatelyEqual(encoded.columns.rotationRadians?.[0] ?? -1, Math.PI / 2);
assertApproximatelyEqual(encoded.columns.rotationRadians?.[1] ?? -1, Math.PI / 2);
assert.equal(encoded.columns.rotation, encoded.columns.rotationRadians);
assert.deepEqual(Array.from(encoded.columns.shape ?? []), [
  FAST_SCATTER_SHAPE_CODES.circle,
  FAST_SCATTER_SHAPE_CODES.triangle,
  FAST_SCATTER_SHAPE_CODES.arrow,
  FAST_SCATTER_SHAPE_CODES.pin,
]);
assert.equal(encoded.spec.xLabel, 'Timestamp (UTC)');
assert.deepEqual(
  encoded.spec.plots.map((plot) => [plot.id, plot.label, plot.yKey]),
  [
    ['stage', 'Stage', 'stage'],
    ['enabled', 'Enabled', 'enabled'],
    ['score', 'Score (ms)', 'score'],
  ],
);

const timeAxis = encoded.columns.axisByColumn.time;
assert.equal(timeAxis.kind, 'datetime-ns');
if (timeAxis.kind === 'datetime-ns') {
  assert.equal(timeAxis.datetimeOriginNs, '1717200000000000000');
  assert.deepEqual(timeAxis.epochNsValues, [
    '1717200000000000000',
    '1717200001000000000',
    '1717200002500000000',
    '1717200003000000000',
  ]);
  assert.deepEqual(timeAxis.domain, { max: 3000, min: 0 });
}

const stageAxis = encoded.columns.axisByColumn.stage;
assert.equal(stageAxis.kind, 'categorical');
if (stageAxis.kind === 'categorical') {
  assert.deepEqual(stageAxis.categories, [
    { encoded: 0, label: 'Alpha', value: 'alpha' },
    { encoded: 1, label: 'Beta', value: 'beta' },
    { encoded: 2, label: 'gamma', value: 'gamma' },
  ]);
}

const booleanAxis = encoded.columns.axisByColumn.enabled;
assert.equal(booleanAxis.kind, 'boolean');
if (booleanAxis.kind === 'boolean') {
  assert.deepEqual(booleanAxis.categories, [
    { encoded: 0, label: 'Off', value: 'false' },
    { encoded: 1, label: 'On', value: 'true' },
  ]);
  assert.deepEqual(booleanAxis.domain, { max: 1, min: 0 });
}

const scoreAxis = encoded.columns.axisByColumn.score;
assert.equal(scoreAxis.kind, 'numeric');
assert.deepEqual(scoreAxis.domain, { max: 25, min: 10 });

const safeNumericTimestamp = encodeFastScatterSchemaRows(
  [{ t: 1_000_000 }, { t: 2_000_000 }],
  {
    columns: [{ axisType: 'datetime-ns', key: 't' }],
    plots: [],
    version: 1,
    x: { column: 't' },
  },
);
assert.deepEqual(Array.from(safeNumericTimestamp.columns.x), [0, 1]);

assert.throws(
  () =>
    encodeFastScatterSchemaRows([{ t: 9_007_199_254_740_992 }], {
      columns: [{ axisType: 'datetime-ns', key: 't' }],
      plots: [],
      version: 1,
      x: { column: 't' },
    }),
  /nanosecond timestamp string or safe integer/,
);
assert.throws(
  () =>
    encodeFastScatterSchemaRows([{ flag: 'true' }], {
      columns: [{ axisType: 'boolean', key: 'flag' }],
      plots: [{ id: 'flag', y: { column: 'flag' } }],
      version: 1,
      x: { column: 'flag' },
    }),
  /must be boolean/,
);
assert.equal(
  createAxisTitle({ key: 'signalValue', parameterName: 'Signal value', unit: 'a.u.' }),
  'Signal value (a.u.)',
);

console.log('scatter-fast axis schema tests passed');

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
