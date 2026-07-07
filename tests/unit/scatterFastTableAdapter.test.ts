import assert from 'node:assert/strict';

import {
  MIXED_TABLE_AXES,
  type MixedTableFixture,
  type MixedTableRecord,
} from '../../apps/demo/src/data/mixedTableFixtures.ts';
import { adaptMixedTablesForFastScatter } from '../../packages/m-charts/src/m-scatter/adapters/scatterDataset.ts';
import { FAST_SCATTER_SHAPE_CODES } from '../../packages/m-charts/src/m-scatter/core/index.ts';

const fixture = createFixture();
const adapted = adaptMixedTablesForFastScatter(fixture);

assert.equal(adapted.metadata.recordCount, 4);
assert.deepEqual(adapted.metadata.tableNames, ['benchmark-primary', 'benchmark-secondary']);
assert.deepEqual(adapted.columns.tableBySourceIndex, [
  'benchmark-primary',
  'benchmark-primary',
  'benchmark-secondary',
  'benchmark-secondary',
]);
assert.deepEqual(adapted.metadata.recordIdentityBySourceIndex[0], {
  id: 'a-1',
  sourceIndex: 0,
  table: 'benchmark-primary',
});
assert.equal(adapted.spec.xLabel, 'Timestamp (UTC)');
assert.equal(adapted.spec.plots.some((plot) => plot.id === 'table'), false);
assert.deepEqual(
  adapted.spec.plots.map((plot) => plot.yKey),
  ['signalValue', 'phase', 'accepted', 'secondarySignal'],
);
assert.equal(adapted.columns.xKey, 'timestampNs');
assert.equal(adapted.columns.axisByColumn.timestampNs.kind, 'datetime-ns');
assert.equal(adapted.columns.axisByColumn.phase.kind, 'categorical');
assert.equal(adapted.columns.axisByColumn.accepted.kind, 'boolean');
assert.deepEqual(adapted.columns.axisByColumn.phase.source, {
  datasetKey: 'mixed-table-demo',
  fieldKey: 'phase',
  tableKey: 'benchmark-records',
});
assert.deepEqual(adapted.columns.axisByColumn.secondarySignal.source, {
  datasetKey: 'mixed-table-demo',
  fieldKey: 'secondarySignal',
  tableKey: 'benchmark-secondary',
});
assert.deepEqual(adapted.columns.ids, ['a-1', 'a-2', 'b-1', 'b-2']);
assert.deepEqual(Array.from(adapted.columns.xOrder ?? []), [0, 2, 1, 3]);
assert.deepEqual(Array.from(adapted.columns.y.signalValue), [10, 12, 14, 16]);
assert.equal(Number.isNaN(adapted.columns.y.secondarySignal[0]), true);
assert.equal(Number.isNaN(adapted.columns.y.secondarySignal[1]), true);
assert.deepEqual(Array.from(adapted.columns.y.secondarySignal.slice(2)), [7, 9]);
assert.deepEqual(Array.from(adapted.columns.opacity ?? []), [0, 0.5, 0.75, 1]);
assert.deepEqual(Array.from(adapted.columns.size ?? []), [0, 12, 18, 24]);
assert.deepEqual(Array.from(adapted.columns.shape ?? []), [
  FAST_SCATTER_SHAPE_CODES.circle,
  FAST_SCATTER_SHAPE_CODES.rectangle,
  FAST_SCATTER_SHAPE_CODES.triangle,
  FAST_SCATTER_SHAPE_CODES.arrow,
]);
const single = adaptMixedTablesForFastScatter([
  {
    axes: fixture.metadata.axes,
    name: fixture.tables[0]!.name,
    records: fixture.tables[0]!.records,
  },
]);
assert.equal(single.metadata.recordCount, 2);
assert.deepEqual(single.metadata.tableNames, ['benchmark-primary']);
assert.equal(single.spec.plots.some((plot) => plot.yKey === 'secondarySignal'), false);

console.log('scatter-fast table adapter tests passed');

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
          createRecord('a-1', 'benchmark-primary', 10, undefined, 0, 0, 'circle'),
          createRecord('a-2', 'benchmark-primary', 12, undefined, 0.5, 12, 'rectangle'),
        ],
      },
      {
        name: 'benchmark-secondary',
        records: [
          createRecord('b-1', 'benchmark-secondary', 14, 7, 0.75, 18, 'triangle', 11),
          createRecord('b-2', 'benchmark-secondary', 16, 9, 1, 24, 'arrow', 13),
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
