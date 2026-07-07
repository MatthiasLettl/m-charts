import assert from 'node:assert/strict';

import {
  MIXED_TABLE_AXES,
  type MixedTableFixture,
  type MixedTableRecord,
} from '../../apps/demo/src/data/mixedTableFixtures.ts';
import { adaptMixedTablesForParallelFast } from '../../packages/m-charts/src/m-parallel/adapters/parallelDataset.ts';
import {
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  serializeParallelSelectedRecordsForExport,
  writeOneRecordSegmentPositions,
} from '../../packages/m-charts/src/m-parallel/core/index.ts';

const fixture = createFixture();
const adapted = adaptMixedTablesForParallelFast(fixture, {
  includeWebglSegmentBuffers: true,
});

assert.equal(adapted.metadata.recordCount, 4);
assert.deepEqual(adapted.metadata.tableNames, ['benchmark-primary', 'benchmark-secondary']);
assert.deepEqual(adapted.metadata.tableBySourceIndex, [
  'benchmark-primary',
  'benchmark-primary',
  'benchmark-secondary',
  'benchmark-secondary',
]);
assert.deepEqual(adapted.metadata.tableRecordCounts, {
  'benchmark-primary': 2,
  'benchmark-secondary': 2,
});

assert.deepEqual(adapted.columns.axisOrder, [
  'timestampNs',
  'signalValue',
  'phase',
  'accepted',
  'secondarySignal',
  'secondaryDrift',
  'table',
]);
assert.equal(adapted.buffers.axisMetadataByAxis?.table.kind, 'categorical');
assert.deepEqual(adapted.buffers.axisMetadataByAxis?.phase.source, {
  datasetKey: 'mixed-table-demo',
  fieldKey: 'phase',
  tableKey: 'benchmark-records',
});
assert.deepEqual(adapted.buffers.axisMetadataByAxis?.secondarySignal.source, {
  datasetKey: 'mixed-table-demo',
  fieldKey: 'secondarySignal',
  tableKey: 'benchmark-secondary',
});
assert.deepEqual(
  adapted.buffers.axisMetadataByAxis?.table.kind === 'categorical'
    ? adapted.buffers.axisMetadataByAxis.table.categories.map((category) => category.label)
    : [],
  ['benchmark-primary', 'benchmark-secondary'],
);

assert.equal(Number.isNaN(adapted.buffers.rawValuesByAxis.secondarySignal[0]), true);
assert.equal(Number.isNaN(adapted.buffers.rawValuesByAxis.secondarySignal[1]), true);
assert.deepEqual(Array.from(adapted.buffers.rawValuesByAxis.secondarySignal.slice(2)), [
  7,
  9,
]);
assert.equal(Number.isNaN(adapted.buffers.rawValuesByAxis.secondaryDrift[0]), true);
assert.equal(Number.isNaN(adapted.buffers.rawValuesByAxis.secondaryDrift[1]), true);
assert.deepEqual(Array.from(adapted.buffers.rawValuesByAxis.secondaryDrift.slice(2)), [
  1.5,
  2.5,
]);
assert.equal(adapted.buffers.lineSeriesBuffers.gapCount, 4);
assert.equal(adapted.buffers.webglSegmentBuffers?.segmentCount, 24);

assert.equal(adapted.buffers.styleBuffers?.colorFormat, 'rgba8');
assert.deepEqual(Array.from(adapted.buffers.styleBuffers?.opacity ?? []), [
  0,
  0.5,
  0.75,
  1,
]);
assert.equal(
  serializeParallelSelectedRecordsForExport(adapted.buffers, new Uint32Array([0, 2])),
  'table\tid\nbenchmark-primary\ta-1\nbenchmark-secondary\tb-1\n',
);
assert.deepEqual(Array.from(adapted.buffers.styleBuffers?.color.slice(0, 8) ?? []), [
  0x10,
  0x20,
  0x30,
  0x00,
  0x40,
  0x50,
  0x60,
  0x80,
]);

const primaryRoutePositions = new Float32Array(24);
const primaryRouteFloatCount = writeOneRecordSegmentPositions(
  adapted.buffers,
  0,
  primaryRoutePositions,
);
assert.equal(primaryRouteFloatCount, 24);
assert.deepEqual(Array.from(primaryRoutePositions), [
  0,
  0,
  1,
  0,
  1,
  0,
  2,
  0.625,
  2,
  0.625,
  3,
  0.75,
  3,
  0.75,
  4,
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  4,
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  5,
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  5,
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  6,
  0.25,
]);

const singleTable = adaptMixedTablesForParallelFast([
  { axes: fixture.metadata.axes, name: fixture.tables[0]!.name, records: fixture.tables[0]!.records },
]);
assert.equal(singleTable.columns.axisOrder.includes('table'), false);
const forcedTable = adaptMixedTablesForParallelFast(
  [
    {
      axes: fixture.metadata.axes,
      name: fixture.tables[0]!.name,
      records: fixture.tables[0]!.records,
    },
  ],
  {
    tableAxis: 'always',
  },
);
assert.equal(forcedTable.columns.axisOrder.includes('table'), true);
const disabledTable = adaptMixedTablesForParallelFast(fixture, {
  tableAxis: 'never',
});
assert.equal(disabledTable.columns.axisOrder.includes('table'), false);
const filteredTable = adaptMixedTablesForParallelFast([
  { axes: fixture.metadata.axes, name: fixture.tables[0]!.name, records: fixture.tables[0]!.records },
]);
assert.equal(filteredTable.metadata.recordCount, 2);
assert.deepEqual(filteredTable.metadata.tableNames, ['benchmark-primary']);
assert.equal(filteredTable.columns.axisOrder.includes('table'), false);
assert.equal(filteredTable.buffers.styleBuffers?.styledRecordCount, 2);

const sameKeySecondDataset = adaptMixedTablesForParallelFast(
  [
    {
      axes: [
        { key: 'sharedScore', kind: 'numeric', label: 'Shared score', role: 'dimension' },
      ],
      name: 'same-key-primary',
      records: [
        { id: 'same-a-1', sharedScore: 1 },
        { id: 'same-a-2', sharedScore: 2 },
      ],
    },
    {
      axes: [
        { key: 'sharedScore', kind: 'numeric', label: 'Shared score', role: 'dimension' },
      ],
      name: 'same-key-secondary',
      records: [
        { id: 'same-b-1', sharedScore: 3 },
        { id: 'same-b-2', sharedScore: 4 },
      ],
    },
  ],
  { includeWebglSegmentBuffers: true },
);
assert.deepEqual(sameKeySecondDataset.columns.axisOrder, ['sharedScore', 'table']);
assert.equal(sameKeySecondDataset.metadata.recordCount, 4);
assert.deepEqual(sameKeySecondDataset.metadata.tableBySourceIndex, [
  'same-key-primary',
  'same-key-primary',
  'same-key-secondary',
  'same-key-secondary',
]);
assert.deepEqual(Array.from(sameKeySecondDataset.buffers.rawValuesByAxis.sharedScore), [
  1,
  2,
  3,
  4,
]);
assert.equal(sameKeySecondDataset.buffers.webglSegmentBuffers?.segmentCount, 4);
assert.equal(
  serializeParallelSelectedRecordsForExport(
    sameKeySecondDataset.buffers,
    new Uint32Array([0, 2]),
  ),
  'table\tid\nsame-key-primary\tsame-a-1\nsame-key-secondary\tsame-b-1\n',
);

const sameLabelDifferentKey = adaptMixedTablesForParallelFast(
  [
    {
      axes: [
        { key: 'primaryScore', kind: 'numeric', label: 'Score', role: 'dimension' },
      ],
      name: 'score-primary',
      records: [{ id: 'score-a-1', primaryScore: 1 }],
    },
    {
      axes: [
        { key: 'secondaryScore', kind: 'numeric', label: 'Score', role: 'dimension' },
      ],
      name: 'score-secondary',
      records: [{ id: 'score-b-1', secondaryScore: 2 }],
    },
  ],
  { includeWebglSegmentBuffers: true },
);
assert.deepEqual(sameLabelDifferentKey.columns.axisOrder, [
  'primaryScore',
  'secondaryScore',
  'table',
]);
assert.equal(sameLabelDifferentKey.buffers.axisMetadataByAxis?.primaryScore.label, 'Score');
assert.equal(sameLabelDifferentKey.buffers.axisMetadataByAxis?.secondaryScore.label, 'Score');
assert.equal(Number.isNaN(sameLabelDifferentKey.buffers.rawValuesByAxis.secondaryScore[0]), true);
assert.equal(Number.isNaN(sameLabelDifferentKey.buffers.rawValuesByAxis.primaryScore[1]), true);

console.log('parallel-fast table adapter tests passed');

function createFixture(): MixedTableFixture {
  return {
    metadata: {
      axes: [
        ...MIXED_TABLE_AXES,
        { key: 'secondarySignal', kind: 'numeric', label: 'Secondary signal', role: 'dimension' },
      ],
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
          createRecord('a-1', 'benchmark-primary', 10, undefined, 0, '#102030'),
          createRecord('a-2', 'benchmark-primary', 12, undefined, 0.5, '#405060'),
        ],
      },
      {
        name: 'benchmark-secondary',
        records: [
          createRecord('b-1', 'benchmark-secondary', 14, 7, 0.75, '#708090'),
          createRecord('b-2', 'benchmark-secondary', 16, 9, 1, '#A0B0C0'),
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
  color: string,
): MixedTableRecord {
  return {
    accepted: id.endsWith('1'),
    color,
    id,
    opacity,
    phase: 'steady',
    rotation: 0,
    secondaryDrift:
      secondarySignal === undefined ? undefined : secondarySignal === 7 ? 1.5 : 2.5,
    secondarySignal,
    shape: 'circle',
    signalValue,
    size: 4,
    table,
    timestampNs: String(1_717_200_000_000_000_000n + BigInt(signalValue)),
  };
}
