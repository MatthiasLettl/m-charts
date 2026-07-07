import assert from 'node:assert/strict';

import {
  MIXED_TABLE_AXES,
  type MixedTableFixture,
  type MixedTableRecord,
} from '../../apps/demo/src/data/mixedTableFixtures.ts';
import {
  adaptHistogramBarDemoPayload,
  adaptMixedTablesForHistogram,
  adaptScatterEncodedColumnsForHistogram,
  adaptScatterFastBenchmarkSourceForHistogram,
} from '../../packages/m-charts/src/m-histogram/adapters/index.ts';
import { buildHistogramAggregation } from '../../packages/m-charts/src/m-histogram/core/index.ts';
import type {
  FastScatterEncodedAxis,
  FastScatterEncodedSchemaColumns,
  FastScatterPlotSpec,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

const singleTableColumns = createSingleTableEncodedColumns();
const singleTableSpec: FastScatterPlotSpec = {
  plots: [
    { id: 'signalValue', label: 'Signal value', yKey: 'signalValue' },
    { id: 'phase', label: 'Process phase', yKey: 'phase' },
    { id: 'accepted', label: 'Acceptance', yKey: 'accepted' },
  ],
  xLabel: 'Timestamp (UTC)',
};

const singleTable = adaptScatterFastBenchmarkSourceForHistogram({
  columns: singleTableColumns,
  spec: singleTableSpec,
  tableName: 'benchmark-primary',
});

assert.equal(singleTable.spec.mode, 'histogram');
assert.deepEqual(
  singleTable.spec.parameters.map((parameter) => parameter.key),
  ['timestampNs', 'signalValue', 'phase', 'accepted'],
);
assert.equal(singleTable.spec.parameters.find((parameter) => parameter.key === 'timestampNs')?.kind, 'datetime-ns');
assert.equal(singleTable.spec.parameters.find((parameter) => parameter.key === 'phase')?.kind, 'categorical');
assert.equal(singleTable.spec.parameters.find((parameter) => parameter.key === 'accepted')?.kind, 'boolean');
assert.equal(singleTable.spec.subplots.length, 4);
assert.equal(singleTable.columns.valuesByParameter.table, undefined);
assert.equal(singleTable.columns.valuesByParameter.opacity, undefined);
assert.equal(singleTable.columns.color, singleTableColumns.color);
assert.equal(singleTable.columns.colorFormat, 'rgba8');
assert.deepEqual(singleTable.columns.ids, ['row-0', 'row-1', 'row-2']);
assert.deepEqual(Array.from(singleTable.columns.sourceIndex ?? []), [0, 1, 2]);
assert.deepEqual(singleTable.columns.recordIdentityBySourceIndex?.[1], {
  id: 'row-1',
  sourceIndex: 1,
  table: 'benchmark-primary',
});
assert.deepEqual(singleTable.metadata.tableRecordCounts, { 'benchmark-primary': 3 });

const singleTableAggregation = buildHistogramAggregation(singleTable.columns, {
  plotSpec: singleTable.spec,
});
const signalSubplot = singleTableAggregation.subplots.find(
  (subplot) => subplot.parameterKey === 'signalValue',
);
assert.equal(signalSubplot?.sourceIndicesAvailable, true);
assert.equal(signalSubplot?.bins.reduce((sum, bin) => sum + bin.totalCount, 0), 2);
assert.equal(singleTableAggregation.metrics.missingValueCount, 0);
assert.equal(singleTableAggregation.metrics.invalidValueCount, 1);
assert.deepEqual(signalSubplot?.bins.find((bin) => bin.totalCount > 0)?.stack, [
  { color: 0x102030ff, count: 1, endCount: 1, startCount: 0 },
]);

const mixedTable = adaptMixedTablesForHistogram(createFixture());
assert.equal(mixedTable.metadata.recordCount, 4);
assert.deepEqual(mixedTable.metadata.tableNames, [
  'benchmark-primary',
  'benchmark-secondary',
]);
assert.deepEqual(mixedTable.columns.tableBySourceIndex, [
  'benchmark-primary',
  'benchmark-primary',
  'benchmark-secondary',
  'benchmark-secondary',
]);
assert.deepEqual(
  mixedTable.spec.parameters.map((parameter) => parameter.key),
  ['timestampNs', 'signalValue', 'phase', 'accepted', 'secondarySignal'],
);
assert.equal(
  mixedTable.spec.parameters.filter((parameter) => parameter.key === 'signalValue').length,
  1,
);
assert.deepEqual(
  mixedTable.spec.parameters.find((parameter) => parameter.key === 'phase')?.source,
  {
    datasetKey: 'mixed-table-demo',
    fieldKey: 'phase',
    tableKey: 'benchmark-records',
  },
);
assert.deepEqual(
  mixedTable.spec.parameters.find((parameter) => parameter.key === 'secondarySignal')
    ?.source,
  {
    datasetKey: 'mixed-table-demo',
    fieldKey: 'secondarySignal',
    tableKey: 'benchmark-secondary',
  },
);
assert.equal(mixedTable.columns.valuesByParameter.id, undefined);
assert.equal(mixedTable.columns.valuesByParameter.table, undefined);
assert.equal(mixedTable.columns.valuesByParameter.shape, undefined);
assert.deepEqual(mixedTable.columns.recordIdentityBySourceIndex?.[2], {
  id: 'b-1',
  sourceIndex: 2,
  table: 'benchmark-secondary',
});

const mixedAggregation = buildHistogramAggregation(mixedTable.columns, {
  plotSpec: mixedTable.spec,
});
const secondarySignalSubplot = mixedAggregation.subplots.find(
  (subplot) => subplot.parameterKey === 'secondarySignal',
);
assert.equal(
  secondarySignalSubplot?.bins.reduce((sum, bin) => sum + bin.totalCount, 0),
  2,
);
assert.equal(
  Array.from(secondarySignalSubplot?.sourceIndices ?? []).every(
    (sourceIndex) => sourceIndex >= 2,
  ),
  true,
);

const labelCollision = adaptMixedTablesForHistogram([
  {
    axes: [
      {
        key: 'signalValue',
        kind: 'numeric',
        label: 'Shared signal',
        role: 'dimension',
      },
      {
        key: 'alternateSignal',
        kind: 'numeric',
        label: 'Shared signal',
        role: 'dimension',
      },
    ],
    name: 'benchmark-primary',
    records: [
      { id: 'shared-a', signalValue: 10 },
      { id: 'shared-b', signalValue: 12 },
    ],
  },
  {
    axes: [
      {
        key: 'signalValue',
        kind: 'numeric',
        label: 'Shared signal',
        role: 'dimension',
      },
      {
        key: 'alternateSignal',
        kind: 'numeric',
        label: 'Shared signal',
        role: 'dimension',
      },
    ],
    name: 'benchmark-secondary',
    records: [
      { alternateSignal: 14, id: 'shared-c' },
      { alternateSignal: 16, id: 'shared-d' },
    ],
  },
]);
assert.deepEqual(
  labelCollision.spec.parameters.map((parameter) => parameter.key),
  ['signalValue', 'alternateSignal'],
);
assert.deepEqual(Array.from(labelCollision.columns.valuesByParameter.signalValue ?? []), [
  10,
  12,
  Number.NaN,
  Number.NaN,
]);
assert.deepEqual(
  Array.from(labelCollision.columns.valuesByParameter.alternateSignal ?? []),
  [Number.NaN, Number.NaN, 14, 16],
);

const declaredNameMerged = adaptScatterEncodedColumnsForHistogram({
  axisByColumn: {
    primary_signal: {
      columnKey: 'primary_signal',
      domain: { max: 12, min: 10 },
      kind: 'numeric',
      parameterName: 'shared-signal',
      title: 'Primary signal',
    },
    secondary_signal: {
      columnKey: 'secondary_signal',
      domain: { max: 16, min: 14 },
      kind: 'numeric',
      parameterName: 'shared-signal',
      title: 'Secondary signal',
    },
  },
  ids: ['shared-a', 'shared-b', 'shared-c', 'shared-d'],
  sourceIndex: new Uint32Array([0, 1, 2, 3]),
  x: new Float64Array([Number.NaN, Number.NaN, Number.NaN, Number.NaN]),
  xKey: 'timestampNs',
  y: {
    primary_signal: new Float64Array([10, 12, Number.NaN, Number.NaN]),
    secondary_signal: new Float64Array([Number.NaN, Number.NaN, 14, 16]),
  },
});
assert.deepEqual(
  declaredNameMerged.spec.parameters.map((parameter) => parameter.key),
  ['primary_signal'],
);
assert.deepEqual(Array.from(declaredNameMerged.columns.valuesByParameter.primary_signal ?? []), [
  10,
  12,
  14,
  16,
]);

const barPayload = adaptHistogramBarDemoPayload({
  parameters: [
    {
      bins: [
        {
          colorCounts: {
            '#102030': 2,
            '0x405060ff': 1,
          },
          count: 3,
          max: 10,
          min: 0,
          sourceIndices: [0, 1, 2],
        },
        {
          count: 1,
          max: 20,
          min: 10,
          sourceIndices: new Uint32Array([3]),
        },
      ],
      key: 'latency',
      label: 'Latency',
      table: 'benchmark-primary',
      unit: 'ms',
    },
  ],
  source: 'demo-bars',
});
assert.equal(barPayload.spec.mode, 'bar');
assert.equal(barPayload.series[0]?.parameterKey, 'latency');
assert.equal(barPayload.aggregation.mode, 'bar');
assert.equal(barPayload.aggregation.subplots[0]?.binCount, 2);
assert.deepEqual(barPayload.aggregation.subplots[0]?.bins[0]?.stack, [
  { color: 0x102030ff, count: 2, endCount: 2, startCount: 0 },
  { color: 0x405060ff, count: 1, endCount: 3, startCount: 2 },
]);
assert.deepEqual(Array.from(barPayload.aggregation.subplots[0]?.sourceIndices ?? []), [
  0,
  1,
  2,
  3,
]);

console.log('histogram-fast dataset adapter tests passed');

function createSingleTableEncodedColumns(): FastScatterEncodedSchemaColumns & {
  readonly recordIdentityBySourceIndex: readonly {
    id: string;
    sourceIndex: number;
    table: string;
  }[];
  readonly tableBySourceIndex: readonly string[];
} {
  const axisByColumn: Record<string, FastScatterEncodedAxis> = {
    accepted: {
      categories: [
        { encoded: 0, label: 'Rejected', value: 'false' },
        { encoded: 1, label: 'Accepted', value: 'true' },
      ],
      columnKey: 'accepted',
      domain: { max: 1, min: 0 },
      kind: 'boolean',
      parameterName: 'Acceptance',
      title: 'Acceptance',
    },
    phase: {
      categories: [
        { encoded: 0, label: 'Idle', value: 'idle' },
        { encoded: 1, label: 'Steady', value: 'steady' },
      ],
      columnKey: 'phase',
      domain: { max: 1, min: 0 },
      kind: 'categorical',
      parameterName: 'Process phase',
      title: 'Process phase',
    },
    signalValue: {
      columnKey: 'signalValue',
      domain: { max: 20, min: 10 },
      kind: 'numeric',
      parameterName: 'Signal value',
      title: 'Signal value',
      unit: 'a.u.',
    },
    timestampNs: {
      columnKey: 'timestampNs',
      datetimeOriginNs: '1717200000000000000',
      datetimeOriginNsBigInt: 1_717_200_000_000_000_000n,
      domain: { max: 2, min: 0 },
      epochNsValues: ['1717200000000000000', '1717200000000000001', '1717200000000000002'],
      kind: 'datetime-ns',
      parameterName: 'Timestamp',
      title: 'Timestamp (UTC)',
      unit: 'UTC',
    },
  };

  return {
    axisByColumn,
    color: new Uint8Array([
      0x10,
      0x20,
      0x30,
      0xff,
      0x40,
      0x50,
      0x60,
      0xff,
      0x10,
      0x20,
      0x30,
      0xff,
    ]),
    colorFormat: 'rgba8',
    ids: ['row-0', 'row-1', 'row-2'],
    recordIdentityBySourceIndex: [
      { id: 'row-0', sourceIndex: 0, table: 'benchmark-primary' },
      { id: 'row-1', sourceIndex: 1, table: 'benchmark-primary' },
      { id: 'row-2', sourceIndex: 2, table: 'benchmark-primary' },
    ],
    sourceIndex: new Uint32Array([0, 1, 2]),
    tableBySourceIndex: [
      'benchmark-primary',
      'benchmark-primary',
      'benchmark-primary',
    ],
    x: new Float64Array([0, 1, 2]),
    xKey: 'timestampNs',
    y: {
      accepted: new Float64Array([1, 0, 1]),
      phase: new Float64Array([0, 1, 1]),
      signalValue: new Float64Array([10, Number.NaN, 20]),
    },
  };
}

function createFixture(): MixedTableFixture {
  return {
    metadata: {
      axes: MIXED_TABLE_AXES,
      columns: [],
      count: 4,
      createdAt: '2026-05-19T00:00:00.000Z',
      seed: 1,
      styles: {} as MixedTableFixture['metadata']['styles'],
      tableNames: ['benchmark-primary', 'benchmark-secondary'],
      tables: [
        { count: 2, name: 'benchmark-primary' },
        { count: 2, name: 'benchmark-secondary' },
      ],
      version: 1,
    },
    tables: [
      {
        name: 'benchmark-primary',
        records: [
          createRecord('a-1', 'benchmark-primary', 10, undefined, 0.25, 2, 'circle'),
          createRecord('a-2', 'benchmark-primary', 12, undefined, 0.5, 4, 'rectangle'),
        ],
      },
      {
        name: 'benchmark-secondary',
        records: [
          createRecord('b-1', 'benchmark-secondary', 14, 7, 0.75, 6, 'triangle', 11),
          createRecord('b-2', 'benchmark-secondary', 16, 9, 1, 8, 'arrow', 13),
        ],
      },
    ],
  };
}

function createRecord(
  id: string,
  table: string,
  signalValue: number,
  secondarySignal: number | undefined,
  opacity: number,
  size: number,
  shape: MixedTableRecord['shape'],
  timestampOffset = signalValue,
): MixedTableRecord {
  return {
    accepted: id.endsWith('1'),
    color: '#102030',
    id,
    opacity,
    phase: 'steady',
    rotation: 0,
    secondarySignal,
    shape,
    signalValue,
    size,
    table,
    timestampNs: String(1_717_200_000_000_000_000n + BigInt(timestampOffset)),
  };
}
