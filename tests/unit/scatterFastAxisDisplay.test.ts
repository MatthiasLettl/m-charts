import assert from 'node:assert/strict';

import {
  createFastScatterMeasurementDisplayFields,
  createFastScatterPointDisplayFields,
  createFastScatterSourceDisplayFields,
  encodeFastScatterSchemaRows,
  formatFastScatterAxisDeltaForDisplay,
  formatFastScatterFormattedPointValueForDisplay,
  formatFastScatterPointForDisplay,
  type FastScatterDatasetSchema,
  type FastScatterPointRef,
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
      id: 'row-0',
      stage: 'warmup',
      time: '1717200000000000000',
      value: 10,
    },
    {
      flag: true,
      id: 'row-1',
      stage: 'steady',
      time: '1717200000500000123',
      value: 25.25,
    },
  ],
  schema,
);

const point: FastScatterPointRef = {
  id: 'row-1',
  plotId: 'stage',
  sourceIndex: 1,
  x: encoded.columns.x[1]!,
  y: encoded.columns.y.stage![1]!,
  yKey: 'stage',
};
const display = formatFastScatterPointForDisplay(point, encoded.columns);

assert.equal(display.x.label, '2024-06-01T00:00:00.500000123 UTC');
assert.equal(display.x.sourceValue, '1717200000500000123 ns');
assert.equal(display.y.label, 'Steady');

const booleanPoint: FastScatterPointRef = {
  id: 'row-1',
  plotId: 'flag',
  sourceIndex: 1,
  x: encoded.columns.x[1]!,
  y: encoded.columns.y.flag![1]!,
  yKey: 'flag',
};
const booleanDisplay = formatFastScatterPointForDisplay(
  booleanPoint,
  encoded.columns,
);

assert.equal(booleanDisplay.y.label, 'true');
assert.equal(
  formatFastScatterFormattedPointValueForDisplay(display.x),
  '2024-06-01T00:00:00.500000123 UTC (1717200000500000123 ns)',
);
assert.deepEqual(
  createFastScatterPointDisplayFields({
    activeYKey: 'stage',
    display,
  }),
  [
    {
      active: false,
      key: 'x',
      label: 'x',
      value: '2024-06-01T00:00:00.500000123 UTC (1717200000500000123 ns)',
    },
    {
      active: true,
      key: 'stage',
      label: 'stage',
      value: 'Steady',
    },
  ],
);
assert.deepEqual(
  createFastScatterSourceDisplayFields({
    activeYKey: 'flag',
    columns: encoded.columns,
    sourceIndex: 1,
    spec: {
      xLabel: 'Time',
      plots: [
        { id: 'stage', label: 'Stage', yKey: 'stage' },
        { id: 'flag', label: 'Accepted', yKey: 'flag' },
        { id: 'value', label: 'Value', yKey: 'value' },
      ],
    },
  }),
  [
    {
      active: false,
      key: 'x',
      label: 'Time',
      value: '2024-06-01T00:00:00.500000123 UTC (1717200000500000123 ns)',
    },
    {
      active: false,
      key: 'stage',
      label: 'Stage',
      value: 'Steady',
    },
    {
      active: true,
      key: 'flag',
      label: 'Accepted',
      value: 'true',
    },
    {
      active: false,
      key: 'value',
      label: 'Value',
      value: '25.3 ms',
    },
  ],
);
assert.deepEqual(
  createFastScatterMeasurementDisplayFields({
    activeYKey: 'value',
    columns: encoded.columns,
    currentSourceIndex: 1,
    referenceSourceIndex: 0,
    spec: {
      xLabel: 'Time',
      plots: [
        { id: 'stage', label: 'Stage', yKey: 'stage' },
        { id: 'flag', label: 'Accepted', yKey: 'flag' },
        { id: 'value', label: 'Value', yKey: 'value' },
      ],
    },
  }),
  [
    {
      active: false,
      delta: '+500.0 ms',
      key: 'x',
      label: 'Time',
      value: '2024-06-01T00:00:00.500000123 UTC (1717200000500000123 ns)',
    },
    {
      active: false,
      delta: 'Warmup -> Steady',
      key: 'stage',
      label: 'Stage',
      value: 'Steady',
    },
    {
      active: false,
      delta: 'false -> true',
      key: 'flag',
      label: 'Accepted',
      value: 'true',
    },
    {
      active: true,
      delta: '+15.3 ms',
      key: 'value',
      label: 'Value',
      value: '25.3 ms',
    },
  ],
);

assert.equal(
  formatFastScatterAxisDeltaForDisplay({
    axis: encoded.columns.axisByColumn.time,
    fromEncodedValue: encoded.columns.x[0]!,
    fromSourceIndex: 0,
    toEncodedValue: encoded.columns.x[1]!,
    toSourceIndex: 1,
  }),
  '+500.0 ms',
);
assert.equal(
  formatFastScatterAxisDeltaForDisplay({
    axis: encoded.columns.axisByColumn.time,
    fromEncodedValue: encoded.columns.x[1]!,
    fromSourceIndex: 1,
    toEncodedValue: encoded.columns.x[0]!,
    toSourceIndex: 0,
  }),
  '-500.0 ms',
);
assert.equal(
  formatFastScatterAxisDeltaForDisplay({
    axis: encoded.columns.axisByColumn.stage,
    fromEncodedValue: encoded.columns.y.stage![0]!,
    fromSourceIndex: 0,
    toEncodedValue: encoded.columns.y.stage![1]!,
    toSourceIndex: 1,
  }),
  'Warmup -> Steady',
);
assert.equal(
  formatFastScatterAxisDeltaForDisplay({
    axis: encoded.columns.axisByColumn.stage,
    fromEncodedValue: encoded.columns.y.stage![1]!,
    fromSourceIndex: 1,
    toEncodedValue: encoded.columns.y.stage![1]!,
    toSourceIndex: 1,
  }),
  'unchanged Steady',
);
assert.equal(
  formatFastScatterAxisDeltaForDisplay({
    axis: encoded.columns.axisByColumn.flag,
    fromEncodedValue: encoded.columns.y.flag![1]!,
    fromSourceIndex: 1,
    toEncodedValue: encoded.columns.y.flag![1]!,
    toSourceIndex: 1,
  }),
  'unchanged true',
);
assert.equal(
  formatFastScatterAxisDeltaForDisplay({
    axis: encoded.columns.axisByColumn.flag,
    fromEncodedValue: encoded.columns.y.flag![0]!,
    fromSourceIndex: 0,
    toEncodedValue: encoded.columns.y.flag![1]!,
    toSourceIndex: 1,
  }),
  'false -> true',
);
assert.equal(
  formatFastScatterAxisDeltaForDisplay({
    axis: encoded.columns.axisByColumn.value,
    fromEncodedValue: encoded.columns.y.value![0]!,
    fromSourceIndex: 0,
    toEncodedValue: encoded.columns.y.value![1]!,
    toSourceIndex: 1,
  }),
  '+15.3 ms',
);

console.log('scatter-fast axis display tests passed');
