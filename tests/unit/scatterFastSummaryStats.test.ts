import assert from 'node:assert/strict';

import {
  createSelectedCompareSummary,
  createVisibleCompareSummary,
} from '../../apps/demo/src/data/summaryStats.ts';
import type { ScatterDataset, ScatterRecord } from '../../apps/demo/src/data/types.ts';
import type { ViewportState } from '../../apps/demo/src/state/viewSearchParams.ts';
import { adaptScatterDatasetForFastScatter } from '../../packages/m-charts/src/m-scatter/adapters/scatterDataset.ts';
import {
  createFastScatterSelectedCompareSummary,
  createFastScatterVisibleCompareSummary,
  type FastScatterViewport,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

const records: ScatterRecord[] = [
  makeRecord('alpha', 0, -2, 10, 100),
  makeRecord('bravo', 5, 0, 20, 200),
  makeRecord('charlie', 10, 2, 30, 300),
  makeRecord('delta', 15, 4, 40, 400),
];
const dataset = makeDataset(records);
const adapted = adaptScatterDatasetForFastScatter(dataset);
const viewport: ViewportState = {
  a: { min: -1, max: 3 },
  b: { min: 15, max: 35 },
  c: { min: 0, max: 250 },
  x: { min: 3, max: 12 },
};
const fastViewport: FastScatterViewport = {
  x: viewport.x,
  yByPlot: {
    a: viewport.a,
    b: viewport.b,
    c: viewport.c,
  },
};

assert.deepEqual(
  createFastScatterVisibleCompareSummary(
    adapted.columns,
    adapted.spec,
    fastViewport,
  ),
  createVisibleCompareSummary(records, viewport),
);

assert.deepEqual(
  createFastScatterSelectedCompareSummary(
    adapted.columns,
    adapted.spec,
    new Uint32Array([0, 3]),
  ),
  createSelectedCompareSummary(records, new Set(['alpha', 'delta'])),
);

assert.deepEqual(
  createFastScatterSelectedCompareSummary(
    adapted.columns,
    adapted.spec,
    new Uint32Array(0),
  ),
  createSelectedCompareSummary(records, new Set()),
);

console.log('scatter-fast summary stats tests passed');

function makeDataset(datasetRecords: ScatterRecord[]): ScatterDataset {
  return {
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
      categories: ['core'],
      count: datasetRecords.length,
      createdAt: '2026-05-16T00:00:00.000Z',
      seed: 35,
      styleGroups: ['default'],
      styles: {
        categories: {},
        styleGroups: {},
      },
    },
    records: datasetRecords,
  };
}

function makeRecord(
  id: string,
  x: number,
  a: number,
  b: number,
  c: number,
): ScatterRecord {
  return {
    a,
    b,
    c,
    category: 'core',
    color: '#2563EB',
    id,
    opacity: 0.72,
    rotation: 45,
    shape: 'circle',
    size: 3,
    styleGroup: 'default',
    x,
  };
}
