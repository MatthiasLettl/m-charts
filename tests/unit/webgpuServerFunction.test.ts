import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import webgpuStreamHandler, {
  config as webgpuStreamConfig,
  createWebgpuServerStreamResponse,
} from '../../api/webgpu-stream.ts';
import {
  WEBGPU_SERVER_STREAM_BATCH_SIZE,
  WEBGPU_SERVER_STREAM_CHUNK_SIZE_HEADER,
  WEBGPU_SERVER_STREAM_COUNT,
  WEBGPU_SERVER_STREAM_COUNT_HEADER,
  WEBGPU_SERVER_STREAM_PROTOCOL,
  WEBGPU_SERVER_STREAM_PROTOCOL_HEADER,
  WEBGPU_SERVER_STREAM_RECORDS_PER_CHUNK,
  WEBGPU_SERVER_STREAM_SCHEMA,
} from '../../apps/demo/src/data/webgpuServerStreamProtocol.ts';
import { prepareScatterWebgpuDemoStream } from '../../apps/demo/src/data/scatterWebgpuStreaming.ts';
import {
  prepareHistogramWebgpuDemoStream,
  prepareParallelWebgpuDemoStream,
} from '../../apps/demo/src/data/webgpuStreamingAdapters.ts';
import {
  createFastScatterJsonRecordBatchSource,
  createFastScatterWebgpuStreamSourceFromRecordBatches,
} from '../../packages/m-charts/src/m-scatter-webgpu/index.ts';

const vercelConfig = JSON.parse(await readFile(
  new URL('../../vercel.json', import.meta.url),
  'utf8',
)) as {
  fluid?: boolean;
  functions?: Record<string, {
    maxDuration?: number;
    supportsCancellation?: boolean;
  }>;
};
assert.equal(vercelConfig.fluid, true);
assert.deepEqual(vercelConfig.functions?.['api/webgpu-stream.ts'], {
  maxDuration: 10,
  supportsCancellation: true,
});
assert.deepEqual(webgpuStreamConfig, { useWebApi: true });

const request = new Request('https://demo.example/api/webgpu-stream?count=1000000000');
const response = webgpuStreamHandler(request);
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
assert.match(response.headers.get('content-type') ?? '', /^application\/json/u);
assert.equal(
  response.headers.get(WEBGPU_SERVER_STREAM_PROTOCOL_HEADER),
  WEBGPU_SERVER_STREAM_PROTOCOL,
);
assert.equal(
  response.headers.get(WEBGPU_SERVER_STREAM_COUNT_HEADER),
  String(WEBGPU_SERVER_STREAM_COUNT),
);
assert.equal(
  response.headers.get(WEBGPU_SERVER_STREAM_CHUNK_SIZE_HEADER),
  String(WEBGPU_SERVER_STREAM_RECORDS_PER_CHUNK),
);
assert.ok(response.body !== null);

const reader = response.body!.getReader();
const decoder = new TextDecoder();
let transportChunkCount = 0;
let json = '';
while (true) {
  const result = await reader.read();
  if (result.done) break;
  transportChunkCount += 1;
  json += decoder.decode(result.value, { stream: true });
}
json += decoder.decode();
assert.ok(transportChunkCount > 3);
const payload = JSON.parse(json) as {
  count: number;
  protocol: string;
  records: readonly Readonly<Record<string, unknown>>[];
};
assert.equal(payload.protocol, WEBGPU_SERVER_STREAM_PROTOCOL);
assert.equal(payload.count, WEBGPU_SERVER_STREAM_COUNT);
assert.equal(payload.records.length, WEBGPU_SERVER_STREAM_COUNT);
assert.equal(payload.records[0]?.id, 'server-000000');
assert.equal(payload.records.at(-1)?.id, `server-${String(
  WEBGPU_SERVER_STREAM_COUNT - 1,
).padStart(6, '0')}`);

const decodedResponse = createWebgpuServerStreamResponse(
  new Request('https://demo.example/api/webgpu-stream'),
);
assert.ok(decodedResponse.body !== null);
const records = createFastScatterJsonRecordBatchSource(decodedResponse.body!, {
  batchSize: WEBGPU_SERVER_STREAM_BATCH_SIZE,
  count: WEBGPU_SERVER_STREAM_COUNT,
  numericStorage: 'float32',
  schema: WEBGPU_SERVER_STREAM_SCHEMA,
});
const source = createFastScatterWebgpuStreamSourceFromRecordBatches(records);
let decodedCount = 0;
let decodedBatchCount = 0;
for await (const batch of source.batches) {
  decodedBatchCount += 1;
  decodedCount += batch.columns.x.length;
  assert.equal(batch.columns.x.length, batch.columns.y.signalValue?.length);
}
assert.equal(decodedCount, WEBGPU_SERVER_STREAM_COUNT);
assert.equal(
  decodedBatchCount,
  Math.ceil(WEBGPU_SERVER_STREAM_COUNT / WEBGPU_SERVER_STREAM_BATCH_SIZE),
);

const head = createWebgpuServerStreamResponse(
  new Request('https://demo.example/api/webgpu-stream', { method: 'HEAD' }),
);
assert.equal(head.status, 200);
assert.equal(head.body, null);
assert.equal(
  head.headers.get(WEBGPU_SERVER_STREAM_COUNT_HEADER),
  String(WEBGPU_SERVER_STREAM_COUNT),
);

const rejected = createWebgpuServerStreamResponse(
  new Request('https://demo.example/api/webgpu-stream', { method: 'POST' }),
);
assert.equal(rejected.status, 405);
assert.equal(rejected.headers.get('allow'), 'GET, HEAD');

const cancellable = createWebgpuServerStreamResponse(
  new Request('https://demo.example/api/webgpu-stream'),
);
const cancellableReader = cancellable.body!.getReader();
assert.equal((await cancellableReader.read()).done, false);
await cancellableReader.cancel();

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const resolvedUrl = new URL(url, 'https://demo.example');
  if (resolvedUrl.pathname !== '/api/webgpu-stream') {
    return Response.json({
      metadata: {
        axes: [
          { key: 'timestampNs', kind: 'datetime-ns', label: 'Timestamp', role: 'x' },
          { key: 'signalValue', kind: 'numeric', label: 'Signal value', role: 'dimension' },
          { key: 'phase', kind: 'categorical', label: 'Process phase', role: 'dimension' },
          { key: 'accepted', kind: 'boolean', label: 'Acceptance', role: 'dimension' },
          { key: 'secondarySignal', kind: 'numeric', label: 'Secondary signal', role: 'dimension' },
          { key: 'secondaryDrift', kind: 'numeric', label: 'Secondary drift', role: 'dimension' },
        ],
        count: 1,
      },
      tables: [{
        name: 'benchmark-secondary',
        records: [{
          accepted: true,
          color: '#059669',
          id: 'secondary-0',
          opacity: 0.8,
          phase: 'steady',
          rotation: 0,
          secondaryDrift: 7,
          secondarySignal: 55,
          shape: 'circle',
          signalValue: 70,
          size: 4,
          table: 'benchmark-secondary',
          timestampNs: '1717200001000000000',
        }],
      }],
    });
  }
  return createWebgpuServerStreamResponse(new Request(
    resolvedUrl,
    {
      method: input instanceof Request ? input.method : init?.method,
      signal: init?.signal ?? (input instanceof Request ? input.signal : undefined),
    },
  ));
};
try {
  const scatter = await prepareScatterWebgpuDemoStream({
    kind: 'function',
    pointCount: 1_000_000,
    signal: new AbortController().signal,
  });
  assert.equal(scatter.pointCount, WEBGPU_SERVER_STREAM_COUNT);
  assert.equal(await countScatterStream(scatter.source.batches), WEBGPU_SERVER_STREAM_COUNT);

  const histogram = await prepareHistogramWebgpuDemoStream({
    kind: 'function',
    pointCount: 1_000_000,
    signal: new AbortController().signal,
    startedAt: performance.now(),
  });
  let histogramCount = 0;
  for await (const batch of histogram.source.batches) {
    histogramCount += batch.columns.ids.length;
  }
  assert.equal(histogramCount, WEBGPU_SERVER_STREAM_COUNT);
  assert.equal(histogram.metadata.recordCount, WEBGPU_SERVER_STREAM_COUNT);

  const parallel = await prepareParallelWebgpuDemoStream({
    kind: 'function',
    pointCount: 1_000_000,
    signal: new AbortController().signal,
    startedAt: performance.now(),
  });
  let parallelCount = 0;
  for await (const batch of parallel.streamingSource!.batches) {
    parallelCount += batch.columns.ids.length;
  }
  assert.equal(parallelCount, WEBGPU_SERVER_STREAM_COUNT);
  assert.equal(
    parallel.tableRecordCounts['benchmark-primary'],
    WEBGPU_SERVER_STREAM_COUNT,
  );

  const parallelMulti = await prepareParallelWebgpuDemoStream({
    kind: 'function',
    pointCount: 1_000_000,
    secondaryFixtureUrl: '/data/mixed-table-fixture.secondary.json',
    signal: new AbortController().signal,
    startedAt: performance.now(),
  });
  assert.equal(
    parallelMulti.streamingSource?.missingValueCountByAxis?.secondarySignal,
    WEBGPU_SERVER_STREAM_COUNT,
  );
  assert.equal(
    parallelMulti.streamingSource?.missingValueCountByAxis?.secondaryDrift,
    WEBGPU_SERVER_STREAM_COUNT,
  );
  assert.equal(
    await countParallelStream(parallelMulti.streamingSource!.batches),
    WEBGPU_SERVER_STREAM_COUNT + 1,
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('WebGPU server function tests passed');

async function countScatterStream(
  batches: AsyncIterable<{ readonly columns: { readonly x: ArrayLike<number> } }>,
): Promise<number> {
  let count = 0;
  for await (const batch of batches) count += batch.columns.x.length;
  return count;
}

async function countParallelStream(
  batches: AsyncIterable<{ readonly columns: { readonly ids: readonly string[] } }>,
): Promise<number> {
  let count = 0;
  for await (const batch of batches) count += batch.columns.ids.length;
  return count;
}
