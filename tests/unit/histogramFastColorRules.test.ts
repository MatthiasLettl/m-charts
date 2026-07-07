import assert from 'node:assert/strict';

import type {
  HistogramAggregationSet,
  HistogramColumns,
} from '../../packages/m-charts/src/m-histogram/core/index.ts';
import {
  applyHistogramAggregationColorRules,
  applyHistogramColorRules,
} from '../../packages/m-charts/src/m-histogram/react/colorRules.ts';

const columns: HistogramColumns = {
  color: new Uint8Array([
    1, 2, 3, 255,
    4, 5, 6, 255,
    7, 8, 9, 255,
  ]),
  colorFormat: 'rgba8',
  ids: ['a', 'b', 'c'],
  valuesByParameter: {
    accepted: [false, true, true],
    temp: new Float64Array([0, 5, 10]),
  },
};

const fixed = applyHistogramColorRules(columns, [
  {
    color: '#112233',
    id: 'fixed',
    kind: 'fixed',
    parameterKey: 'temp',
    range: { max: 6, min: 4 },
  },
]);

assert.deepEqual(Array.from(fixed?.color ?? []), [
  1, 2, 3, 255,
  17, 34, 51, 255,
  7, 8, 9, 255,
]);
assert.equal(fixed?.colorFormat, 'rgba8');

const booleanRule = applyHistogramColorRules(columns, [
  {
    color: '#AA5500',
    id: 'boolean',
    kind: 'fixed',
    parameterKey: 'accepted',
    range: { max: 1, min: 1 },
  },
]);

assert.deepEqual(Array.from(booleanRule?.color ?? []), [
  1, 2, 3, 255,
  170, 85, 0, 255,
  170, 85, 0, 255,
]);

const gradient = applyHistogramColorRules(columns, [
  {
    endColor: '#ffffff',
    id: 'gradient',
    kind: 'gradient',
    parameterKey: 'temp',
    range: { max: 10, min: 0 },
    startColor: '#000000',
  },
]);

assert.deepEqual(Array.from(gradient?.color ?? []), [
  0, 0, 0, 255,
  128, 128, 128, 255,
  255, 255, 255, 255,
]);

const aggregation: HistogramAggregationSet = {
  metrics: {
    binCount: 2,
    colorSegmentCount: 2,
    excludedValueCount: 0,
    invalidValueCount: 0,
    missingValueCount: 0,
    outOfDomainValueCount: 0,
    sourceIndexCount: 0,
    totalCount: 4,
  },
  mode: 'bar',
  pointCount: 4,
  subplots: [
    {
      binCount: 2,
      bins: [
        {
          descriptor: {
            center: 2,
            index: 0,
            max: 4,
            min: 0,
            parameterKey: 'temp',
            subplotId: 'temp',
          },
          stack: [{ color: 0x010203ff, count: 2, endCount: 2, startCount: 0 }],
          totalCount: 2,
        },
        {
          descriptor: {
            center: 7,
            index: 1,
            max: 10,
            min: 4,
            parameterKey: 'temp',
            subplotId: 'temp',
          },
          stack: [{ color: 0x040506ff, count: 2, endCount: 2, startCount: 0 }],
          totalCount: 2,
        },
      ],
      dataMode: 'bar',
      parameterKey: 'temp',
      sourceIndicesAvailable: false,
      subplotId: 'temp',
    },
  ],
};

const recoloredAggregation = applyHistogramAggregationColorRules(aggregation, [
  {
    color: '#336699',
    id: 'bar',
    kind: 'fixed',
    parameterKey: 'temp',
    range: { max: 10, min: 5 },
  },
]);

assert.equal(
  recoloredAggregation?.subplots[0]?.bins[0]?.stack[0]?.color,
  0x010203ff,
);
assert.equal(
  recoloredAggregation?.subplots[0]?.bins[1]?.stack[0]?.color,
  0x336699ff,
);

const descriptorScopedAggregation = applyHistogramAggregationColorRules(aggregation, [
  {
    binDescriptors: [
      {
        center: 2,
        index: 0,
        max: 4,
        min: 0,
        parameterKey: 'temp',
        subplotId: 'temp',
      },
    ],
    color: '#cc5500',
    id: 'bar-exact-bin',
    kind: 'fixed',
    parameterKey: 'temp',
    range: { max: 10, min: 0 },
  },
]);

assert.equal(
  descriptorScopedAggregation?.subplots[0]?.bins[0]?.stack[0]?.color,
  0xcc5500ff,
);
assert.equal(
  descriptorScopedAggregation?.subplots[0]?.bins[1]?.stack[0]?.color,
  0x040506ff,
);

console.log('histogram-fast color rule tests passed');
