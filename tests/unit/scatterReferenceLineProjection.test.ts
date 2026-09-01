import assert from 'node:assert/strict';

import {
  createScatterReferenceLineCoordinate,
  parseScatterReferenceLineRecords,
  projectScatterReferenceLine,
  updateScatterReferenceLineCoordinate,
  type ScatterReferenceLineAxisContext,
  type ScatterReferenceLineRecord,
} from '../../apps/demo/src/data/scatterReferenceLines.ts';
import type { FastScatterEncodedAxis } from '../../packages/m-charts/src/m-scatter/core/index.ts';

function createDatetimeAxis(
  columnKey: string,
  datetimeOriginNsBigInt: bigint,
): Extract<FastScatterEncodedAxis, { kind: 'datetime-ns' }> {
  return {
    columnKey,
    datetimeOriginNs: datetimeOriginNsBigInt.toString(),
    datetimeOriginNsBigInt,
    domain: { max: 10_000, min: 0 },
    epochNsValues: [],
    kind: 'datetime-ns',
    parameterName: columnKey,
    title: columnKey,
  };
}

const firstTimeContext: ScatterReferenceLineAxisContext = {
  axis: createDatetimeAxis('recordedAt', 1_700_000_000_000_000_000n),
  xKey: 'recordedAt',
  xMode: 'value',
};
const coordinate = createScatterReferenceLineCoordinate(1_250.5, firstTimeContext);
assert.deepEqual(coordinate, {
  epochNs: '1700000001250500000',
  kind: 'datetime-ns',
  referenceSpaceId: 'demo-time',
});

const record: ScatterReferenceLineRecord = {
  axis: 'x',
  coordinate,
  draggable: true,
  id: 'database-reference',
  label: 'Database reference',
};
const secondTimeContext: ScatterReferenceLineAxisContext = {
  axis: createDatetimeAxis('processedAt', 1_700_000_001_000_000_000n),
  xKey: 'processedAt',
  xMode: 'value',
};
assert.equal(projectScatterReferenceLine(record, secondTimeContext)?.value, 250.5);

const draggedCoordinate = updateScatterReferenceLineCoordinate(
  coordinate,
  500,
  secondTimeContext,
);
assert.deepEqual(draggedCoordinate, {
  epochNs: '1700000001500000000',
  kind: 'datetime-ns',
  referenceSpaceId: 'demo-time',
});
assert.equal(
  projectScatterReferenceLine(
    { ...record, coordinate: draggedCoordinate },
    firstTimeContext,
  )?.value,
  1_500,
);

const numericAxis: FastScatterEncodedAxis = {
  columnKey: 'temperature',
  domain: { max: 100, min: 0 },
  kind: 'numeric',
  parameterName: 'temperature',
  title: 'Temperature',
};
const numericContext: ScatterReferenceLineAxisContext = {
  axis: numericAxis,
  xKey: 'temperature',
  xMode: 'value',
};
assert.equal(projectScatterReferenceLine(record, numericContext), null);

const numericCoordinate = createScatterReferenceLineCoordinate(42, numericContext);
const numericRecord: ScatterReferenceLineRecord = {
  axis: 'x',
  coordinate: numericCoordinate,
  id: 'numeric-reference',
};
assert.equal(projectScatterReferenceLine(numericRecord, numericContext)?.value, 42);
assert.equal(
  projectScatterReferenceLine(numericRecord, {
    axis: { ...numericAxis, columnKey: 'pressure', parameterName: 'pressure' },
    xKey: 'pressure',
    xMode: 'value',
  }),
  null,
);
assert.equal(
  projectScatterReferenceLine(numericRecord, {
    axis: numericAxis,
    xKey: 'temperature',
    xMode: 'index',
  }),
  null,
);
assert.deepEqual(parseScatterReferenceLineRecords(JSON.stringify([record])), [record]);
assert.deepEqual(parseScatterReferenceLineRecords('{invalid'), []);
assert.deepEqual(parseScatterReferenceLineRecords(JSON.stringify([
  { axis: 'x', coordinate: { kind: 'encoded', value: Number.NaN }, id: 'invalid' },
])), []);

console.log('scatter reference-line projection tests passed');
