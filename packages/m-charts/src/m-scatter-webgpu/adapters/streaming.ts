import {
  calculateFastScatterDomain,
  createDefaultFastScatterViewport,
  encodeFastScatterSchemaRows,
  type FastScatterDatasetSchema,
  type FastScatterDataDomain,
  type FastScatterEncodedAxis,
  type FastScatterEncodedSchemaColumns,
  type FastScatterPlotSpec,
  type FastScatterPointColumns,
  type FastScatterRecordIdentity,
  type FastScatterTypedNumericArray,
  type FastScatterViewport,
} from '../../m-scatter/core/index.js';
import {
  appendFastScatterEngineData,
  finishFastScatterEngineData,
} from '../../m-scatter/engine/createScatterEngine.js';
import { createFastScatterWebgpuPlot } from '../engine/createScatterWebgpuPlot.js';
import type {
  FastScatterWebgpuPlotInstance,
  FastScatterWebgpuPlotOptions,
} from '../engine/types.js';

export interface FastScatterRecordBatchSource {
  readonly batches: AsyncIterable<readonly Readonly<Record<string, unknown>>[]>;
  readonly count: number;
  readonly idAt?: (sourceIndex: number) => string;
  readonly numericStorage?: 'float32' | 'float64';
  readonly schema: FastScatterDatasetSchema;
}

export interface FastScatterStreamProgress {
  readonly loadedCount: number;
  readonly totalCount: number;
}

export interface FastScatterWebgpuStreamBatch {
  readonly columns: FastScatterPointColumns;
  /** Compact WebGPU style words for this batch. */
  readonly packedStyles?: Uint32Array;
}

export interface FastScatterWebgpuStreamSource {
  readonly batches: AsyncIterable<FastScatterWebgpuStreamBatch>;
  /** Allocation hint only; streams may exceed it and grow geometrically. */
  readonly expectedCount?: number;
  readonly initialCapacity?: number;
  /** Prepared full-stream domain. Supplying it keeps the viewport stable. */
  readonly domain?: FastScatterDataDomain;
  /** Optional lazy global ID resolver, avoiding materialized ID strings. */
  readonly idAt?: (sourceIndex: number) => string;
  readonly maxPointSize?: number;
  readonly spec: FastScatterPlotSpec;
}

export interface FastScatterWebgpuLiveStreamProgress {
  readonly capacity: number;
  readonly complete: boolean;
  readonly expectedCount?: number;
  readonly loadedCount: number;
}

export interface FastScatterWebgpuStreamingController {
  readonly done: Promise<void>;
  abort(reason?: unknown): void;
  getColumns(): FastScatterPointColumns;
  getProgress(): FastScatterWebgpuLiveStreamProgress;
}

export interface FastScatterWebgpuStreamingPlotInstance
  extends FastScatterWebgpuPlotInstance {
  readonly streaming: FastScatterWebgpuStreamingController;
}

export interface FastScatterWebgpuStreamingPlotOptions
  extends Omit<
    FastScatterWebgpuPlotOptions,
    'columns' | 'dataDomain' | 'pointCapacity' | 'spec' | 'viewport'
  > {
  readonly dataSource: FastScatterWebgpuStreamSource;
  readonly onStreamProgress?: (progress: FastScatterWebgpuLiveStreamProgress) => void;
  readonly signal?: AbortSignal;
  readonly viewport?: FastScatterViewport;
  readonly viewportPolicy?: 'expand' | 'preserve';
}

export interface LoadFastScatterRecordBatchSourceOptions {
  readonly onProgress?: (progress: FastScatterStreamProgress) => void;
  readonly signal?: AbortSignal;
}

export interface LoadedFastScatterRecordBatchSource {
  readonly columns: FastScatterPointColumns;
  readonly spec: FastScatterPlotSpec;
}

export interface FastScatterJsonRecordBatchSourceOptions {
  readonly batchSize?: number;
  readonly count: number;
  readonly idAt?: (sourceIndex: number) => string;
  readonly numericStorage?: 'float32' | 'float64';
  readonly schema: FastScatterDatasetSchema;
}

export interface FastScatterWebgpuDataSourcePlotOptions
  extends Omit<FastScatterWebgpuPlotOptions, 'columns' | 'spec' | 'viewport'> {
  readonly dataSource: FastScatterRecordBatchSource;
  readonly onStreamProgress?: (progress: FastScatterStreamProgress) => void;
  readonly signal?: AbortSignal;
}

/**
 * Encodes application or streamed-JSON record batches one batch at a time for
 * the live WebGPU append API. The declared count is used only as a capacity
 * hint by the resulting source.
 */
export function createFastScatterWebgpuStreamSourceFromRecordBatches(
  source: FastScatterRecordBatchSource,
): FastScatterWebgpuStreamSource {
  if (!Number.isSafeInteger(source.count) || source.count < 0) {
    throw new Error('A streamed scatter record source requires a non-negative record count.');
  }
  const empty = encodeFastScatterSchemaRows([], source.schema);
  return {
    batches: encodeLiveRecordBatches(source),
    ...(source.count === 0 ? {} : { expectedCount: source.count }),
    spec: empty.spec,
  };
}

export async function createFastScatterWebgpuPlotFromDataSource(
  hostElement: HTMLElement,
  options: FastScatterWebgpuDataSourcePlotOptions,
): Promise<FastScatterWebgpuPlotInstance> {
  const { dataSource, onStreamProgress, signal, ...plotOptions } = options;
  const loaded = await loadFastScatterRecordBatchSource(dataSource, {
    onProgress: onStreamProgress,
    signal,
  });
  const viewport = createDefaultFastScatterViewport(
    calculateFastScatterDomain(loaded.columns, loaded.spec),
  );
  return createFastScatterWebgpuPlot(hostElement, {
    ...plotOptions,
    columns: loaded.columns,
    spec: loaded.spec,
    viewport,
  });
}

/**
 * Creates a WebGPU scatter plot after the first batch and appends later batches
 * directly into persistent GPU buffers. Existing static-column creation remains
 * unchanged.
 */
export async function createFastScatterWebgpuStreamingPlot(
  hostElement: HTMLElement,
  options: FastScatterWebgpuStreamingPlotOptions,
): Promise<FastScatterWebgpuStreamingPlotInstance> {
  const {
    dataSource,
    onStreamProgress,
    signal,
    viewport: requestedViewport,
    viewportPolicy = dataSource.domain === undefined && requestedViewport === undefined
      ? 'expand'
      : 'preserve',
    ...plotOptions
  } = options;
  validateStreamCountHint(dataSource.expectedCount, 'expectedCount');
  validateStreamCountHint(dataSource.initialCapacity, 'initialCapacity');
  throwIfAborted(signal);

  const iterator = dataSource.batches[Symbol.asyncIterator]();
  const first = await readNextNonEmptyBatch(iterator, signal);
  if (first === null) {
    throw new Error('A streamed scatter source ended before supplying a non-empty batch.');
  }
  const firstCount = validateStreamBatch(first, dataSource.spec, 0);
  const storageCapacity = normalizeStreamCapacity(
    dataSource.expectedCount ?? dataSource.initialCapacity,
    firstCount,
  );
  let pointCapacity = normalizeStreamCapacity(
    dataSource.initialCapacity ?? dataSource.expectedCount,
    firstCount,
  );
  const storage = createStreamColumnStorage(
    first.columns,
    storageCapacity,
    dataSource.idAt,
    first.packedStyles,
  );
  appendStreamColumns(storage, first, 0);
  let loadedCount = firstCount;
  let dataDomain = dataSource.domain ?? calculateFastScatterDomain(
    createVisibleStreamColumns(storage, loadedCount),
    dataSource.spec,
  );
  updateStreamAxisDomains(storage, dataDomain, dataSource.spec);
  let progress: FastScatterWebgpuLiveStreamProgress = {
    capacity: pointCapacity,
    complete: false,
    ...(dataSource.expectedCount === undefined
      ? {}
      : { expectedCount: dataSource.expectedCount }),
    loadedCount,
  };
  onStreamProgress?.(progress);

  const plot = createFastScatterWebgpuPlot(hostElement, {
    ...plotOptions,
    columns: createVisibleStreamColumns(storage, loadedCount),
    dataDomain,
    pointCapacity,
    ...(first.packedStyles === undefined
      ? {}
      : {
          packedStyles: {
            data: first.packedStyles,
            maxPointSize: dataSource.maxPointSize ?? getPackedStyleMaxPointSize(
              first.packedStyles,
              0,
              loadedCount,
            ),
            styleStrideBytes: 4 as const,
          },
        }),
    spec: dataSource.spec,
    viewport: requestedViewport ?? createDefaultFastScatterViewport(dataDomain),
  });
  const abortController = new AbortController();
  const abortFromCaller = () => abortController.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  let disposed = false;

  const done = (async () => {
    await plot.interactive;
    while (!abortController.signal.aborted) {
      throwIfAborted(signal);
      const result = await readStreamIteratorNext(iterator, abortController.signal);
      if (result.done) break;
      const batch = result.value;
      const batchCount = validateStreamBatch(batch, dataSource.spec, loadedCount);
      if (batchCount === 0) continue;
      ensureStreamColumnCapacity(storage, loadedCount + batchCount);
      appendStreamColumns(storage, batch, loadedCount);
      const startPoint = loadedCount;
      loadedCount += batchCount;
      pointCapacity = growStreamPointCapacity(
        pointCapacity,
        loadedCount,
        dataSource.expectedCount,
      );
      if (dataSource.domain === undefined) {
        dataDomain = mergeStreamDomains(
          dataDomain,
          calculateFastScatterDomain(batch.columns, dataSource.spec),
        );
      }
      updateStreamAxisDomains(storage, dataDomain, dataSource.spec);
      const columns = createVisibleStreamColumns(storage, loadedCount);
      await appendFastScatterEngineData(plot, {
        capacity: pointCapacity,
        columns,
        dataDomain,
        ...(batch.packedStyles === undefined
          ? {}
          : { packedStyles: batch.packedStyles }),
        ...(dataSource.maxPointSize === undefined
          ? {}
          : { maxPointSize: dataSource.maxPointSize }),
        startPoint,
      });
      if (viewportPolicy === 'expand' && dataSource.domain === undefined) {
        plot.update({ viewport: createDefaultFastScatterViewport(dataDomain) });
      }
      progress = {
        capacity: pointCapacity,
        complete: false,
        ...(dataSource.expectedCount === undefined
          ? {}
          : { expectedCount: dataSource.expectedCount }),
        loadedCount,
      };
      onStreamProgress?.(progress);
      // A source can resolve its next batch entirely through microtasks (for
      // example, decoded local pages). Explicitly yield once per append so
      // pointer, wheel, paint, and React progress work are never starved by a
      // long run of otherwise back-to-back CPU copies and GPU queue writes.
      await yieldToBrowser();
    }
    if (abortController.signal.aborted) {
      throw abortController.signal.reason ??
        new DOMException('Scatter stream loading was aborted.', 'AbortError');
    }
    await finishFastScatterEngineData(plot);
    progress = { ...progress, complete: true };
    onStreamProgress?.(progress);
  })().finally(() => {
    signal?.removeEventListener('abort', abortFromCaller);
    if (!disposed) void iterator.return?.();
  });
  void done.catch(() => undefined);

  const originalDispose = plot.dispose.bind(plot);
  const streaming: FastScatterWebgpuStreamingController = {
    abort(reason = new DOMException('Scatter stream loading was aborted.', 'AbortError')) {
      if (!abortController.signal.aborted) abortController.abort(reason);
      void iterator.return?.();
    },
    done,
    getColumns: () => createVisibleStreamColumns(storage, loadedCount),
    getProgress: () => progress,
  };
  Object.assign(plot, {
    dispose() {
      if (disposed) return;
      disposed = true;
      streaming.abort();
      originalDispose();
    },
    streaming,
  });
  return plot as FastScatterWebgpuStreamingPlotInstance;
}

export const createScatterWebgpuStreamingPlot = createFastScatterWebgpuStreamingPlot;

async function* encodeLiveRecordBatches(
  source: FastScatterRecordBatchSource,
): AsyncGenerator<FastScatterWebgpuStreamBatch> {
  let axisByColumn: FastScatterEncodedSchemaColumns['axisByColumn'] | undefined;
  let loadedCount = 0;
  for await (const records of source.batches) {
    if (records.length === 0) continue;
    if (loadedCount + records.length > source.count) {
      throw new Error(
        `Stream supplied more records than its declared count ${source.count}.`,
      );
    }
    const encoded = encodeFastScatterSchemaRows(records, source.schema);
    const encodedColumns = encoded.columns as FastScatterEncodedSchemaColumns;
    axisByColumn ??= encodedColumns.axisByColumn;
    normalizeLiveBatchAxes(encodedColumns, axisByColumn);
    const y = Object.fromEntries(
      Object.entries(encodedColumns.y).map(([key, values]) => [
        key,
        source.numericStorage === 'float64' || values instanceof Uint8Array ||
            values instanceof Uint16Array
          ? values
          : Float32Array.from(values),
      ]),
    );
    const columns: LiveEncodedColumns = {
      ...encodedColumns,
      axisByColumn,
      ids: source.idAt === undefined
        ? encodedColumns.ids
        : Array.from(
            { length: records.length },
            (_, index) => source.idAt!(loadedCount + index),
          ),
      sourceIndex: Uint32Array.from(
        { length: records.length },
        (_, index) => loadedCount + index,
      ),
      y,
    };
    loadedCount += records.length;
    yield { columns };
    await yieldToBrowser();
  }
  if (loadedCount !== source.count) {
    throw new Error(
      `Stream ended after ${loadedCount} records; expected ${source.count}.`,
    );
  }
}

function normalizeLiveBatchAxes(
  columns: LiveEncodedColumns,
  referenceAxes: FastScatterEncodedSchemaColumns['axisByColumn'],
): void {
  const valuesByKey: Record<string, FastScatterTypedNumericArray | undefined> = {
    ...columns.y,
    ...(columns.xKey === undefined ? {} : { [columns.xKey]: columns.x }),
  };
  for (const [key, values] of Object.entries(valuesByKey)) {
    if (values === undefined) continue;
    const reference = referenceAxes[key];
    const batchAxis = columns.axisByColumn[key];
    if (reference?.kind !== 'datetime-ns' || batchAxis?.kind !== 'datetime-ns') continue;
    const deltaMs = Number(
      batchAxis.datetimeOriginNsBigInt - reference.datetimeOriginNsBigInt,
    ) / 1_000_000;
    if (deltaMs === 0) continue;
    for (let index = 0; index < values.length; index += 1) {
      values[index] = (values[index] ?? Number.NaN) + deltaMs;
    }
  }
}

export async function loadFastScatterRecordBatchSource(
  source: FastScatterRecordBatchSource,
  options: LoadFastScatterRecordBatchSourceOptions = {},
): Promise<LoadedFastScatterRecordBatchSource> {
  if (!Number.isSafeInteger(source.count) || source.count < 0) {
    throw new Error('A streamed scatter source requires a non-negative, known record count.');
  }
  throwIfAborted(options.signal);
  const empty = encodeFastScatterSchemaRows([], source.schema);
  let output: MutableColumns | null = null;
  let loadedCount = 0;

  for await (const records of source.batches) {
    throwIfAborted(options.signal);
    if (records.length === 0) continue;
    if (loadedCount + records.length > source.count) {
      throw new Error(
        `Stream supplied more records than its declared count ${source.count}.`,
      );
    }
    const encoded = encodeFastScatterSchemaRows(records, source.schema);
    output ??= allocateColumns(encoded.columns, source.count, source);
    copyColumns(output, encoded.columns, loadedCount);
    loadedCount += records.length;
    options.onProgress?.({ loadedCount, totalCount: source.count });
    await yieldToBrowser();
  }

  if (loadedCount !== source.count) {
    throw new Error(
      `Stream ended after ${loadedCount} records; expected ${source.count}.`,
    );
  }
  const columns = finalizeAxes(output ?? allocateColumns(empty.columns, 0, source));
  return { columns, spec: empty.spec };
}

export function createFastScatterJsonRecordBatchSource(
  stream: ReadableStream<Uint8Array>,
  options: FastScatterJsonRecordBatchSourceOptions,
): FastScatterRecordBatchSource {
  return {
    batches: streamFastScatterJsonRecordBatches(stream, options.batchSize),
    count: options.count,
    ...(options.idAt === undefined ? {} : { idAt: options.idAt }),
    ...(options.numericStorage === undefined
      ? {}
      : { numericStorage: options.numericStorage }),
    schema: options.schema,
  };
}

export async function* streamFastScatterJsonRecordBatches(
  stream: ReadableStream<Uint8Array>,
  requestedBatchSize = 16_384,
): AsyncGenerator<readonly Readonly<Record<string, unknown>>[]> {
  const batchSize = Math.max(1, Math.floor(requestedBatchSize));
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let recordsStarted = false;
  let scanIndex = 0;
  let recordStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let finishedRecords = false;
  let batch: Readonly<Record<string, unknown>>[] = [];

  try {
    while (!finishedRecords) {
      const result = await reader.read();
      buffer += decoder.decode(result.value, { stream: !result.done });
      if (!recordsStarted) {
        const recordsArrayStart = findTopLevelRecordsArrayStart(buffer);
        if (recordsArrayStart >= 0) {
          recordsStarted = true;
          scanIndex = recordsArrayStart;
        } else if (result.done) {
          throw new Error('Streamed scatter JSON does not contain a records array.');
        } else {
          continue;
        }
      }

      for (; scanIndex < buffer.length; scanIndex += 1) {
        const character = buffer[scanIndex]!;
        if (recordStart < 0) {
          if (character === ']') {
            finishedRecords = true;
            break;
          }
          if (character === '{') {
            recordStart = scanIndex;
            depth = 1;
            inString = false;
            escaped = false;
          } else if (!/[\s,]/u.test(character)) {
            throw new Error(`Unexpected token ${JSON.stringify(character)} in records array.`);
          }
          continue;
        }

        if (inString) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') inString = true;
        else if (character === '{' || character === '[') depth += 1;
        else if (character === '}' || character === ']') depth -= 1;

        if (depth === 0) {
          const value: unknown = JSON.parse(buffer.slice(recordStart, scanIndex + 1));
          if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            throw new Error('Every streamed scatter record must be a JSON object.');
          }
          batch.push(value as Readonly<Record<string, unknown>>);
          recordStart = -1;
          if (batch.length >= batchSize) {
            yield batch;
            batch = [];
          }
        }
      }

      if (recordStart >= 0) {
        buffer = buffer.slice(recordStart);
        scanIndex = buffer.length;
        recordStart = 0;
      } else {
        buffer = buffer.slice(scanIndex);
        scanIndex = 0;
      }
      if (result.done && !finishedRecords) {
        throw new Error('Streamed scatter JSON ended before the records array was closed.');
      }
    }
    if (batch.length > 0) yield batch;
  } finally {
    reader.releaseLock();
  }
}

function findTopLevelRecordsArrayStart(value: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') {
        inString = false;
        if (depth === 1 && stringStart >= 0) {
          let next = index + 1;
          while (/\s/u.test(value[next] ?? '')) next += 1;
          if (value[next] === ':') {
            next += 1;
            while (/\s/u.test(value[next] ?? '')) next += 1;
            if (
              value[next] === '[' &&
              JSON.parse(value.slice(stringStart, index + 1)) === 'records'
            ) {
              return next + 1;
            }
          }
        }
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      stringStart = index;
    } else if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') depth -= 1;
  }
  return -1;
}

type MutableColumns = FastScatterPointColumns & {
  axisByColumn?: Record<string, FastScatterEncodedAxis>;
  ids: readonly string[];
  y: Record<string, FastScatterTypedNumericArray>;
};

type LiveEncodedColumns = FastScatterPointColumns & {
  axisByColumn: FastScatterEncodedSchemaColumns['axisByColumn'];
};

function allocateColumns(
  template: FastScatterPointColumns,
  count: number,
  source: Pick<FastScatterRecordBatchSource, 'idAt' | 'numericStorage'>,
): MutableColumns {
  const y = Object.fromEntries(
    Object.entries(template.y).map(([key, values]) => [
      key,
      source.numericStorage === 'float64' && values instanceof Float64Array
        ? new Float64Array(count)
        : new Float32Array(count),
    ]),
  );
  const rotation = template.rotation === undefined && template.rotationRadians === undefined
    ? undefined
    : new Float32Array(count);
  return {
    ids: source.idAt === undefined
      ? new Array<string>(count)
      : createLazyStringArray(count, source.idAt),
    x: template.x instanceof Float32Array ? new Float32Array(count) : new Float64Array(count),
    y,
    ...('axisByColumn' in template
      ? { axisByColumn: { ...(template as FastScatterEncodedSchemaColumns).axisByColumn } }
      : {}),
    ...(template.xKey === undefined ? {} : { xKey: template.xKey }),
    ...(template.color instanceof Uint8Array
      ? { color: new Uint8Array(count * 4), colorFormat: 'rgba8' as const }
      : template.color instanceof Uint32Array
        ? { color: new Uint32Array(count), colorFormat: 'rgba32' as const }
        : {}),
    ...(template.opacity === undefined ? {} : { opacity: new Float32Array(count) }),
    ...(rotation === undefined ? {} : { rotation, rotationRadians: rotation }),
    ...(template.shape === undefined ? {} : { shape: new Uint8Array(count) }),
    ...(template.size === undefined ? {} : { size: new Float32Array(count) }),
  };
}

function copyColumns(
  output: MutableColumns,
  page: FastScatterPointColumns,
  offset: number,
): void {
  copyAxisValues(output, page, page.xKey ?? output.xKey, output.x, page.x, offset);
  for (const [key, values] of Object.entries(page.y)) {
    const target = output.y[key];
    if (target !== undefined) copyAxisValues(output, page, key, target, values, offset);
  }
  if (Array.isArray(output.ids)) {
    for (let index = 0; index < page.ids.length; index += 1) {
      output.ids[offset + index] = page.ids[index]!;
    }
  }
  if (output.color instanceof Uint8Array && page.color instanceof Uint8Array) {
    output.color.set(page.color, offset * 4);
  } else if (output.color instanceof Uint32Array && page.color instanceof Uint32Array) {
    output.color.set(page.color, offset);
  }
  output.opacity?.set(page.opacity ?? [], offset);
  output.rotation?.set(page.rotation ?? page.rotationRadians ?? [], offset);
  output.shape?.set(page.shape ?? [], offset);
  output.size?.set(page.size ?? [], offset);
}

function createLazyStringArray(
  length: number,
  getValue: (index: number) => string,
): readonly string[] {
  return new Proxy({ length }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property === 'string' && /^(0|[1-9]\d*)$/u.test(property)) {
        const index = Number(property);
        return index < target.length ? getValue(index) : undefined;
      }
      return undefined;
    },
  }) as unknown as readonly string[];
}

function copyAxisValues(
  output: MutableColumns,
  page: FastScatterPointColumns,
  key: string | undefined,
  target: FastScatterTypedNumericArray,
  values: FastScatterTypedNumericArray,
  offset: number,
): void {
  const outputAxis = key === undefined ? undefined : output.axisByColumn?.[key];
  const pageAxis = key === undefined || !('axisByColumn' in page)
    ? undefined
    : (page as FastScatterEncodedSchemaColumns).axisByColumn[key];
  if (outputAxis?.kind !== 'datetime-ns' || pageAxis?.kind !== 'datetime-ns') {
    target.set(values, offset);
    return;
  }
  const originDeltaMs = Number(
    pageAxis.datetimeOriginNsBigInt - outputAxis.datetimeOriginNsBigInt,
  ) / 1_000_000;
  for (let index = 0; index < values.length; index += 1) {
    target[offset + index] = (values[index] ?? Number.NaN) + originDeltaMs;
  }
}

function finalizeAxes(columns: MutableColumns): MutableColumns {
  if (columns.axisByColumn === undefined) return columns;
  const next: Record<string, FastScatterEncodedAxis> = {};
  for (const [key, axis] of Object.entries(columns.axisByColumn)) {
    const values = key === columns.xKey ? columns.x : columns.y[key];
    if (values === undefined) {
      next[key] = axis;
      continue;
    }
    const domain = finiteDomain(values);
    next[key] = axis.kind === 'datetime-ns'
      ? {
          ...axis,
          domain,
          epochNsValues: createLazyEpochNsValues(
            axis.datetimeOriginNsBigInt,
            values,
            axis.encodedScaleMs ?? 1,
          ),
        }
      : { ...axis, domain };
  }
  columns.axisByColumn = next;
  return columns;
}

function finiteDomain(values: FastScatterTypedNumericArray): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 };
}

function createLazyEpochNsValues(
  originNs: bigint,
  values: FastScatterTypedNumericArray,
  encodedScaleMs = 1,
): readonly string[] {
  return new Proxy({ length: values.length }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property === 'string' && /^(0|[1-9]\d*)$/u.test(property)) {
        const index = Number(property);
        if (index >= target.length) return undefined;
        return (
          originNs + BigInt(Math.round((values[index] ?? 0) * encodedScaleMs * 1_000_000))
        ).toString();
      }
      return undefined;
    },
  }) as unknown as readonly string[];
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new DOMException('Scatter stream loading was aborted.', 'AbortError');
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

interface StreamColumnStorage {
  axisByColumn?: FastScatterEncodedSchemaColumns['axisByColumn'];
  capacity: number;
  color?: Uint8Array | Uint32Array;
  colorFormat?: 'rgba8' | 'rgba32';
  ids: string[];
  idAt?: (sourceIndex: number) => string;
  opacity?: Float32Array;
  hasPackedStyles: boolean;
  recordIdentityBySourceIndex?: FastScatterRecordIdentity[];
  rotation?: Float32Array;
  shape?: Uint8Array;
  size?: Float32Array;
  sourceIndex?: Uint32Array;
  tableBySourceIndex?: string[];
  x: FastScatterTypedNumericArray;
  xKey?: string;
  y: Record<string, FastScatterTypedNumericArray>;
}

async function readNextNonEmptyBatch(
  iterator: AsyncIterator<FastScatterWebgpuStreamBatch>,
  signal: AbortSignal | undefined,
): Promise<FastScatterWebgpuStreamBatch | null> {
  while (true) {
    throwIfAborted(signal);
    const result = await iterator.next();
    if (result.done) return null;
    if (result.value.columns.x.length > 0) return result.value;
  }
}

function readStreamIteratorNext(
  iterator: AsyncIterator<FastScatterWebgpuStreamBatch>,
  signal: AbortSignal,
): Promise<IteratorResult<FastScatterWebgpuStreamBatch>> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ??
      new DOMException('Scatter stream loading was aborted.', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      reject(signal.reason ??
        new DOMException('Scatter stream loading was aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    void iterator.next().then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', handleAbort);
    });
  });
}

function validateStreamCountHint(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new Error(`Streamed scatter ${name} must be a positive safe integer.`);
  }
}

function normalizeStreamCapacity(requested: number | undefined, required: number): number {
  if (requested !== undefined && requested >= required) return requested;
  let capacity = 65_536;
  while (capacity < required) capacity *= 2;
  return capacity;
}

function growStreamPointCapacity(
  current: number,
  required: number,
  expectedCount: number | undefined,
): number {
  if (required <= current) return current;
  let capacity = current;
  while (capacity < required) capacity *= 2;
  return expectedCount === undefined || expectedCount < required
    ? capacity
    : Math.min(capacity, expectedCount);
}

function validateStreamBatch(
  batch: FastScatterWebgpuStreamBatch,
  spec: FastScatterPlotSpec,
  startPoint: number,
): number {
  const { columns } = batch;
  const count = columns.x.length;
  if (columns.ids.length !== count) {
    throw new Error(`Streamed scatter batch has ${columns.ids.length} IDs for ${count} points.`);
  }
  if (columns.xOrder !== undefined) {
    throw new Error('Streamed scatter batches must arrive in display order; xOrder is unsupported.');
  }
  for (const plot of spec.plots) {
    if (columns.y[plot.yKey]?.length !== count) {
      throw new Error(
        `Streamed scatter y column "${plot.yKey}" must contain ${count} values.`,
      );
    }
  }
  validateOptionalBatchLength(columns.opacity, count, 'opacity');
  validateOptionalBatchLength(columns.rotation, count, 'rotation');
  validateOptionalBatchLength(columns.shape, count, 'shape');
  validateOptionalBatchLength(columns.size, count, 'size');
  if (batch.packedStyles !== undefined && batch.packedStyles.length !== count) {
    throw new Error(`Streamed scatter packed styles must contain ${count} words.`);
  }
  if (
    columns.color instanceof Uint8Array && columns.color.length !== count * 4 ||
    columns.color instanceof Uint32Array && columns.color.length !== count
  ) {
    throw new Error(`Streamed scatter color column has an invalid length for ${count} points.`);
  }
  if (columns.sourceIndex !== undefined) {
    if (columns.sourceIndex.length !== count) {
      throw new Error(`Streamed scatter sourceIndex must contain ${count} values.`);
    }
    for (let index = 0; index < count; index += 1) {
      if (columns.sourceIndex[index] !== startPoint + index) {
        throw new Error('Streamed scatter sourceIndex values must be contiguous source order.');
      }
    }
  }
  return count;
}

function validateOptionalBatchLength(
  values: ArrayLike<number> | undefined,
  count: number,
  name: string,
): void {
  if (values !== undefined && values.length !== count) {
    throw new Error(`Streamed scatter ${name} column must contain ${count} values.`);
  }
}

function createStreamColumnStorage(
  template: FastScatterPointColumns,
  capacity: number,
  idAt: ((sourceIndex: number) => string) | undefined,
  packedStyles: Uint32Array | undefined,
): StreamColumnStorage {
  const encoded = template as FastScatterEncodedSchemaColumns;
  const rotation = template.rotation === undefined ? undefined : new Float32Array(capacity);
  return {
    capacity,
    hasPackedStyles: packedStyles !== undefined,
    ids: idAt === undefined ? new Array<string>(capacity) : [],
    ...(idAt === undefined ? {} : { idAt }),
    x: allocateNumericLike(template.x, capacity),
    y: Object.fromEntries(
      Object.entries(template.y).map(([key, values]) => [
        key,
        allocateNumericLike(values, capacity),
      ]),
    ),
    ...(encoded.axisByColumn === undefined
      ? {}
      : { axisByColumn: { ...encoded.axisByColumn } }),
    ...(template.xKey === undefined ? {} : { xKey: template.xKey }),
    ...(template.color instanceof Uint8Array
      ? { color: new Uint8Array(capacity * 4), colorFormat: 'rgba8' as const }
      : template.color instanceof Uint32Array
        ? { color: new Uint32Array(capacity), colorFormat: 'rgba32' as const }
        : {}),
    ...(template.opacity === undefined ? {} : { opacity: new Float32Array(capacity) }),
    ...(rotation === undefined ? {} : { rotation }),
    ...(template.shape === undefined ? {} : { shape: new Uint8Array(capacity) }),
    ...(template.size === undefined ? {} : { size: new Float32Array(capacity) }),
    ...(template.sourceIndex === undefined ? {} : { sourceIndex: new Uint32Array(capacity) }),
    ...(template.recordIdentityBySourceIndex === undefined
      ? {}
      : { recordIdentityBySourceIndex: new Array(capacity) }),
    ...(template.tableBySourceIndex === undefined
      ? {}
      : { tableBySourceIndex: new Array<string>(capacity) }),
  };
}

function ensureStreamColumnCapacity(storage: StreamColumnStorage, required: number): void {
  if (required <= storage.capacity) return;
  let capacity = storage.capacity;
  while (capacity < required) capacity *= 2;
  storage.x = growNumericArray(storage.x, capacity);
  storage.y = Object.fromEntries(
    Object.entries(storage.y).map(([key, values]) => [key, growNumericArray(values, capacity)]),
  );
  if (storage.color instanceof Uint8Array) {
    storage.color = growNumericArray(storage.color, capacity * 4) as Uint8Array;
  } else if (storage.color instanceof Uint32Array) {
    storage.color = growNumericArray(storage.color, capacity) as Uint32Array;
  }
  if (storage.opacity !== undefined) storage.opacity = growFloat32(storage.opacity, capacity);
  if (storage.rotation !== undefined) storage.rotation = growFloat32(storage.rotation, capacity);
  if (storage.shape !== undefined) {
    storage.shape = growNumericArray(storage.shape, capacity) as Uint8Array;
  }
  if (storage.size !== undefined) storage.size = growFloat32(storage.size, capacity);
  if (storage.sourceIndex !== undefined) {
    storage.sourceIndex = growNumericArray(storage.sourceIndex, capacity) as Uint32Array;
  }
  if (storage.idAt === undefined) storage.ids.length = capacity;
  if (storage.recordIdentityBySourceIndex !== undefined) {
    storage.recordIdentityBySourceIndex.length = capacity;
  }
  if (storage.tableBySourceIndex !== undefined) storage.tableBySourceIndex.length = capacity;
  storage.capacity = capacity;
}

function appendStreamColumns(
  storage: StreamColumnStorage,
  streamBatch: FastScatterWebgpuStreamBatch,
  offset: number,
): void {
  const { columns: batch, packedStyles } = streamBatch;
  if (storage.hasPackedStyles !== (packedStyles !== undefined)) {
    throw new Error('Streamed scatter packed-style storage changed between batches.');
  }
  if (batch.x.constructor !== storage.x.constructor) {
    throw new Error('Streamed scatter x column changed numeric storage type.');
  }
  storage.x.set(batch.x, offset);
  for (const [key, target] of Object.entries(storage.y)) {
    const source = batch.y[key];
    if (source === undefined || source.constructor !== target.constructor) {
      throw new Error(`Streamed scatter y column "${key}" changed numeric storage type.`);
    }
    target.set(source, offset);
  }
  if (storage.idAt === undefined) {
    for (let index = 0; index < batch.ids.length; index += 1) {
      storage.ids[offset + index] = batch.ids[index]!;
    }
  }
  if (storage.color instanceof Uint8Array && batch.color instanceof Uint8Array) {
    storage.color.set(batch.color, offset * 4);
  } else if (storage.color instanceof Uint32Array && batch.color instanceof Uint32Array) {
    storage.color.set(batch.color, offset);
  } else if (storage.color !== undefined || batch.color !== undefined) {
    throw new Error('Streamed scatter color storage changed between batches.');
  }
  copyOptionalStreamColumn(storage.opacity, batch.opacity, offset, 'opacity');
  copyOptionalStreamColumn(storage.rotation, batch.rotation, offset, 'rotation');
  copyOptionalStreamColumn(storage.shape, batch.shape, offset, 'shape');
  copyOptionalStreamColumn(storage.size, batch.size, offset, 'size');
  copyOptionalStreamColumn(storage.sourceIndex, batch.sourceIndex, offset, 'sourceIndex');
  copyOptionalStringValues(storage.tableBySourceIndex, batch.tableBySourceIndex, offset, 'table');
  copyOptionalRecordIdentities(
    storage.recordIdentityBySourceIndex,
    batch.recordIdentityBySourceIndex,
    offset,
  );
}

function createVisibleStreamColumns(
  storage: StreamColumnStorage,
  count: number,
): FastScatterPointColumns {
  const rotation = storage.rotation?.subarray(0, count);
  const x = storage.x.subarray(0, count) as FastScatterTypedNumericArray;
  const y = Object.fromEntries(
    Object.entries(storage.y).map(([key, values]) => [
      key,
      values.subarray(0, count) as FastScatterTypedNumericArray,
    ]),
  );
  const axisByColumn = storage.axisByColumn === undefined
    ? undefined
    : Object.fromEntries(Object.entries(storage.axisByColumn).map(([key, axis]) => {
        const values = key === storage.xKey ? x : y[key];
        if (values === undefined) return [key, axis];
        return [key, axis.kind === 'datetime-ns'
          ? {
              ...axis,
              epochNsValues: createLazyEpochNsValues(
                axis.datetimeOriginNsBigInt,
                values,
                axis.encodedScaleMs ?? 1,
              ),
            }
          : axis];
      }));
  return {
    ids: storage.idAt === undefined
      ? createArrayPrefixView(storage.ids, count)
      : createLazyStringArray(count, storage.idAt),
    x,
    y,
    ...(axisByColumn === undefined ? {} : { axisByColumn }),
    ...(storage.xKey === undefined ? {} : { xKey: storage.xKey }),
    ...(storage.color instanceof Uint8Array
      ? { color: storage.color.subarray(0, count * 4), colorFormat: 'rgba8' as const }
      : storage.color instanceof Uint32Array
        ? { color: storage.color.subarray(0, count), colorFormat: 'rgba32' as const }
        : {}),
    ...(storage.opacity === undefined ? {} : { opacity: storage.opacity.subarray(0, count) }),
    ...(rotation === undefined ? {} : { rotation, rotationRadians: rotation }),
    ...(storage.shape === undefined ? {} : { shape: storage.shape.subarray(0, count) }),
    ...(storage.size === undefined ? {} : { size: storage.size.subarray(0, count) }),
    ...(storage.sourceIndex === undefined
      ? {}
      : { sourceIndex: storage.sourceIndex.subarray(0, count) }),
    ...(storage.recordIdentityBySourceIndex === undefined
      ? {}
      : {
          recordIdentityBySourceIndex: createArrayPrefixView(
            storage.recordIdentityBySourceIndex,
            count,
          ),
        }),
    ...(storage.tableBySourceIndex === undefined
      ? {}
      : { tableBySourceIndex: createArrayPrefixView(storage.tableBySourceIndex, count) }),
  } as FastScatterPointColumns;
}

function updateStreamAxisDomains(
  storage: StreamColumnStorage,
  domain: FastScatterDataDomain,
  spec: FastScatterPlotSpec,
): void {
  if (storage.axisByColumn === undefined) return;
  const axisByColumn = { ...storage.axisByColumn };
  if (storage.xKey !== undefined && axisByColumn[storage.xKey] !== undefined) {
    axisByColumn[storage.xKey] = {
      ...axisByColumn[storage.xKey],
      domain: domain.x,
    } as FastScatterEncodedAxis;
  }
  for (const plot of spec.plots) {
    const axis = axisByColumn[plot.yKey];
    const range = domain.yByPlot[plot.id];
    if (axis !== undefined && range !== undefined) {
      axisByColumn[plot.yKey] = { ...axis, domain: range } as FastScatterEncodedAxis;
    }
  }
  storage.axisByColumn = axisByColumn;
}

function allocateNumericLike(
  values: FastScatterTypedNumericArray,
  length: number,
): FastScatterTypedNumericArray {
  if (values instanceof Float64Array) return new Float64Array(length);
  if (values instanceof Float32Array) return new Float32Array(length);
  if (values instanceof Uint32Array) return new Uint32Array(length);
  if (values instanceof Uint16Array) return new Uint16Array(length);
  return new Uint8Array(length);
}

function growNumericArray(
  values: FastScatterTypedNumericArray,
  length: number,
): FastScatterTypedNumericArray {
  const next = allocateNumericLike(values, length);
  next.set(values);
  return next;
}

function growFloat32(values: Float32Array, length: number): Float32Array {
  const next = new Float32Array(length);
  next.set(values);
  return next;
}

function getPackedStyleMaxPointSize(
  values: Uint32Array,
  startPoint: number,
  endPoint: number,
): number {
  let maxPointSize = 0;
  for (let index = startPoint; index < endPoint; index += 1) {
    maxPointSize = Math.max(maxPointSize, (((values[index] ?? 0) >>> 29) & 0x7) + 1);
  }
  return maxPointSize;
}

function copyOptionalStreamColumn<T extends FastScatterTypedNumericArray>(
  target: T | undefined,
  source: T | undefined,
  offset: number,
  name: string,
): void {
  if (target === undefined && source === undefined) return;
  if (target === undefined || source === undefined || target.constructor !== source.constructor) {
    throw new Error(`Streamed scatter ${name} storage changed between batches.`);
  }
  target.set(source, offset);
}

function copyOptionalStringValues(
  target: string[] | undefined,
  source: readonly string[] | undefined,
  offset: number,
  name: string,
): void {
  if (target === undefined && source === undefined) return;
  if (target === undefined || source === undefined) {
    throw new Error(`Streamed scatter ${name} metadata changed between batches.`);
  }
  for (let index = 0; index < source.length; index += 1) {
    target[offset + index] = source[index]!;
  }
}

function copyOptionalRecordIdentities(
  target: StreamColumnStorage['recordIdentityBySourceIndex'],
  source: FastScatterPointColumns['recordIdentityBySourceIndex'],
  offset: number,
): void {
  if (target === undefined && source === undefined) return;
  if (target === undefined || source === undefined) {
    throw new Error('Streamed scatter record identity metadata changed between batches.');
  }
  for (let index = 0; index < source.length; index += 1) {
    target[offset + index] = source[index]!;
  }
}

function createArrayPrefixView<T>(values: readonly T[], length: number): readonly T[] {
  return new Proxy({ length }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property === 'string' && /^(0|[1-9]\d*)$/u.test(property)) {
        const index = Number(property);
        return index < target.length ? values[index] : undefined;
      }
      return undefined;
    },
  }) as unknown as readonly T[];
}

function mergeStreamDomains(
  current: FastScatterDataDomain,
  next: FastScatterDataDomain,
): FastScatterDataDomain {
  return {
    x: mergeStreamRange(current.x, next.x),
    yByPlot: Object.fromEntries(
      Object.entries(current.yByPlot).map(([plotId, range]) => [
        plotId,
        mergeStreamRange(range, next.yByPlot[plotId] ?? range),
      ]),
    ),
  };
}

function mergeStreamRange(
  current: { min: number; max: number },
  next: { min: number; max: number },
): { min: number; max: number } {
  return { min: Math.min(current.min, next.min), max: Math.max(current.max, next.max) };
}
