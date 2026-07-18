import {
  calculateFastScatterDomain,
  createDefaultFastScatterViewport,
  encodeFastScatterSchemaRows,
  type FastScatterDatasetSchema,
  type FastScatterEncodedAxis,
  type FastScatterEncodedSchemaColumns,
  type FastScatterPlotSpec,
  type FastScatterPointColumns,
  type FastScatterTypedNumericArray,
} from '../../m-scatter/core/index.js';
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
          epochNsValues: createLazyEpochNsValues(axis.datetimeOriginNsBigInt, values),
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
): readonly string[] {
  return new Proxy({ length: values.length }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property === 'string' && /^(0|[1-9]\d*)$/u.test(property)) {
        const index = Number(property);
        if (index >= target.length) return undefined;
        return (originNs + BigInt(Math.round((values[index] ?? 0) * 1_000_000))).toString();
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
