import assert from 'node:assert/strict';

import {
  createFastScatterDatetimeTickContext,
  createFastScatterAxisTicks,
  encodeFastScatterSchemaRows,
  formatFastScatterAxisValue,
  type FastScatterDatasetSchema,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

const schema: FastScatterDatasetSchema = {
  columns: [
    { axisType: 'datetime-ns', key: 'time', parameterName: 'Time' },
    {
      axisType: 'categorical',
      categories: [
        { label: 'Warmup', value: 'warmup' },
        { label: 'Steady', value: 'steady' },
      ],
      key: 'stage',
    },
    {
      axisType: 'boolean',
      categories: [
        { label: 'No', value: false },
        { label: 'Yes', value: true },
      ],
      key: 'flag',
    },
    { axisType: 'numeric', key: 'value', unit: 'ms' },
  ],
  plots: [
    { id: 'stage', y: { column: 'stage' } },
    { id: 'flag', y: { column: 'flag' } },
    { id: 'value', y: { column: 'value' } },
  ],
  version: 1,
  x: { column: 'time' },
};

const encoded = encodeFastScatterSchemaRows(
  [
    {
      flag: false,
      stage: 'warmup',
      time: '1717200000000000000',
      value: 0,
    },
    {
      flag: true,
      stage: 'steady',
      time: '1717200000500000000',
      value: 50,
    },
    {
      flag: true,
      stage: 'cooldown',
      time: '1717200001000000123',
      value: 100,
    },
  ],
  schema,
);

const numericTicks = createFastScatterAxisTicks(encoded.columns.axisByColumn.value, {
  count: 3,
  range: { max: 100, min: 0 },
});
assert.deepEqual(numericTicks, [
  { label: '0.00 ms', value: 0 },
  { label: '50.0 ms', value: 50 },
  { label: '100.0 ms', value: 100 },
]);
assert.equal(formatFastScatterAxisValue(encoded.columns.axisByColumn.value, 12.345), '12.3 ms');
const scaledNumericAxis = {
  ...encoded.columns.axisByColumn.value!,
  encodedScale: 0.0025,
};
assert.equal(formatFastScatterAxisValue(scaledNumericAxis, 400), '1.00 ms');

const categoricalTicks = createFastScatterAxisTicks(encoded.columns.axisByColumn.stage, {
  range: { max: 2, min: 0 },
});
assert.deepEqual(categoricalTicks, [
  { label: 'Warmup', value: 0 },
  { label: 'Steady', value: 1 },
  { label: 'cooldown', value: 2 },
]);
assert.equal(formatFastScatterAxisValue(encoded.columns.axisByColumn.stage, 1), 'Steady');

const booleanTicks = createFastScatterAxisTicks(encoded.columns.axisByColumn.flag, {
  range: { max: 1, min: 0 },
});
assert.deepEqual(booleanTicks, [
  { label: 'false', value: 0 },
  { label: 'true', value: 1 },
]);
assert.equal(formatFastScatterAxisValue(encoded.columns.axisByColumn.flag, 0), 'false');
assert.equal(formatFastScatterAxisValue(encoded.columns.axisByColumn.flag, 1), 'true');

const datetimeTicks = createFastScatterAxisTicks(encoded.columns.axisByColumn.time, {
  count: 3,
  range: { max: 500, min: 0 },
});
const scaledDatetimeAxis = {
  ...encoded.columns.axisByColumn.time!,
  encodedScaleMs: 250,
};
assert.equal(
  formatFastScatterAxisValue(scaledDatetimeAxis, 2),
  formatFastScatterAxisValue(encoded.columns.axisByColumn.time, 500),
);
assert.deepEqual(
  datetimeTicks.map((tick) => tick.label),
  ['00:00:00', '00:00:00.25', '00:00:00.5'],
);

const multiDayDatetimeTicks = createFastScatterAxisTicks(encoded.columns.axisByColumn.time, {
  count: 3,
  range: { max: 172_800_000, min: 0 },
});
assert.deepEqual(
  multiDayDatetimeTicks.map((tick) => tick.label),
  ['2024-06-01', '2024-06-02', '2024-06-03'],
);
assert.deepEqual(
  createFastScatterDatetimeTickContext(encoded.columns.axisByColumn.time, {
    count: 3,
    range: { max: 172_800_000, min: 0 },
  }),
  {},
);

const sameDayMultiHourDatetimeTicks = createFastScatterAxisTicks(
  encoded.columns.axisByColumn.time,
  {
    count: 3,
    range: { max: 10_800_000, min: 0 },
  },
);
assert.deepEqual(
  sameDayMultiHourDatetimeTicks.map((tick) => tick.label),
  ['00:00', '01:30', '03:00'],
);
assert.deepEqual(
  createFastScatterDatetimeTickContext(encoded.columns.axisByColumn.time, {
    count: 3,
    range: { max: 10_800_000, min: 0 },
  }),
  { sharedDateLabel: '2024-06-01 UTC' },
);

const minuteLevelDatetimeTicks = createFastScatterAxisTicks(
  encoded.columns.axisByColumn.time,
  {
    count: 3,
    range: { max: 120_000, min: 0 },
  },
);
assert.deepEqual(
  minuteLevelDatetimeTicks.map((tick) => tick.label),
  ['00:00:00', '00:01:00', '00:02:00'],
);

const secondLevelDatetimeTicks = createFastScatterAxisTicks(
  encoded.columns.axisByColumn.time,
  {
    count: 3,
    range: { max: 2000, min: 0 },
  },
);
assert.deepEqual(
  secondLevelDatetimeTicks.map((tick) => tick.label),
  ['00:00:00', '00:00:01', '00:00:02'],
);

const subSecondDatetimeTicks = createFastScatterAxisTicks(
  encoded.columns.axisByColumn.time,
  {
    count: 3,
    range: { max: 500, min: 0 },
  },
);
assert.deepEqual(
  subSecondDatetimeTicks.map((tick) => tick.label),
  [
    '00:00:00',
    '00:00:00.25',
    '00:00:00.5',
  ],
);
assert.equal(
  formatFastScatterAxisValue(encoded.columns.axisByColumn.time, 1000.000123),
  '2024-06-01T00:00:01.000000123 UTC',
);

console.log('scatter-fast axis tick tests passed');
