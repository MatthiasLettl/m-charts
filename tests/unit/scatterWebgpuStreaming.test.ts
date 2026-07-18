import assert from 'node:assert/strict';

import {
  createFastScatterJsonRecordBatchSource,
  loadFastScatterRecordBatchSource,
  streamFastScatterJsonRecordBatches,
  type FastScatterDatasetSchema,
} from '../../packages/m-charts/src/m-scatter-webgpu/index.ts';

const schema: FastScatterDatasetSchema = {
  version: 1,
  columns: [
    { key: 'id', role: 'id' },
    { axisType: 'numeric', key: 'x', role: 'x' },
    { axisType: 'numeric', key: 'value', role: 'y' },
    { key: 'color', role: 'style' },
    { key: 'opacity', role: 'style' },
    { key: 'rotation', role: 'style', unit: 'deg' },
    { key: 'size', role: 'style' },
    { key: 'shape', role: 'style' },
  ],
  plots: [{ id: 'value', y: { column: 'value' } }],
  x: { column: 'x' },
};

const records = [
  { id: 'one', x: 1, value: 4, color: '#112233', opacity: 0.5, rotation: 90, size: 3, shape: 'circle' },
  { id: 'two', x: 2, value: 5, color: '#445566', opacity: 0.6, rotation: 180, size: 4, shape: 'triangle' },
  { id: 'three', x: 3, value: 6, color: '#778899', opacity: 0.7, rotation: 270, size: 5, shape: 'arrow' },
];
const json = JSON.stringify({
  metadata: { count: records.length, label: '"records":[] and brace } in string', records: [] },
  records,
});

const parsedBatches = [];
for await (const batch of streamFastScatterJsonRecordBatches(createChunkedStream(json, 7), 2)) {
  parsedBatches.push(batch);
}
assert.deepEqual(parsedBatches.map((batch) => batch.length), [2, 1]);
assert.deepEqual(parsedBatches.flat(), records);

const progress: number[] = [];
const source = createFastScatterJsonRecordBatchSource(createChunkedStream(json, 5), {
  batchSize: 2,
  count: records.length,
  schema,
});
const loaded = await loadFastScatterRecordBatchSource(source, {
  onProgress: ({ loadedCount }) => progress.push(loadedCount),
});
assert.deepEqual(progress, [2, 3]);
assert.deepEqual(Array.from(loaded.columns.x), [1, 2, 3]);
assert.deepEqual(Array.from(loaded.columns.y.value ?? []), [4, 5, 6]);
assert.deepEqual(loaded.columns.ids, ['one', 'two', 'three']);
assert.deepEqual(Array.from(loaded.columns.color ?? []), [
  0x11, 0x22, 0x33, 0xff,
  0x44, 0x55, 0x66, 0xff,
  0x77, 0x88, 0x99, 0xff,
]);
assert.deepEqual(loaded.spec.plots, [{ id: 'value', label: 'value', yKey: 'value' }]);

const compact = await loadFastScatterRecordBatchSource(
  createFastScatterJsonRecordBatchSource(createChunkedStream(json, 11), {
    batchSize: 1,
    count: records.length,
    idAt: (index) => records[index]!.id,
    schema,
  }),
);
assert.equal(compact.columns.y.value instanceof Float32Array, true);
assert.equal(compact.columns.ids[2], 'three');
assert.equal(compact.columns.rotationDegrees, undefined);
assert.equal(compact.columns.rotation, compact.columns.rotationRadians);

const datetimeSchema: FastScatterDatasetSchema = {
  version: 1,
  columns: [
    { key: 'id', role: 'id' },
    { axisType: 'datetime-ns', key: 'timestampNs', role: 'x' },
    { axisType: 'numeric', key: 'value', role: 'y' },
  ],
  plots: [{ id: 'value', y: { column: 'value' } }],
  x: { column: 'timestampNs' },
};
const datetimeRecords = [
  { id: 'a', timestampNs: '1717200000000000000', value: 1 },
  { id: 'b', timestampNs: '1717200001000000000', value: 2 },
  { id: 'c', timestampNs: '1717200002000000000', value: 3 },
];
const datetimeLoaded = await loadFastScatterRecordBatchSource({
  batches: (async function* () {
    yield datetimeRecords.slice(0, 2);
    yield datetimeRecords.slice(2);
  })(),
  count: datetimeRecords.length,
  schema: datetimeSchema,
});
assert.deepEqual(Array.from(datetimeLoaded.columns.x), [0, 1000, 2000]);
const datetimeAxis = (
  datetimeLoaded.columns as typeof datetimeLoaded.columns & {
    axisByColumn: Record<string, { epochNsValues: readonly string[] }>;
  }
).axisByColumn.timestampNs;
assert.equal(datetimeAxis?.epochNsValues[2], datetimeRecords[2]!.timestampNs);

await assert.rejects(
  loadFastScatterRecordBatchSource(
    createFastScatterJsonRecordBatchSource(createChunkedStream(json, 9), {
      batchSize: 2,
      count: records.length + 1,
      schema,
    }),
  ),
  /Stream ended after 3 records; expected 4/u,
);

function createChunkedStream(value: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

console.log('scatterWebgpuStreaming tests passed');
