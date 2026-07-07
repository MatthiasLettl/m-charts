import assert from 'node:assert/strict';

import {
  createHistogramAxisTicks,
  formatHistogramAxisValue,
  formatHistogramBinLabel,
  formatHistogramBinRange,
  type HistogramParameterSpec,
} from '../../packages/m-charts/src/m-histogram/core/index.ts';

const numericParameter: HistogramParameterSpec = {
  key: 'temperature',
  kind: 'numeric',
  label: 'Temperature',
  unit: 'C',
};

const booleanParameter: HistogramParameterSpec = {
  categories: [
    { encoded: 0, label: 'Off', value: false },
    { encoded: 1, label: 'On', value: true },
  ],
  key: 'active',
  kind: 'boolean',
  label: 'Active',
};

const datetimeParameter: HistogramParameterSpec = {
  datetimeOriginNs: '1710000000000000000',
  key: 'timestamp',
  kind: 'datetime-ns',
  label: 'Timestamp',
};

assert.deepEqual(
  createHistogramAxisTicks(booleanParameter, { max: 1.5, min: -0.5 }),
  [
    { label: 'false', value: 0 },
    { label: 'true', value: 1 },
  ],
);

assert.equal(formatHistogramAxisValue(numericParameter, 12.5), '12.5 C');
assert.equal(formatHistogramAxisValue(booleanParameter, 0), 'false');
assert.match(
  formatHistogramAxisValue(datetimeParameter, 0),
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
);

assert.equal(
  formatHistogramBinLabel(booleanParameter, {
    category: { encoded: 1, label: 'On', value: true },
    center: 1,
    index: 1,
    max: 1.5,
    min: 0.5,
    parameterKey: 'active',
    subplotId: 'active',
  }),
  'true',
);

assert.equal(
  formatHistogramBinRange(numericParameter, {
    center: 2,
    index: 0,
    max: 4,
    min: 0,
    parameterKey: 'temperature',
    subplotId: 'temperature',
  }),
  '0.00 C to 4.00 C',
);

console.log('histogram-fast axis display tests passed');
