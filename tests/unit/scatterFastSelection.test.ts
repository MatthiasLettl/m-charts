import assert from 'node:assert/strict';

import {
  buildFastScatterBubbleAggregation,
  buildFastScatterHeatmapAggregation,
  createFastScatterSelectionState,
  isFastScatterPointInPolygon,
  materializeFastScatterSelectedIds,
  materializeFastScatterSelectedRecords,
  materializeFastScatterSelectedIdSample,
  selectFastScatterSourceIndicesInBounds,
  selectFastScatterSourceIndicesInPolygon,
  serializeFastScatterSelectedIdsForExport,
  serializeFastScatterSelectedRecordsForExport,
  type FastScatterPointColumns,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';
import {
  mergeFastScatterSelectionSourceIndices,
  selectFastScatterBubbleAggregateSourceIndices,
  selectFastScatterHeatmapCellSourceIndices,
} from '../../packages/m-charts/src/m-scatter/core/selection.ts';
import {
  isPointInPolygon,
  selectRecordIdsInBounds,
  selectRecordIdsInPolygon,
} from '../../apps/demo/src/data/selection.ts';
import type { ScatterRecord } from '../../apps/demo/src/data/types.ts';

const columns: FastScatterPointColumns = {
  ids: ['id-000', 'id-001', 'id-002', 'id-003', 'id-004', 'id-005'],
  x: new Float64Array([0, 1, 2, 3, 4, 5]),
  y: {
    a: new Float64Array([10, 11, 12, 13, 14, 15]),
  },
};

const selection = new Uint32Array([4, 1, 3]);
const state = createFastScatterSelectionState(columns, selection, { sampleSize: 2 });

assert.equal(state.sourceIndices, selection);
assert.equal(state.selectedCount, 3);
assert.deepEqual(state.sampleIds, ['id-004', 'id-001']);

assert.deepEqual(
  materializeFastScatterSelectedIdSample(columns, selection, 10),
  ['id-004', 'id-001', 'id-003'],
);
assert.deepEqual(
  materializeFastScatterSelectedIds(columns, selection),
  ['id-004', 'id-001', 'id-003'],
);
assert.equal(
  serializeFastScatterSelectedIdsForExport(columns, selection),
  'id-004\nid-001\nid-003\n',
);

const emptyState = createFastScatterSelectionState(columns, undefined);

assert.equal(emptyState.selectedCount, 0);
assert.equal(emptyState.sourceIndices.length, 0);
assert.deepEqual(emptyState.sampleIds, []);
assert.deepEqual(materializeFastScatterSelectedIds(columns, emptyState.sourceIndices), []);
assert.equal(
  serializeFastScatterSelectedIdsForExport(columns, emptyState.sourceIndices),
  '\n',
);

const broadSelection = new Uint32Array(columns.ids.length);

for (let index = 0; index < broadSelection.length; index += 1) {
  broadSelection[index] = index;
}

const broadState = createFastScatterSelectionState(columns, broadSelection, {
  sampleSize: 3,
});

assert.equal(broadState.selectedCount, columns.ids.length);
assert.deepEqual(broadState.sampleIds, ['id-000', 'id-001', 'id-002']);
assert.deepEqual(materializeFastScatterSelectedIds(columns, broadSelection), [
  'id-000',
  'id-001',
  'id-002',
  'id-003',
  'id-004',
  'id-005',
]);

const sourceOrderSelection = new Uint32Array([5, 0, 2]);

assert.deepEqual(materializeFastScatterSelectedIds(columns, sourceOrderSelection), [
  'id-005',
  'id-000',
  'id-002',
]);

assert.deepEqual(
  materializeFastScatterSelectedIds(
    columns,
    selectFastScatterSourceIndicesInBounds(columns, {
      x: { min: 4.25, max: 1.5 },
      y: { min: 13.5, max: 11.5 },
      yKey: 'a',
    }),
  ),
  ['id-002', 'id-003'],
);
assert.deepEqual(
  materializeFastScatterSelectedIds(
    columns,
    selectFastScatterSourceIndicesInBounds(columns, {
      x: { min: 1.5, max: 4.25 },
      y: { min: 11.5, max: 14.5 },
      yKey: 'a',
    }),
  ),
  ['id-002', 'id-003', 'id-004'],
);

const comparableRecords = makeRecordsFromColumns(columns);
const comparableBounds = {
  attribute: 'a',
  x: { min: 1.5, max: 4.25 },
  y: { min: 11.5, max: 13.5 },
} as const;

assert.deepEqual(
  materializeFastScatterSelectedIds(
    columns,
    selectFastScatterSourceIndicesInBounds(columns, {
      x: comparableBounds.x,
      y: comparableBounds.y,
      yKey: comparableBounds.attribute,
    }),
  ),
  selectRecordIdsInBounds(comparableRecords, comparableBounds).ids,
);

assert.deepEqual(
  Array.from(
    selectFastScatterSourceIndicesInBounds(
      {
        ...columns,
        sourceIndex: new Uint32Array([3, 0, 5, 1, 4, 2]),
      },
      {
        x: { min: 0, max: 5 },
        y: { min: 10, max: 15 },
        yKey: 'a',
      },
    ),
  ),
  [0, 1, 2, 3, 4, 5],
);

const mixedTableColumns: FastScatterPointColumns = {
  ids: ['primary-0', 'primary-1', 'secondary-0', 'secondary-1'],
  x: new Float64Array([10, 30, 20, 40]),
  xOrder: new Uint32Array([0, 2, 1, 3]),
  y: {
    a: new Float64Array([1, 3, 2, 4]),
  },
};

assert.deepEqual(
  materializeFastScatterSelectedRecords(
    {
      ...mixedTableColumns,
      recordIdentityBySourceIndex: [
        { id: 'primary-0', sourceIndex: 0, table: 'benchmark-primary' },
        { id: 'primary-1', sourceIndex: 1, table: 'benchmark-primary' },
        { id: 'secondary-0', sourceIndex: 2, table: 'benchmark-secondary' },
        { id: 'secondary-1', sourceIndex: 3, table: 'benchmark-secondary' },
      ],
      tableBySourceIndex: [
        'benchmark-primary',
        'benchmark-primary',
        'benchmark-secondary',
        'benchmark-secondary',
      ],
    },
    new Uint32Array([1, 2]),
  ),
  [
    { id: 'primary-1', sourceIndex: 1, table: 'benchmark-primary' },
    { id: 'secondary-0', sourceIndex: 2, table: 'benchmark-secondary' },
  ],
);
assert.equal(
  serializeFastScatterSelectedRecordsForExport(
    {
      ...mixedTableColumns,
      recordIdentityBySourceIndex: [
        { id: 'primary-0', sourceIndex: 0, table: 'benchmark-primary' },
        { id: 'primary-1', sourceIndex: 1, table: 'benchmark-primary' },
        { id: 'secondary-0', sourceIndex: 2, table: 'benchmark-secondary' },
        { id: 'secondary-1', sourceIndex: 3, table: 'benchmark-secondary' },
      ],
      tableBySourceIndex: [
        'benchmark-primary',
        'benchmark-primary',
        'benchmark-secondary',
        'benchmark-secondary',
      ],
    },
    new Uint32Array([1, 2]),
  ),
  'table\tid\nbenchmark-primary\tprimary-1\nbenchmark-secondary\tsecondary-0\n',
);

assert.deepEqual(
  Array.from(
    selectFastScatterSourceIndicesInBounds(mixedTableColumns, {
      x: { min: 15, max: 35 },
      y: { min: 1.5, max: 3.5 },
      yKey: 'a',
    }),
  ),
  [1, 2],
);

const polygon = {
  points: [
    { x: 1.25, y: 11.25 },
    { x: 4.75, y: 11.25 },
    { x: 3.75, y: 14.5 },
    { x: 1.25, y: 13.75 },
  ],
  yKey: 'a',
} as const;
const polygonSelection = selectFastScatterSourceIndicesInPolygon(columns, polygon);

assert.deepEqual(
  materializeFastScatterSelectedIds(columns, polygonSelection.sourceIndices),
  selectRecordIdsInPolygon(comparableRecords, {
    attribute: polygon.yKey,
    points: polygon.points,
  }).ids,
);
assert.equal(polygonSelection.diagnostics.candidateCount, 3);
assert.deepEqual(polygonSelection.diagnostics.bounds, {
  x: { min: 1.25, max: 4.75 },
  y: { min: 11.25, max: 14.5 },
  yKey: 'a',
});
assert.equal(
  isFastScatterPointInPolygon({ x: 2, y: 12 }, polygon.points),
  isPointInPolygon({ x: 2, y: 12 }, polygon.points),
);
assert.deepEqual(
  Array.from(
    selectFastScatterSourceIndicesInPolygon(
      {
        ...columns,
        sourceIndex: new Uint32Array([3, 0, 5, 1, 4, 2]),
      },
      {
        points: [
          { x: -1, y: 9 },
          { x: 6, y: 9 },
          { x: 6, y: 16 },
          { x: -1, y: 16 },
        ],
        yKey: 'a',
      },
    ).sourceIndices,
  ),
  [0, 1, 2, 3, 4, 5],
);
assert.deepEqual(
  Array.from(
    selectFastScatterSourceIndicesInPolygon(columns, {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      yKey: 'a',
    }).sourceIndices,
  ),
  [],
);
assert.deepEqual(
  Array.from(
    selectFastScatterSourceIndicesInPolygon(mixedTableColumns, {
      points: [
        { x: 15, y: 1.5 },
        { x: 35, y: 1.5 },
        { x: 35, y: 3.5 },
        { x: 15, y: 3.5 },
      ],
      yKey: 'a',
    }).sourceIndices,
  ),
  [1, 2],
);

const aggregateColumns: FastScatterPointColumns = {
  ids: ['agg-0', 'agg-1', 'agg-2', 'agg-3'],
  x: new Float64Array([10, 10, 75, 80]),
  y: {
    a: new Float64Array([4, 4, 8, 2]),
  },
};
const aggregateBubble = buildFastScatterBubbleAggregation(aggregateColumns, {
  mode: 'bubble',
  subplots: [
    {
      plotHeightPx: 100,
      plotId: 'a',
      plotWidthPx: 100,
      yKey: 'a',
      yRange: { min: 0, max: 10 },
    },
  ],
  xRange: { min: 0, max: 100 },
});
const aggregateHeatmap = buildFastScatterHeatmapAggregation(aggregateColumns, {
  heatBinPx: 50,
  mode: 'heatmap',
  subplots: [
    {
      plotHeightPx: 100,
      plotId: 'a',
      plotWidthPx: 100,
      yKey: 'a',
      yRange: { min: 0, max: 10 },
    },
  ],
  xRange: { min: 0, max: 100 },
});
const bubbleSelection = selectFastScatterBubbleAggregateSourceIndices(
  aggregateColumns,
  aggregateBubble.subplots[0]!,
  0,
);

assert.deepEqual(Array.from(bubbleSelection.sourceIndices), [0, 1]);
assert.equal(bubbleSelection.selectedCount, 2);
assert.deepEqual(bubbleSelection.sampleIds, ['agg-0', 'agg-1']);
assert.equal(
  serializeFastScatterSelectedIdsForExport(
    aggregateColumns,
    bubbleSelection.sourceIndices,
  ),
  'agg-0\nagg-1\n',
);

const appendedBubbleSelection = selectFastScatterBubbleAggregateSourceIndices(
  aggregateColumns,
  aggregateBubble.subplots[0]!,
  0,
  {
    currentSourceIndices: new Uint32Array([3]),
    selectionKind: 'append',
  },
);

assert.deepEqual(Array.from(appendedBubbleSelection.sourceIndices), [0, 1, 3]);
assert.deepEqual(
  Array.from(
    mergeFastScatterSelectionSourceIndices(
      new Uint32Array([3]),
      bubbleSelection.sourceIndices,
    ),
  ),
  [0, 1, 3],
);

const heatmapSelection = selectFastScatterHeatmapCellSourceIndices(
  aggregateColumns,
  aggregateHeatmap.subplots[0]!,
  0,
  {
    currentSourceIndices: new Uint32Array([2]),
    selectionKind: 'append',
  },
);

assert.deepEqual(Array.from(heatmapSelection.sourceIndices), [0, 1, 2]);
assert.equal(heatmapSelection.selectedCount, 3);

const preservedEmptyHeatmapSelection = selectFastScatterHeatmapCellSourceIndices(
  aggregateColumns,
  aggregateHeatmap.subplots[0]!,
  2,
  {
    currentSourceIndices: new Uint32Array([2]),
    selectionKind: 'replace',
  },
);

assert.equal(preservedEmptyHeatmapSelection.empty, true);
assert.deepEqual(Array.from(preservedEmptyHeatmapSelection.sourceIndices), [2]);
assert.equal(
  serializeFastScatterSelectedIdsForExport(
    aggregateColumns,
    preservedEmptyHeatmapSelection.sourceIndices,
  ),
  'agg-2\n',
);

assert.throws(
  () => materializeFastScatterSelectedIds(columns, new Uint32Array([99])),
  /outside the 6 loaded IDs/,
);

console.log('scatter-fast selection tests passed');

function makeRecordsFromColumns(sourceColumns: FastScatterPointColumns): ScatterRecord[] {
  return sourceColumns.ids.map((id, index) => ({
    a: sourceColumns.y.a[index],
    b: sourceColumns.y.a[index],
    c: sourceColumns.y.a[index],
    category: 'core',
    color: '#2563EB',
    id,
    opacity: 1,
    rotation: 0,
    shape: 'circle',
    size: 3,
    styleGroup: 'default',
    x: sourceColumns.x[index],
  }));
}
