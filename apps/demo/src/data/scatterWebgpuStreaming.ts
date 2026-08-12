import type {
  FastScatterDataDomain,
  FastScatterEncodedAxis,
  FastScatterPlotSpec,
  FastScatterPointColumns,
  FastScatterTypedNumericArray,
} from 'm-charts/m-scatter';
import {
  adaptMixedTablesForFastScatter,
  createPaddedFastScatterDomainRange,
} from 'm-charts/m-scatter';
import type {
  FastScatterWebgpuStreamBatch,
  FastScatterWebgpuStreamSource,
} from 'm-charts/m-scatter-webgpu';
import {
  createFastScatterJsonRecordBatchSource,
  createFastScatterWebgpuStreamSourceFromRecordBatches,
} from 'm-charts/m-scatter-webgpu';

import {
  SCATTER_WEBGPU_DEFAULT_SEED,
  type ScatterWebgpuGeneratedPage,
  type ScatterWebgpuPagedManifest,
  type ScatterWebgpuPagedManifestPage,
} from './scatterWebgpuDatasetFormat.ts';
import {
  getStoredScatterWebgpuDataset,
  readStoredScatterWebgpuPage,
  type StoredScatterWebgpuDataset,
} from './scatterWebgpuDatasetStore.ts';
import { loadFastPlotMixedTableFixture } from './fastPlotTableSources.ts';
import {
  WEBGPU_SERVER_STREAM_BATCH_SIZE,
  WEBGPU_SERVER_STREAM_COUNT,
  WEBGPU_SERVER_STREAM_COUNT_HEADER,
  WEBGPU_SERVER_STREAM_ENDPOINT,
  WEBGPU_SERVER_STREAM_PROTOCOL,
  WEBGPU_SERVER_STREAM_PROTOCOL_HEADER,
  WEBGPU_SERVER_STREAM_SCHEMA,
} from './webgpuServerStreamProtocol.ts';

export const SCATTER_WEBGPU_HTTP_STREAM_MANIFEST_URL =
  '/data/scatter-webgpu-stream.json';

const X_SCALE_MS = 250;
const SIGNAL_SCALE = 0.0025;
// Keep worker deliveries below a frame-sized main-thread copy/upload slice. The
// stored dataset uses larger pages for throughput, but live streaming benefits
// from smaller batches because each delivery is copied into the resident CPU
// columns and queued into several GPU buffers before control returns to input.
const LOCAL_STREAM_BATCH_SIZE = 65_536;

export type ScatterWebgpuDemoStreamKind = 'function' | 'http' | 'local';

export interface PreparedScatterWebgpuDemoStream {
  readonly firstBatch: FastScatterWebgpuStreamBatch;
  readonly missingValueCountByColumn: Readonly<Record<string, number>>;
  readonly pointCount: number;
  readonly source: FastScatterWebgpuStreamSource;
  readonly sourceUrl: string;
  readonly tableNames: readonly string[];
  readonly tableRecordCounts: Readonly<Record<string, number>>;
}

export async function prepareScatterWebgpuDemoStream(options: {
  batchSize?: number;
  kind: ScatterWebgpuDemoStreamKind;
  pointCount: number;
  secondaryFixtureUrl?: string;
  signal: AbortSignal;
}): Promise<PreparedScatterWebgpuDemoStream> {
  let prepared = options.kind === 'function'
    ? await createFunctionStream(options.signal)
    : options.kind === 'http'
      ? await createHttpStream(options.signal)
      : await createLocalStream(options.pointCount, options.signal, options.batchSize);
  if (options.secondaryFixtureUrl !== undefined) {
    prepared = await appendSecondaryTableStream(
      prepared,
      options.secondaryFixtureUrl,
      options.kind,
    );
  }
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
    missingValueCountByColumn: prepared.missingValueCountByColumn,
    pointCount: prepared.pointCount,
    source,
    sourceUrl: prepared.sourceUrl,
    tableNames: prepared.tableNames,
    tableRecordCounts: prepared.tableRecordCounts,
  };
}

type UnpreparedScatterWebgpuDemoStream = Omit<
  PreparedScatterWebgpuDemoStream,
  'firstBatch'
>;

async function createLocalStream(
  pointCount: number,
  signal: AbortSignal,
  batchSize = LOCAL_STREAM_BATCH_SIZE,
): Promise<UnpreparedScatterWebgpuDemoStream> {
  const stored = await getStoredScatterWebgpuDataset(pointCount);
  if (stored === null) {
    return createGeneratedLocalStream(pointCount, signal, batchSize);
  }
  const manifest = stored.manifest;
  validateManifest(manifest);
  const rawDomain = createManifestRawDomain(manifest);
  return {
    missingValueCountByColumn: createZeroMissingValueCounts(STREAM_SPEC),
    pointCount: manifest.count,
    source: {
      batches: {
        [Symbol.asyncIterator]: () => streamStoredPages(stored, signal, batchSize),
      },
      domain: createPaddedStreamDomain(rawDomain),
      expectedCount: manifest.count,
      idAt: (sourceIndex) => formatId(manifest.idPrefix, manifest.idWidth, sourceIndex),
      initialCapacity: manifest.pages[0]?.count ?? 1,
      maxPointSize: manifest.maxPointSize,
      spec: STREAM_SPEC,
    },
    sourceUrl: `indexeddb://${stored.datasetId}`,
    tableNames: ['benchmark-primary'],
    tableRecordCounts: { 'benchmark-primary': manifest.count },
  };
}

function createGeneratedLocalStream(
  pointCount: number,
  signal: AbortSignal,
  batchSize: number,
): UnpreparedScatterWebgpuDemoStream {
  const idWidth = Math.max(6, String(Math.max(0, pointCount - 1)).length);
  const rawDomain = createStreamRawDomain(pointCount);
  return {
    missingValueCountByColumn: createZeroMissingValueCounts(STREAM_SPEC),
    pointCount,
    source: {
      batches: {
        [Symbol.asyncIterator]: () => streamWorkerPages(pointCount, signal, batchSize),
      },
      domain: createPaddedStreamDomain(rawDomain),
      expectedCount: pointCount,
      idAt: (sourceIndex) => formatId('sf-', idWidth, sourceIndex),
      maxPointSize: 8,
      spec: STREAM_SPEC,
    },
    sourceUrl: `worker://scatter-webgpu-stream/${pointCount}`,
    tableNames: ['benchmark-primary'],
    tableRecordCounts: { 'benchmark-primary': pointCount },
  };
}

async function* streamStoredPages(
  stored: StoredScatterWebgpuDataset,
  signal: AbortSignal,
  batchSize: number,
): AsyncGenerator<FastScatterWebgpuStreamBatch> {
  const manifest = stored.manifest;
  const domain = createManifestRawDomain(manifest);
  for (let pageIndex = 0; pageIndex < manifest.pages.length; pageIndex += 1) {
    if (signal.aborted) throw signal.reason;
    const page = manifest.pages[pageIndex]!;
    const [coordinateBuffer, styleBuffer] = await Promise.all([
      readStoredScatterWebgpuPage(stored.datasetId, 'coordinates', pageIndex),
      readStoredScatterWebgpuPage(stored.datasetId, 'styles', pageIndex),
    ]);
    if (signal.aborted) throw signal.reason;
    for (let localOffset = 0; localOffset < page.count; localOffset += batchSize) {
      const count = Math.min(batchSize, page.count - localOffset);
      const batchPage = sliceManifestPage(page, localOffset, count);
      yield createBatchFromPage(
        batchPage,
        coordinateBuffer,
        styleBuffer.slice(
          localOffset * Uint32Array.BYTES_PER_ELEMENT,
          (localOffset + count) * Uint32Array.BYTES_PER_ELEMENT,
        ),
        domain,
        manifest.idPrefix,
        manifest.idWidth,
        BigInt(manifest.timestampOriginNs),
        manifest.xScaleMs ?? X_SCALE_MS,
      );
    }
  }
}

function sliceManifestPage(
  page: ScatterWebgpuPagedManifestPage,
  localOffset: number,
  count: number,
): ScatterWebgpuPagedManifestPage {
  return {
    ...page,
    count,
    startIndex: page.startIndex + localOffset,
    columns: Object.fromEntries(Object.entries(page.columns).map(([key, column]) => [
      key,
      {
        ...column,
        byteLength: count * (column.byteLength / column.length),
        byteOffset: column.byteOffset + localOffset * (column.byteLength / column.length),
        length: count,
      },
    ])),
  };
}

async function appendSecondaryTableStream(
  primary: UnpreparedScatterWebgpuDemoStream,
  fixtureUrl: string,
  kind: ScatterWebgpuDemoStreamKind,
): Promise<UnpreparedScatterWebgpuDemoStream> {
  const { fixture } = await loadFastPlotMixedTableFixture(fixtureUrl);
  const secondary = adaptMixedTablesForFastScatter(fixture);
  const secondaryCount = secondary.columns.x.length;
  const totalCount = primary.pointCount + secondaryCount;
  const spec: FastScatterPlotSpec = {
    plots: [
      ...primary.source.spec.plots,
      ...secondary.spec.plots.filter(
        (plot) => !primary.source.spec.plots.some(
          (primaryPlot) => primaryPlot.yKey === plot.yKey,
        ),
      ),
    ],
    xLabel: primary.source.spec.xLabel,
  };
  const domain = createCombinedStreamDomain(
    primary.source.domain,
    secondary.columns,
    spec,
    totalCount,
    kind,
  );
  const primaryTable = primary.tableNames[0] ?? 'benchmark-primary';
  const secondaryTable = secondary.metadata.tableNames[0] ?? 'benchmark-secondary';
  const secondaryBatch = createSecondaryScatterBatch(
    secondary.columns,
    spec,
    primary.pointCount,
    secondaryTable,
    kind,
  );
  const missingValueCountByColumn = Object.fromEntries(spec.plots.map((plot) => {
    const primaryMissing = primary.source.spec.plots.some(
      (primaryPlot) => primaryPlot.yKey === plot.yKey,
    )
      ? primary.missingValueCountByColumn[plot.yKey] ?? 0
      : primary.pointCount;
    const secondaryValues = secondary.columns.y[plot.yKey];
    let secondaryMissing = 0;
    if (secondaryValues === undefined) {
      secondaryMissing = secondaryCount;
    } else {
      for (let index = 0; index < secondaryValues.length; index += 1) {
        if (!Number.isFinite(secondaryValues[index])) secondaryMissing += 1;
      }
    }
    return [plot.yKey, primaryMissing + secondaryMissing];
  }));
  const batches = primary.source.batches;
  return {
    missingValueCountByColumn,
    pointCount: totalCount,
    source: {
      ...primary.source,
      batches: {
        async *[Symbol.asyncIterator]() {
          let sourceOffset = 0;
          for await (const batch of batches) {
            yield normalizePrimaryTableBatch(
              batch,
              spec,
              primaryTable,
              sourceOffset,
            );
            sourceOffset += batch.columns.x.length;
          }
          if (secondaryCount > 0) yield secondaryBatch;
        },
      },
      domain,
      expectedCount: totalCount,
      spec,
    },
    sourceUrl: `${primary.sourceUrl} + ${fixtureUrl}`,
    tableNames: [primaryTable, ...secondary.metadata.tableNames],
    tableRecordCounts: {
      ...primary.tableRecordCounts,
      ...secondary.metadata.tableRecordCounts,
    },
  };
}

function normalizePrimaryTableBatch(
  batch: FastScatterWebgpuStreamBatch,
  spec: FastScatterPlotSpec,
  table: string,
  sourceOffset: number,
): FastScatterWebgpuStreamBatch {
  const count = batch.columns.x.length;
  const y: Record<string, FastScatterTypedNumericArray> = { ...batch.columns.y };
  for (const plot of spec.plots) {
    if (y[plot.yKey] !== undefined) continue;
    const missing = new Float32Array(count);
    missing.fill(Number.NaN);
    y[plot.yKey] = missing;
  }
  const tableBySourceIndex = createLazyConstantValues(table, count);
  const sourceIndex = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    sourceIndex[index] = sourceOffset + index;
  }
  return {
    ...batch,
    columns: {
      ...batch.columns,
      recordIdentityBySourceIndex: createLazyRecordIdentities(
        batch.columns.ids,
        tableBySourceIndex,
        sourceOffset,
      ),
      sourceIndex,
      tableBySourceIndex,
      y,
    },
  };
}

function createSecondaryScatterBatch(
  columns: FastScatterPointColumns,
  spec: FastScatterPlotSpec,
  sourceOffset: number,
  fallbackTable: string,
  kind: ScatterWebgpuDemoStreamKind,
): FastScatterWebgpuStreamBatch {
  const count = columns.x.length;
  const x = kind === 'function'
    ? new Float64Array(count)
    : new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    x[index] = generatedOverlapXValue(sourceOffset + index) *
      (kind === 'function' ? X_SCALE_MS : 1);
  }
  const y: Record<string, FastScatterTypedNumericArray> = {};
  for (const plot of spec.plots) {
    const values = columns.y[plot.yKey];
    if (values !== undefined) {
      if (kind === 'function') {
        y[plot.yKey] = Float32Array.from(values);
      } else if (plot.yKey === 'phase' || plot.yKey === 'accepted') {
        y[plot.yKey] = Uint8Array.from(values);
      } else if (plot.yKey === 'signalValue') {
        const encoded = new Uint16Array(count);
        for (let index = 0; index < count; index += 1) {
          encoded[index] = Math.max(
            0,
            Math.min(65_535, Math.round((values[index] ?? 0) / SIGNAL_SCALE)),
          );
        }
        y[plot.yKey] = encoded;
      } else {
        y[plot.yKey] = Float32Array.from(values);
      }
    } else {
      const missing = new Float32Array(count);
      missing.fill(Number.NaN);
      y[plot.yKey] = missing;
    }
  }
  const tableBySourceIndex = columns.tableBySourceIndex ??
    createLazyConstantValues(fallbackTable, count);
  const sourceIndex = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) sourceIndex[index] = sourceOffset + index;
  return {
    columns: {
      ids: columns.ids,
      ...(kind !== 'function'
        ? {}
        : {
            ...(columns.color === undefined ? {} : { color: columns.color }),
            ...(columns.colorFormat === undefined
              ? {}
              : { colorFormat: columns.colorFormat }),
            ...(columns.opacity === undefined ? {} : { opacity: columns.opacity }),
            ...(columns.rotation === undefined ? {} : { rotation: columns.rotation }),
            ...(columns.shape === undefined ? {} : { shape: columns.shape }),
            ...(columns.size === undefined ? {} : { size: columns.size }),
          }),
      recordIdentityBySourceIndex: createLazyRecordIdentities(
        columns.ids,
        tableBySourceIndex,
        sourceOffset,
      ),
      sourceIndex,
      tableBySourceIndex,
      x,
      ...(columns.xKey === undefined ? {} : { xKey: columns.xKey }),
      y,
    },
    packedStyles: packCompactStyles(columns),
  };
}

function createCombinedStreamDomain(
  primary: FastScatterDataDomain | undefined,
  secondary: FastScatterPointColumns,
  spec: FastScatterPlotSpec,
  totalCount: number,
  kind: ScatterWebgpuDemoStreamKind,
): FastScatterDataDomain | undefined {
  if (primary === undefined) return undefined;
  const yByPlot = { ...primary.yByPlot };
  for (const plot of spec.plots) {
    const values = secondary.y[plot.yKey];
    let min = yByPlot[plot.id]?.min ?? Number.POSITIVE_INFINITY;
    let max = yByPlot[plot.id]?.max ?? Number.NEGATIVE_INFINITY;
    if (values !== undefined) {
      for (let index = 0; index < values.length; index += 1) {
        const value = values[index] ?? Number.NaN;
        if (!Number.isFinite(value)) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    yByPlot[plot.id] = Number.isFinite(min) && Number.isFinite(max)
      ? { min, max }
      : { min: 0, max: 1 };
  }
  return {
    x: {
      min: primary.x.min,
      max: generatedOverlapXValue(totalCount - 1) *
        (kind === 'function' ? X_SCALE_MS : 1),
    },
    yByPlot,
  };
}

function createLazyConstantValues<T>(value: T, length: number): readonly T[] {
  return new Proxy({ length }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property !== 'string' || !/^(0|[1-9]\d*)$/u.test(property)) {
        return Reflect.get(Array.prototype, property);
      }
      return Number(property) < length ? value : undefined;
    },
  }) as unknown as readonly T[];
}

function createLazyRecordIdentities(
  ids: readonly string[],
  tables: readonly string[],
  sourceOffset: number,
): NonNullable<FastScatterPointColumns['recordIdentityBySourceIndex']> {
  return new Proxy({ length: ids.length }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property !== 'string' || !/^(0|[1-9]\d*)$/u.test(property)) {
        return Reflect.get(Array.prototype, property);
      }
      const index = Number(property);
      return index < ids.length
        ? {
            id: ids[index] ?? String(sourceOffset + index),
            sourceIndex: sourceOffset + index,
            table: tables[index] ?? 'benchmark-primary',
          }
        : undefined;
    },
  }) as unknown as NonNullable<FastScatterPointColumns['recordIdentityBySourceIndex']>;
}

function packCompactStyles(columns: FastScatterPointColumns): Uint32Array {
  const result = new Uint32Array(columns.x.length);
  for (let index = 0; index < columns.x.length; index += 1) {
    const colorOffset = index * 4;
    const color = columns.color;
    const red = color instanceof Uint32Array
      ? color[index]! & 0xff
      : color?.[colorOffset] ?? 37;
    const green = color instanceof Uint32Array
      ? (color[index]! >>> 8) & 0xff
      : color?.[colorOffset + 1] ?? 99;
    const blue = color instanceof Uint32Array
      ? (color[index]! >>> 16) & 0xff
      : color?.[colorOffset + 2] ?? 235;
    const alpha = color instanceof Uint32Array
      ? (color[index]! >>> 24) & 0xff
      : color?.[colorOffset + 3] ?? 255;
    const opacity = Math.round(
      Math.max(0, Math.min(1, columns.opacity?.[index] ?? 1)) * 255,
    );
    const shape = Math.max(0, Math.min(7, columns.shape?.[index] ?? 0));
    const rotation = columns.rotationRadians?.[index] ?? columns.rotation?.[index] ?? 0;
    const fullTurn = Math.PI * 2;
    const signedRotation = ((rotation + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
    const normalizedRotation = (signedRotation + Math.PI) / fullTurn;
    const size = Math.max(0, columns.size?.[index] ?? 3);
    const rgb565 = Math.round((red / 255) * 31) |
      (Math.round((green / 255) * 63) << 5) |
      (Math.round((blue / 255) * 31) << 11);
    result[index] = (
      rgb565 |
      (Math.round(((opacity * alpha) / (255 * 255)) * 15) << 16) |
      (shape << 20) |
      (Math.round(normalizedRotation * 63) << 23) |
      (Math.max(0, Math.min(7, Math.round(size - 1))) << 29)
    ) >>> 0;
  }
  return result;
}

async function createHttpStream(
  signal: AbortSignal,
): Promise<UnpreparedScatterWebgpuDemoStream> {
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
    missingValueCountByColumn: createZeroMissingValueCounts(STREAM_SPEC),
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
    tableNames: ['benchmark-primary'],
    tableRecordCounts: { 'benchmark-primary': manifest.count },
  };
}

async function createFunctionStream(
  signal: AbortSignal,
): Promise<UnpreparedScatterWebgpuDemoStream> {
  const response = await fetch(WEBGPU_SERVER_STREAM_ENDPOINT, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `Server-function stream is unavailable (${response.status} ${response.statusText}).`,
    );
  }
  if (response.body === null) {
    throw new Error('Server-function stream response does not have a readable body.');
  }
  const protocol = response.headers.get(WEBGPU_SERVER_STREAM_PROTOCOL_HEADER);
  if (protocol !== WEBGPU_SERVER_STREAM_PROTOCOL) {
    await response.body.cancel().catch(() => undefined);
    throw new Error('Server-function stream uses an unsupported protocol version.');
  }
  const count = Number(response.headers.get(WEBGPU_SERVER_STREAM_COUNT_HEADER));
  if (
    !Number.isSafeInteger(count) || count < 1 ||
    count > WEBGPU_SERVER_STREAM_COUNT
  ) {
    await response.body.cancel().catch(() => undefined);
    throw new Error('Server-function stream supplied an invalid record-count header.');
  }
  const records = createFastScatterJsonRecordBatchSource(response.body, {
    batchSize: WEBGPU_SERVER_STREAM_BATCH_SIZE,
    count,
    numericStorage: 'float32',
    schema: WEBGPU_SERVER_STREAM_SCHEMA,
  });
  const recordSource = createFastScatterWebgpuStreamSourceFromRecordBatches(records);
  return {
    missingValueCountByColumn: createZeroMissingValueCounts(STREAM_SPEC),
    pointCount: count,
    source: {
      ...recordSource,
      batches: mapFunctionRecordBatches(recordSource.batches),
      domain: createFunctionStreamDomain(count),
      maxPointSize: 8,
    },
    sourceUrl: WEBGPU_SERVER_STREAM_ENDPOINT,
    tableNames: ['benchmark-primary'],
    tableRecordCounts: { 'benchmark-primary': count },
  };
}

function mapFunctionRecordBatches(
  batches: AsyncIterable<FastScatterWebgpuStreamBatch>,
): AsyncIterable<FastScatterWebgpuStreamBatch> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const batch of batches) {
        yield {
          ...batch,
          packedStyles: packCompactStyles(batch.columns),
        };
      }
    },
  };
}

function createFunctionStreamDomain(count: number): FastScatterDataDomain {
  return {
    x: {
      min: 0,
      max: Math.max(1, generatedOverlapXValue(count - 1) * X_SCALE_MS),
    },
    yByPlot: {
      accepted: { min: -0.5, max: 1.5 },
      phase: { min: -0.5, max: 3.5 },
      signal: { min: 25, max: 110 },
    },
  };
}

async function* streamWorkerPages(
  pointCount: number,
  signal: AbortSignal,
  batchSize: number,
): AsyncGenerator<FastScatterWebgpuStreamBatch> {
  const worker = new Worker(
    new URL('../workers/scatterWebgpuDataset.worker.ts', import.meta.url),
    { type: 'module' },
  );
  try {
    let messagePromise = waitForWorkerMessage(worker, signal);
    worker.postMessage({
      count: pointCount,
      pageSize: batchSize,
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

function createZeroMissingValueCounts(
  spec: FastScatterPlotSpec,
): Readonly<Record<string, number>> {
  return Object.fromEntries(spec.plots.map((plot) => [plot.yKey, 0]));
}
