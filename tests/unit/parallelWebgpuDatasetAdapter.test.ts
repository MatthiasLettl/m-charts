import assert from 'node:assert/strict';

import {
  decodeParallelPackedStyleRgba,
  getParallelWebgpuDemoAxisSchema,
  loadParallelWebgpuDataset,
} from '../../apps/demo/src/data/parallelWebgpuDatasetAdapter.ts';

const red5 = 19;
const green6 = 41;
const blue5 = 7;
const alpha4 = 11;
const packedScatterStyle = (
  red5 |
  (green6 << 5) |
  (blue5 << 11) |
  (alpha4 << 16) |
  (5 << 20) |
  (37 << 23) |
  (6 << 29)
) >>> 0;
const rgba = decodeParallelPackedStyleRgba(packedScatterStyle);

assert.equal(rgba & 255, Math.round(red5 / 31 * 255));
assert.equal((rgba >>> 8) & 255, Math.round(green6 / 63 * 255));
assert.equal((rgba >>> 16) & 255, Math.round(blue5 / 31 * 255));
assert.equal(rgba >>> 24, alpha4 * 17);

const singleTableSchema = getParallelWebgpuDemoAxisSchema('single');
assert.deepEqual(singleTableSchema.axisOrder, [
  'timestamp',
  'phase',
  'accepted',
  'signalValue',
]);

const multiTableSchema = getParallelWebgpuDemoAxisSchema('multi');
assert.deepEqual(multiTableSchema.axisOrder, [
  'timestampNs',
  'signalValue',
  'phase',
  'accepted',
  'secondarySignal',
  'secondaryDrift',
  'table',
]);
assert.deepEqual(
  multiTableSchema.axes.map(({ key, label, unit }) => ({ key, label, unit })),
  [
    { key: 'timestampNs', label: 'Timestamp', unit: 'UTC' },
    { key: 'signalValue', label: 'Signal value', unit: 'a.u.' },
    { key: 'phase', label: 'Process phase', unit: undefined },
    { key: 'accepted', label: 'Acceptance', unit: undefined },
    { key: 'secondarySignal', label: 'Secondary signal', unit: 'a.u.' },
    { key: 'secondaryDrift', label: 'Secondary drift', unit: 'a.u.' },
    { key: 'table', label: 'Table', unit: undefined },
  ],
);

const originalWorker = globalThis.Worker;
const originalFetch = globalThis.fetch;

class ParallelDatasetWorkerStub extends EventTarget {
  postMessage(message: { type: 'configure' | 'load' }): void {
    queueMicrotask(() => {
      if (message.type === 'load') {
        this.dispatchEvent(new MessageEvent('message', {
          data: {
            byteLength: 32,
            manifest: createManifest(),
            type: 'manifest',
          },
        }));
        return;
      }
      const coordinateBuffer = new ArrayBuffer(16);
      new Uint8Array(coordinateBuffer, 0, 4).set([0, 1, 2, 3]);
      new Uint8Array(coordinateBuffer, 4, 4).set([1, 1, 0, 1]);
      new Uint16Array(coordinateBuffer, 8, 4).set([10_000, 20_000, 30_000, 40_000]);
      const styleBuffer = new Uint32Array([0xfffff, 0xfffff, 0xfffff, 0xfffff])
        .buffer;
      this.dispatchEvent(new MessageEvent('message', {
        data: {
          coordinateBuffer,
          count: 4,
          densityStyles: new Uint32Array(2).buffer,
          packedValues: new Uint32Array(14).buffer,
          pageIndex: 0,
          start: 0,
          styleBuffer,
          type: 'page',
        },
      }));
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
        data: {
          representativeSourceIndices: Uint32Array.from([0, 1, 2, 3, 4, 5]).buffer,
          type: 'complete',
        },
      })));
    });
  }

  terminate(): void {}
}

function createManifest() {
  return {
    columnScales: { signalValue: 0.0025 },
    count: 4,
    domains: {
      accepted: { max: 1, min: 0 },
      phase: { max: 3.5, min: -0.5 },
      signalValue: { max: 40_000, min: 10_000 },
      timestampNs: { max: 3, min: 0 },
    },
    format: 'm-scatter-webgpu-paged',
    idPrefix: 'sf-',
    idWidth: 6,
    maxPointSize: 6,
    pageSize: 4,
    pages: [{
      binary: 'coordinates.bin',
      byteLength: 16,
      columns: {
        accepted: { byteLength: 4, byteOffset: 4, length: 4, type: 'Uint8Array' },
        phase: { byteLength: 4, byteOffset: 0, length: 4, type: 'Uint8Array' },
        signalValue: { byteLength: 8, byteOffset: 8, length: 4, type: 'Uint16Array' },
      },
      count: 4,
      startIndex: 0,
      styleBinary: 'styles.bin',
      styleByteLength: 16,
    }],
    seed: 1,
    styleStrideBytes: 4,
    timestampOriginNs: '1717200000000000000',
    version: 7,
    xScaleMs: 250,
    xStorage: 'generated-overlap-index',
  } as const;
}

Object.defineProperty(globalThis, 'Worker', {
  configurable: true,
  value: ParallelDatasetWorkerStub,
  writable: true,
});
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value: async () => new Response(JSON.stringify({
    metadata: { count: 2 },
    tables: [{
      name: 'benchmark-secondary',
      records: [
        {
          accepted: false,
          color: '#DC2626',
          id: 'secondary-0',
          opacity: 0.75,
          phase: 'ramp',
          secondaryDrift: 7,
          secondarySignal: 55,
          signalValue: 60,
          timestampNs: '1717200001000000000',
        },
        {
          accepted: true,
          color: '#059669',
          id: 'secondary-1',
          opacity: 0.5,
          phase: 'steady',
          secondaryDrift: 9,
          secondarySignal: 65,
          signalValue: 70,
          timestampNs: '1717200002000000000',
        },
      ],
    }],
  })),
  writable: true,
});

try {
  const loaded = await loadParallelWebgpuDataset({
    fixtureUrl: '/data/mixed-table-fixture.json',
    pointCount: 4,
    signal: new AbortController().signal,
    startedAt: performance.now(),
    tableMode: 'multi',
  });
  const streamedPages = [];
  for await (const page of loaded.buffers.webgpuPackedData!.createPages()) {
    streamedPages.push(page);
  }
  assert.equal(streamedPages.length, 1);
  assert.deepEqual(
    await loaded.buffers.webgpuPackedData!.representativeSourceIndices,
    Uint32Array.from([0, 1, 2, 3, 4, 5]),
  );
  assert.equal(loaded.buffers.recordCount, 6);
  assert.deepEqual(loaded.buffers.axisOrder, multiTableSchema.axisOrder);
  assert.equal(loaded.buffers.axisMetadataByAxis?.timestampNs?.kind, 'datetime-ns');
  assert.equal(loaded.buffers.rawValuesByAxis.timestampNs?.[1], 250);
  assert.equal(loaded.buffers.rawValuesByAxis.timestampNs?.[4], 1_000);
  assert.ok(Number.isNaN(loaded.buffers.rawValuesByAxis.secondarySignal?.[0]));
  assert.equal(loaded.buffers.rawValuesByAxis.secondarySignal?.[4], 55);
  assert.equal(loaded.buffers.rawValuesByAxis.secondaryDrift?.[5], 9);
  assert.deepEqual(loaded.tableRecordCounts, {
    'benchmark-primary': 4,
    'benchmark-secondary': 2,
  });
} finally {
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: originalWorker,
    writable: true,
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: originalFetch,
    writable: true,
  });
}

console.log('parallel WebGPU dataset adapter tests passed');
