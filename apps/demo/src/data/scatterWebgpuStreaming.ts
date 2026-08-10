import type {
  FastScatterDataDomain,
  FastScatterEncodedAxis,
  FastScatterPlotSpec,
  FastScatterPointColumns,
} from 'm-charts/m-scatter';
import { createPaddedFastScatterDomainRange } from 'm-charts/m-scatter';
import type {
  FastScatterWebgpuStreamBatch,
  FastScatterWebgpuStreamSource,
} from 'm-charts/m-scatter-webgpu';

import {
  SCATTER_WEBGPU_DEFAULT_SEED,
  type ScatterWebgpuGeneratedPage,
  type ScatterWebgpuPagedManifest,
  type ScatterWebgpuPagedManifestPage,
} from './scatterWebgpuDatasetFormat.ts';

export const SCATTER_WEBGPU_HTTP_STREAM_MANIFEST_URL =
  '/data/scatter-webgpu-stream.json';

const X_SCALE_MS = 250;
const SIGNAL_SCALE = 0.0025;
// Keep worker deliveries below a frame-sized main-thread copy/upload slice. The
// stored dataset uses larger pages for throughput, but live streaming benefits
// from smaller batches because each delivery is copied into the resident CPU
// columns and queued into several GPU buffers before control returns to input.
const LOCAL_STREAM_BATCH_SIZE = 65_536;

export type ScatterWebgpuDemoStreamKind = 'http' | 'local';

export interface PreparedScatterWebgpuDemoStream {
  readonly firstBatch: FastScatterWebgpuStreamBatch;
  readonly pointCount: number;
  readonly source: FastScatterWebgpuStreamSource;
  readonly sourceUrl: string;
}

export async function prepareScatterWebgpuDemoStream(options: {
  kind: ScatterWebgpuDemoStreamKind;
  pointCount: number;
  signal: AbortSignal;
}): Promise<PreparedScatterWebgpuDemoStream> {
  const prepared = options.kind === 'http'
    ? await createHttpStream(options.signal)
    : createLocalStream(options.pointCount, options.signal);
  const iterator = prepared.source.batches[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done || first.value.columns.x.length === 0) {
    await iterator.return?.();
    throw new Error('The WebGPU demo stream did not produce an initial batch.');
  }
  const firstBatch = first.value;
  let claimed = false;
  const source: FastScatterWebgpuStreamSource = {
    ...prepared.source,
    batches: {
      async *[Symbol.asyncIterator]() {
        if (claimed) {
          throw new Error('The prepared WebGPU demo stream was already consumed.');
        }
        claimed = true;
        try {
          yield firstBatch;
          while (true) {
            const next = await iterator.next();
            if (next.done) return;
            yield next.value;
          }
        } finally {
          await iterator.return?.();
        }
      },
    },
  };
  return {
    firstBatch,
    pointCount: prepared.pointCount,
    source,
    sourceUrl: prepared.sourceUrl,
  };
}

function createLocalStream(
  pointCount: number,
  signal: AbortSignal,
): Omit<PreparedScatterWebgpuDemoStream, 'firstBatch'> {
  const idWidth = Math.max(6, String(Math.max(0, pointCount - 1)).length);
  const rawDomain = createStreamRawDomain(pointCount);
  return {
    pointCount,
    source: {
      batches: {
        [Symbol.asyncIterator]: () => streamWorkerPages(pointCount, signal),
      },
      domain: createPaddedStreamDomain(rawDomain),
      expectedCount: pointCount,
      idAt: (sourceIndex) => formatId('sf-', idWidth, sourceIndex),
      maxPointSize: 8,
      spec: STREAM_SPEC,
    },
    sourceUrl: `worker://scatter-webgpu-stream/${pointCount}`,
  };
}

async function createHttpStream(
  signal: AbortSignal,
): Promise<Omit<PreparedScatterWebgpuDemoStream, 'firstBatch'>> {
  const response = await fetch(SCATTER_WEBGPU_HTTP_STREAM_MANIFEST_URL, { signal });
  if (!response.ok) {
    throw new Error(
      `HTTP streaming sample is unavailable (${response.status} ${response.statusText}).`,
    );
  }
  const manifest = await response.json() as ScatterWebgpuPagedManifest;
  validateManifest(manifest);
  const rawDomain = createManifestRawDomain(manifest);
  return {
    pointCount: manifest.count,
    source: {
      batches: {
        [Symbol.asyncIterator]: () => streamHttpPages(manifest, response.url, signal),
      },
      domain: createPaddedStreamDomain(rawDomain),
      idAt: (sourceIndex) => formatId(manifest.idPrefix, manifest.idWidth, sourceIndex),
      initialCapacity: manifest.pages[0]?.count ?? 1,
      maxPointSize: manifest.maxPointSize,
      spec: STREAM_SPEC,
    },
    sourceUrl: SCATTER_WEBGPU_HTTP_STREAM_MANIFEST_URL,
  };
}

async function* streamWorkerPages(
  pointCount: number,
  signal: AbortSignal,
): AsyncGenerator<FastScatterWebgpuStreamBatch> {
  const worker = new Worker(
    new URL('../workers/scatterWebgpuDataset.worker.ts', import.meta.url),
    { type: 'module' },
  );
  try {
    let messagePromise = waitForWorkerMessage(worker, signal);
    worker.postMessage({
      count: pointCount,
      pageSize: LOCAL_STREAM_BATCH_SIZE,
      seed: SCATTER_WEBGPU_DEFAULT_SEED,
      type: 'start',
    });
    while (true) {
      const message = await messagePromise;
      if (message.type === 'error') throw new Error(message.message);
      if (message.type === 'complete') return;
      yield createBatchFromPage(
        message.page.manifest,
        message.page.coordinateBuffer,
        message.page.styleBuffer,
        createStreamRawDomain(pointCount),
        'sf-',
        Math.max(6, String(Math.max(0, pointCount - 1)).length),
        BigInt(message.page.timestampOriginNs),
        X_SCALE_MS,
        message.xBuffer,
      );
      messagePromise = waitForWorkerMessage(worker, signal);
      worker.postMessage({ type: 'continue' });
    }
  } finally {
    worker.terminate();
  }
}

async function* streamHttpPages(
  manifest: ScatterWebgpuPagedManifest,
  manifestUrl: string,
  signal: AbortSignal,
): AsyncGenerator<FastScatterWebgpuStreamBatch> {
  const domain = createManifestRawDomain(manifest);
  for (const page of manifest.pages) {
    if (signal.aborted) throw signal.reason;
    const [coordinateResponse, styleResponse] = await Promise.all([
      fetch(new URL(page.binary, manifestUrl), { signal }),
      fetch(new URL(page.styleBinary, manifestUrl), { signal }),
    ]);
    if (!coordinateResponse.ok || !styleResponse.ok) {
      throw new Error(`HTTP streaming page ${page.startIndex} is unavailable.`);
    }
    const [coordinateBuffer, styleBuffer] = await Promise.all([
      coordinateResponse.arrayBuffer(),
      styleResponse.arrayBuffer(),
    ]);
    yield createBatchFromPage(
      page,
      coordinateBuffer,
      styleBuffer,
      domain,
      manifest.idPrefix,
      manifest.idWidth,
      BigInt(manifest.timestampOriginNs),
      manifest.xScaleMs ?? X_SCALE_MS,
    );
  }
}

function createBatchFromPage(
  page: ScatterWebgpuPagedManifestPage,
  coordinateBuffer: ArrayBuffer,
  styleBuffer: ArrayBuffer,
  domain: FastScatterDataDomain,
  idPrefix: string,
  idWidth: number,
  timestampOriginNs: bigint,
  xScaleMs: number,
  preparedXBuffer?: ArrayBuffer,
): FastScatterWebgpuStreamBatch {
  const count = page.count;
  const x = preparedXBuffer === undefined
    ? new Uint32Array(count)
    : new Uint32Array(preparedXBuffer);
  if (x.length !== count) {
    throw new Error(`Streaming X page at ${page.startIndex} has an invalid size.`);
  }
  if (preparedXBuffer === undefined) {
    for (let localIndex = 0; localIndex < count; localIndex += 1) {
      x[localIndex] = generatedOverlapXValue(page.startIndex + localIndex);
    }
  }
  const phase = readPageColumn(
    coordinateBuffer,
    page,
    'phase',
    Uint8Array,
  );
  const accepted = readPageColumn(
    coordinateBuffer,
    page,
    'accepted',
    Uint8Array,
  );
  const signalValue = readPageColumn(
    coordinateBuffer,
    page,
    'signalValue',
    Uint16Array,
  );
  if (styleBuffer.byteLength !== count * Uint32Array.BYTES_PER_ELEMENT) {
    throw new Error(`Streaming style page at ${page.startIndex} has an invalid size.`);
  }
  return {
    columns: {
      axisByColumn: createAxisMap(domain, x, timestampOriginNs, xScaleMs),
      ids: createLazyBatchIds(idPrefix, idWidth, page.startIndex, count),
      x,
      xKey: 'timestampNs',
      y: { accepted, phase, signalValue },
    } as FastScatterPointColumns,
    packedStyles: new Uint32Array(styleBuffer),
  };
}

function readPageColumn<T extends Uint8Array | Uint16Array>(
  buffer: ArrayBuffer,
  page: ScatterWebgpuPagedManifestPage,
  key: string,
  Constructor: {
    readonly BYTES_PER_ELEMENT: number;
    new(buffer: ArrayBuffer, byteOffset: number, length: number): T;
  },
): T {
  const column = page.columns[key];
  if (
    column === undefined || column.length !== page.count ||
    column.byteLength !== page.count * Constructor.BYTES_PER_ELEMENT
  ) {
    throw new Error(`Streaming page column "${key}" is invalid.`);
  }
  return new Constructor(buffer, column.byteOffset, column.length);
}

function createAxisMap(
  domain: FastScatterDataDomain,
  x: Uint32Array,
  timestampOriginNs: bigint,
  xScaleMs: number,
): Readonly<Record<string, FastScatterEncodedAxis>> {
  return {
    accepted: {
      categories: [
        { encoded: 0, label: 'Rejected', value: 'false' },
        { encoded: 1, label: 'Accepted', value: 'true' },
      ],
      columnKey: 'accepted',
      domain: domain.yByPlot.accepted!,
      kind: 'boolean',
      parameterName: 'Acceptance',
      title: 'Acceptance',
    },
    phase: {
      categories: [
        { encoded: 0, label: 'Idle', value: 'idle' },
        { encoded: 1, label: 'Ramp', value: 'ramp' },
        { encoded: 2, label: 'Steady', value: 'steady' },
        { encoded: 3, label: 'Cooldown', value: 'cooldown' },
      ],
      columnKey: 'phase',
      domain: domain.yByPlot.phase!,
      kind: 'categorical',
      parameterName: 'Process phase',
      title: 'Process phase',
    },
    signalValue: {
      columnKey: 'signalValue',
      domain: domain.yByPlot.signal!,
      encodedScale: SIGNAL_SCALE,
      kind: 'numeric',
      parameterName: 'Signal value',
      title: 'Signal value (a.u.)',
      unit: 'a.u.',
    },
    timestampNs: {
      columnKey: 'timestampNs',
      datetimeOriginNs: timestampOriginNs.toString(),
      datetimeOriginNsBigInt: timestampOriginNs,
      domain: domain.x,
      encodedScaleMs: xScaleMs,
      epochNsValues: createLazyEpochNsValues(x, timestampOriginNs, xScaleMs),
      kind: 'datetime-ns',
      parameterName: 'Timestamp',
      title: 'Timestamp (UTC)',
      unit: 'UTC',
    },
  };
}

export function createScatterWebgpuLocalStreamDomain(
  pointCount: number,
): FastScatterDataDomain {
  return createPaddedStreamDomain(createStreamRawDomain(pointCount));
}

function createStreamRawDomain(pointCount: number): FastScatterDataDomain {
  return {
    x: {
      min: 0,
      max: pointCount === 0 ? 0 : generatedOverlapXValue(pointCount - 1),
    },
    yByPlot: {
      accepted: { min: 0, max: 1 },
      phase: { min: -0.5, max: 3.5 },
      signal: {
        min: Math.round(20 / SIGNAL_SCALE),
        max: Math.round(110 / SIGNAL_SCALE),
      },
    },
  };
}

function createManifestRawDomain(manifest: ScatterWebgpuPagedManifest): FastScatterDataDomain {
  return {
    x: manifest.domains.timestampNs ?? createStreamRawDomain(manifest.count).x,
    yByPlot: {
      accepted: manifest.domains.accepted ?? { min: 0, max: 1 },
      phase: manifest.domains.phase ?? { min: -0.5, max: 3.5 },
      signal: manifest.domains.signalValue ?? {
        min: Math.round(1 / SIGNAL_SCALE),
        max: Math.round(160 / SIGNAL_SCALE),
      },
    },
  };
}

function createPaddedStreamDomain(domain: FastScatterDataDomain): FastScatterDataDomain {
  const axes = createAxisMap(domain, new Uint32Array(0), 0n, X_SCALE_MS);
  return {
    x: createPaddedFastScatterDomainRange(domain.x, axes.timestampNs),
    yByPlot: {
      accepted: createPaddedFastScatterDomainRange(
        domain.yByPlot.accepted!,
        axes.accepted,
      ),
      phase: createPaddedFastScatterDomainRange(domain.yByPlot.phase!, axes.phase),
      signal: createPaddedFastScatterDomainRange(
        domain.yByPlot.signal!,
        axes.signalValue,
      ),
    },
  };
}

function validateManifest(manifest: ScatterWebgpuPagedManifest): void {
  if (
    manifest.format !== 'm-scatter-webgpu-paged' ||
    manifest.xStorage !== 'generated-overlap-index' ||
    !Number.isSafeInteger(manifest.count) || manifest.count < 1 ||
    !Array.isArray(manifest.pages) || manifest.pages.length === 0 ||
    (manifest.styleStrideBytes ?? 4) !== 4
  ) {
    throw new Error('The HTTP streaming manifest is incompatible with this demo.');
  }
}

function generatedOverlapXValue(index: number): number {
  const blockStart = Math.floor(index / 24) * 24;
  const offset = index - blockStart;
  if (offset >= 2 && offset < 5) return blockStart + 2;
  if (offset >= 14 && offset < 16) return blockStart + 14;
  return index;
}

function createLazyBatchIds(
  prefix: string,
  width: number,
  startIndex: number,
  count: number,
): readonly string[] {
  return new Proxy({ length: count }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property !== 'string' || !/^(0|[1-9]\d*)$/u.test(property)) {
        return undefined;
      }
      const localIndex = Number(property);
      return localIndex < count
        ? formatId(prefix, width, startIndex + localIndex)
        : undefined;
    },
  }) as unknown as readonly string[];
}

function createLazyEpochNsValues(
  x: Uint32Array,
  timestampOriginNs: bigint,
  xScaleMs: number,
): readonly string[] {
  return new Proxy({ length: x.length }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property !== 'string' || !/^(0|[1-9]\d*)$/u.test(property)) {
        return undefined;
      }
      const index = Number(property);
      return index < x.length
        ? (
            timestampOriginNs +
            BigInt(x[index] ?? 0) * BigInt(Math.round(xScaleMs * 1_000_000))
          ).toString()
        : undefined;
    },
  }) as unknown as readonly string[];
}

function formatId(prefix: string, width: number, index: number): string {
  return `${prefix}${String(index).padStart(width, '0')}`;
}

type WorkerMessage =
  | { manifest: ScatterWebgpuPagedManifest; type: 'complete' }
  | { message: string; type: 'error' }
  | {
      page: ScatterWebgpuGeneratedPage;
      pageCount: number;
      type: 'page';
      xBuffer: ArrayBuffer;
    };

function waitForWorkerMessage(
  worker: Worker,
  signal: AbortSignal,
): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort);
      worker.removeEventListener('error', handleError);
      worker.removeEventListener('message', handleMessage);
    };
    const handleAbort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException('Streaming was aborted.', 'AbortError'));
    };
    const handleError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message));
    };
    const handleMessage = (event: MessageEvent<WorkerMessage>) => {
      cleanup();
      resolve(event.data);
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    worker.addEventListener('error', handleError, { once: true });
    worker.addEventListener('message', handleMessage, { once: true });
    if (signal.aborted) handleAbort();
  });
}

const STREAM_SPEC: FastScatterPlotSpec = {
  plots: [
    { id: 'phase', label: 'Process phase', yKey: 'phase' },
    { id: 'accepted', label: 'Acceptance', yKey: 'accepted' },
    { id: 'signal', label: 'Signal value (a.u.)', yKey: 'signalValue' },
  ],
  xLabel: 'Timestamp (UTC)',
};
