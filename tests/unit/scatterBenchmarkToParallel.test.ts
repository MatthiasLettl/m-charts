import assert from 'node:assert/strict';

import { adaptScatterBenchmarkForParallelFast } from '../../packages/m-charts/src/m-parallel/adapters/scatterBenchmarkToParallel.ts';
import { serializeParallelSelectedRecordsForExport } from '../../packages/m-charts/src/m-parallel/core/index.ts';
import { encodeFastScatterSchemaRows, type FastScatterDatasetSchema } from '../../packages/m-charts/src/m-scatter/core/index.ts';

const schema: FastScatterDatasetSchema = {
  columns: [
    { key: 'id', role: 'id' },
    { axisType: 'datetime-ns', key: 'timestampNs', role: 'x', title: 'Timestamp', unit: 'UTC' },
    {
      axisType: 'categorical',
      categories: [
        { label: 'Idle', order: 0, value: 'idle' },
        { label: 'Ramp', order: 1, value: 'ramp' },
      ],
      key: 'phase',
      role: 'y',
      title: 'Phase',
    },
    { axisType: 'boolean', key: 'accepted', role: 'y', title: 'Accepted' },
    { axisType: 'numeric', key: 'signalValue', role: 'y', title: 'Signal value', unit: 'a.u.' },
    { key: 'color', role: 'style' },
    { key: 'opacity', role: 'style' },
  ],
  plots: [
    { id: 'phase', y: { column: 'phase' } },
    { id: 'accepted', y: { column: 'accepted' } },
    { id: 'signal', y: { column: 'signalValue' } },
  ],
  version: 1,
  x: { column: 'timestampNs' },
};

const encoded = encodeFastScatterSchemaRows(
  [
    {
      accepted: false,
      color: '#112233',
      id: 'sf-0',
      opacity: 0.25,
      phase: 'idle',
      signalValue: 12,
      timestampNs: '1717200000000000000',
    },
    {
      accepted: true,
      color: '#445566',
      id: 'sf-1',
      opacity: 0.75,
      phase: 'ramp',
      signalValue: 18,
      timestampNs: '1717200001000000000',
    },
  ],
  schema,
);

const adapted = adaptScatterBenchmarkForParallelFast({
  columns: {
    ...encoded.columns,
    recordIdentityBySourceIndex: [
      { id: 'sf-0', sourceIndex: 0, table: 'benchmark-primary' },
      { id: 'sf-1', sourceIndex: 1, table: 'benchmark-primary' },
    ],
    tableBySourceIndex: ['benchmark-primary', 'benchmark-primary'],
  },
  spec: encoded.spec,
});

assert.deepEqual(adapted.columns.axisOrder, ['timestampNs', 'phase', 'accepted', 'signalValue']);
assert.equal(adapted.buffers.recordCount, 2);
assert.equal(adapted.metadata.recordCount, 2);
assert.deepEqual(adapted.metadata.tableNames, ['benchmark-primary']);
assert.deepEqual(adapted.metadata.tableRecordCounts, { 'benchmark-primary': 2 });
assert.equal(adapted.buffers.axisMetadataByAxis?.timestampNs.kind, 'datetime-ns');
assert.equal(adapted.buffers.axisMetadataByAxis?.phase.kind, 'categorical');
assert.equal(adapted.buffers.axisMetadataByAxis?.accepted.kind, 'boolean');
assert.equal(adapted.buffers.styleBuffers?.styledRecordCount, 2);
assert.deepEqual(Array.from(adapted.buffers.styleBuffers?.opacity ?? []), [0.25, 0.75]);
assert.deepEqual(Array.from(adapted.buffers.styleBuffers?.color.slice(0, 8) ?? []), [
  0x11,
  0x22,
  0x33,
  0x40,
  0x44,
  0x55,
  0x66,
  0xbf,
]);
assert.equal(
  serializeParallelSelectedRecordsForExport(adapted.buffers, new Uint32Array([1])),
  'table\tid\nbenchmark-primary\tsf-1\n',
);

console.log('scatter benchmark to parallel tests passed');
