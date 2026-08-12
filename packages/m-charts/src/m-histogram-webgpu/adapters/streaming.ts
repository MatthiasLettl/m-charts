import {
  createDefaultHistogramViewport,
  type HistogramColorArray,
  type HistogramColumns,
  type HistogramNumericArray,
  type HistogramPlotSpec,
  type HistogramValueColumn,
  type HistogramViewport,
} from '../../m-histogram/core/index.js';
import { createHistogramWebgpuPlot } from '../engine/createHistogramWebgpuPlot.js';
import type {
  HistogramWebgpuPlotInstance,
  HistogramWebgpuPlotOptions,
  HistogramWebgpuPlotUpdateOptions,
} from '../engine/types.js';

export interface HistogramWebgpuStreamBatch {
  readonly columns: HistogramColumns;
}

export interface HistogramWebgpuStreamSource {
  readonly batches: AsyncIterable<HistogramWebgpuStreamBatch>;
  /** Capacity/progress hint. When supplied, the final count is validated. */
  readonly expectedCount?: number;
  /** Initial logical capacity hint retained across progressive prefixes. */
  readonly initialCapacity?: number;
  /** Stable parameter metadata and domains for the complete stream. */
  readonly spec: HistogramPlotSpec;
}

export interface HistogramWebgpuStreamProgress {
  readonly capacity: number;
  readonly complete: boolean;
  readonly expectedCount?: number;
  readonly loadedCount: number;
}

export interface HistogramWebgpuStreamingController {
  readonly done: Promise<void>;
  abort(reason?: unknown): void;
  getColumns(): HistogramColumns;
  getProgress(): HistogramWebgpuStreamProgress;
}

export interface HistogramWebgpuStreamingPlotInstance
  extends Omit<HistogramWebgpuPlotInstance, 'update'> {
  readonly streaming: HistogramWebgpuStreamingController;
  update(
    options: Omit<HistogramWebgpuPlotUpdateOptions, 'aggregation' | 'columns' | 'spec'>,
  ): void;
}

export interface HistogramWebgpuStreamingPlotOptions
  extends Omit<HistogramWebgpuPlotOptions, 'aggregation' | 'columns' | 'spec'> {
  readonly dataSource: HistogramWebgpuStreamSource;
  readonly onStreamProgress?: (progress: HistogramWebgpuStreamProgress) => void;
  readonly signal?: AbortSignal;
  readonly viewport?: HistogramViewport;
  /** `expand` follows growing aggregate bounds until the user changes the viewport. */
  readonly viewportPolicy?: 'expand' | 'preserve';
}

const RENDER_PREFIX_GROWTH_FACTOR = 2;

/** Creates a live WebGPU histogram after the first non-empty typed batch. */
export async function createHistogramWebgpuStreamingPlot(
  hostElement: HTMLElement,
  options: HistogramWebgpuStreamingPlotOptions,
): Promise<HistogramWebgpuStreamingPlotInstance> {
  const {
    dataSource,
    onStreamProgress,
    signal,
    viewport: requestedViewport,
    viewportPolicy = requestedViewport === undefined ? 'expand' : 'preserve',
    ...plotOptions
  } = options;
  validateCountHint(dataSource.expectedCount, 'expectedCount');
  validateCountHint(dataSource.initialCapacity, 'initialCapacity');
  if (dataSource.spec.mode !== 'histogram') {
    throw new Error('A streamed WebGPU histogram source requires histogram mode.');
  }
  throwIfAborted(signal);

  const abortController = new AbortController();
  const abortFromCaller = () => abortController.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const iterator = dataSource.batches[Symbol.asyncIterator]();
  let first: HistogramWebgpuStreamBatch | null;
  try {
    first = await readNextNonEmptyBatch(iterator, abortController.signal);
  } catch (error) {
    signal?.removeEventListener('abort', abortFromCaller);
    void closeIterator(iterator);
    throw error;
  }
  if (first === null) {
    signal?.removeEventListener('abort', abortFromCaller);
    closeIterator(iterator);
    throw new Error('A streamed histogram source ended before supplying a non-empty batch.');
  }
  let firstCount: number;
  let columns: HistogramColumns;
  let storage: HistogramStreamColumnStorage;
  try {
    firstCount = validateBatch(first.columns, dataSource.spec, null);
    const initialStorageCapacity = normalizeCapacity(
      dataSource.initialCapacity ?? dataSource.expectedCount,
      firstCount,
    );
    storage = createHistogramStreamColumnStorage(
      first.columns,
      initialStorageCapacity,
    );
    appendHistogramStreamColumns(storage, first.columns, 0);
    columns = createVisibleHistogramStreamColumns(storage, firstCount);
  } catch (error) {
    signal?.removeEventListener('abort', abortFromCaller);
    closeIterator(iterator);
    throw error;
  }
  let loadedCount = firstCount;
  let renderedCount = loadedCount;
  let nextRenderCount = getNextRenderCount(renderedCount, dataSource.expectedCount);
  let capacity = normalizeCapacity(
    dataSource.initialCapacity ?? dataSource.expectedCount,
    loadedCount,
  );
  let progress = createProgress(loadedCount, capacity, false, dataSource.expectedCount);

  let plot: HistogramWebgpuPlotInstance;
  try {
    onStreamProgress?.(progress);
    plot = createHistogramWebgpuPlot(hostElement, {
      ...plotOptions,
      columns,
      spec: dataSource.spec,
      ...(requestedViewport === undefined ? {} : { viewport: requestedViewport }),
    });
  } catch (error) {
    signal?.removeEventListener('abort', abortFromCaller);
    abortController.abort(error);
    void closeIterator(iterator);
    throw error;
  }

  let currentViewport = requestedViewport;
  let followGrowingViewport = viewportPolicy === 'expand';
  let selectedSourceIndices = plotOptions.selectedSourceIndices;
  const originalUpdate = plot.update.bind(plot);
  const stopViewportTracking = plot.on('viewportchange', (event) => {
    currentViewport = event.viewport;
    if (event.reason !== 'initial') followGrowingViewport = false;
  });
  const stopSelectionTracking = plot.on('selectionchange', (event) => {
    selectedSourceIndices = event.sourceIndices;
  });
  let disposed = false;

  const renderPendingPrefix = (): void => {
    if (renderedCount === loadedCount) return;
    const nextColumns = createVisibleHistogramStreamColumns(storage, loadedCount);
    originalUpdate({
      columns: nextColumns,
      ...(followGrowingViewport || currentViewport === undefined
        ? {}
        : { viewport: currentViewport }),
      ...(selectedSourceIndices === undefined
        ? {}
        : { selectedSourceIndices }),
    });
    if (followGrowingViewport) {
      currentViewport = createDefaultHistogramViewport(
        plot.commands.getStateSnapshot().aggregation,
      );
      originalUpdate({ viewport: currentViewport });
    }
    plot.commands.render();
    columns = nextColumns;
    renderedCount = loadedCount;
    nextRenderCount = getNextRenderCount(renderedCount, dataSource.expectedCount);
  };

  const done = (async () => {
    try {
      await plot.interactive;
      while (!abortController.signal.aborted) {
        const result = await nextWithAbort(iterator, abortController.signal);
        if (result.done) break;
        const count = validateBatch(result.value.columns, dataSource.spec, columns);
        if (count === 0) continue;
        const nextLoadedCount = loadedCount + count;
        ensureHistogramStreamColumnCapacity(storage, nextLoadedCount);
        appendHistogramStreamColumns(storage, result.value.columns, loadedCount);
        loadedCount = nextLoadedCount;
        capacity = growCapacity(capacity, loadedCount);
        if (
          loadedCount >= nextRenderCount ||
          loadedCount === dataSource.expectedCount
        ) {
          renderPendingPrefix();
        }
        progress = createProgress(
          loadedCount,
          capacity,
          false,
          dataSource.expectedCount,
        );
        onStreamProgress?.(progress);
        await yieldToMainThread();
      }
      throwIfAborted(abortController.signal);
      renderPendingPrefix();
      if (
        dataSource.expectedCount !== undefined &&
        loadedCount !== dataSource.expectedCount
      ) {
        throw new Error(
          `Streamed histogram source supplied ${loadedCount} records; expected ${dataSource.expectedCount}.`,
        );
      }
      progress = createProgress(loadedCount, capacity, true, dataSource.expectedCount);
      onStreamProgress?.(progress);
    } finally {
      if (!disposed && renderedCount !== loadedCount) {
        try {
          renderPendingPrefix();
        } catch {
          // Preserve the original transport, validation, or abort error.
        }
      }
      signal?.removeEventListener('abort', abortFromCaller);
      closeIterator(iterator);
    }
  })();
  void done.catch(() => undefined);

  const streaming: HistogramWebgpuStreamingController = {
    abort(reason = new DOMException('Histogram stream loading was aborted.', 'AbortError')) {
      if (!abortController.signal.aborted) abortController.abort(reason);
    },
    done,
    getColumns: () => createVisibleHistogramStreamColumns(storage, loadedCount),
    getProgress: () => progress,
  };
  const originalDispose = plot.dispose.bind(plot);
  Object.assign(plot, {
    dispose() {
      if (disposed) return;
      disposed = true;
      stopViewportTracking();
      stopSelectionTracking();
      streaming.abort();
      originalDispose();
    },
    streaming,
    update(updateOptions: Parameters<typeof originalUpdate>[0]) {
      if (
        updateOptions.aggregation !== undefined ||
        updateOptions.columns !== undefined ||
        updateOptions.spec !== undefined
      ) {
        throw new Error(
          'A streamed histogram plot owns aggregation, columns, and spec through dataSource.',
        );
      }
      if (updateOptions.viewport !== undefined) {
        currentViewport = updateOptions.viewport;
        followGrowingViewport = false;
      }
      if (updateOptions.selectedSourceIndices !== undefined) {
        selectedSourceIndices = updateOptions.selectedSourceIndices;
      }
      originalUpdate(updateOptions);
    },
  });
  return plot as HistogramWebgpuStreamingPlotInstance;
}

function validateBatch(
  columns: HistogramColumns,
  spec: HistogramPlotSpec,
  previous: HistogramColumns | null,
): number {
  const count = columns.ids.length;
  for (const parameter of spec.parameters) {
    if (columns.valuesByParameter[parameter.key]?.length !== count) {
      throw new Error(
        `Streamed histogram parameter "${parameter.key}" does not match the batch count.`,
      );
    }
  }
  if (columns.sourceIndex !== undefined && columns.sourceIndex.length !== count) {
    throw new Error('Streamed histogram source indices do not match the batch count.');
  }
  if (
    columns.recordIdentityBySourceIndex !== undefined &&
    columns.recordIdentityBySourceIndex.length !== count
  ) {
    throw new Error('Streamed histogram record identities do not match the batch count.');
  }
  if (
    columns.tableBySourceIndex !== undefined &&
    columns.tableBySourceIndex.length !== count
  ) {
    throw new Error('Streamed histogram table metadata does not match the batch count.');
  }
  const colorStride = columns.colorFormat === 'rgba8' ||
      (columns.colorFormat === undefined && columns.color?.length === count * 4)
    ? 4
    : 1;
  if (columns.color !== undefined && columns.color.length !== count * colorStride) {
    throw new Error('Streamed histogram color does not match the batch count.');
  }
  if (
    columns.color !== undefined &&
    ((columns.colorFormat === 'rgba8' && !(columns.color instanceof Uint8Array)) ||
      (columns.colorFormat === 'rgba32' && !(columns.color instanceof Uint32Array)))
  ) {
    throw new Error('Streamed histogram color storage does not match its color format.');
  }
  if (
    previous?.colorFormat !== undefined &&
    columns.colorFormat !== undefined &&
    previous.colorFormat !== columns.colorFormat
  ) {
    throw new Error('Every streamed histogram batch must use the same color format.');
  }
  if (
    previous !== null &&
    (previous.color === undefined) !== (columns.color === undefined)
  ) {
    throw new Error('Every streamed histogram batch must consistently supply color.');
  }
  if (
    previous !== null &&
    (previous.sourceIndex === undefined) !== (columns.sourceIndex === undefined)
  ) {
    throw new Error('Every streamed histogram batch must consistently supply source indices.');
  }
  if (
    previous !== null &&
    (previous.recordIdentityBySourceIndex === undefined) !==
      (columns.recordIdentityBySourceIndex === undefined)
  ) {
    throw new Error('Every streamed histogram batch must consistently supply record identities.');
  }
  if (
    previous !== null &&
    (previous.tableBySourceIndex === undefined) !==
      (columns.tableBySourceIndex === undefined)
  ) {
    throw new Error('Every streamed histogram batch must consistently supply table metadata.');
  }
  return count;
}

type HistogramStreamValue = bigint | boolean | number | string | null | undefined;
type MutableHistogramValueColumn = HistogramNumericArray | HistogramStreamValue[];

interface HistogramStreamColumnStorage {
  capacity: number;
  color?: HistogramColorArray;
  colorFormat?: HistogramColumns['colorFormat'];
  colorStride: 1 | 4;
  displayFields?: HistogramColumns['displayFields'];
  ids: string[];
  parameters?: HistogramColumns['parameters'];
  recordIdentityBySourceIndex?: Array<
    NonNullable<HistogramColumns['recordIdentityBySourceIndex']>[number]
  >;
  sourceIndex?: Uint32Array;
  tableBySourceIndex?: string[];
  valuesByParameter: Record<string, MutableHistogramValueColumn>;
}

function createHistogramStreamColumnStorage(
  template: HistogramColumns,
  capacity: number,
): HistogramStreamColumnStorage {
  return {
    capacity,
    colorStride:
      template.colorFormat === 'rgba8' ||
        (template.colorFormat === undefined && template.color?.length === template.ids.length * 4)
        ? 4
        : 1,
    ids: new Array<string>(capacity),
    valuesByParameter: Object.fromEntries(
      Object.entries(template.valuesByParameter).map(([key, values]) => [
        key,
        allocateHistogramValueColumn(values, capacity),
      ]),
    ),
    ...(template.color === undefined
      ? {}
      : { color: allocateHistogramColor(template.color, capacity) }),
    ...(template.colorFormat === undefined ? {} : { colorFormat: template.colorFormat }),
    ...(template.displayFields === undefined ? {} : { displayFields: template.displayFields }),
    ...(template.parameters === undefined ? {} : { parameters: template.parameters }),
    ...(template.recordIdentityBySourceIndex === undefined
      ? {}
      : { recordIdentityBySourceIndex: new Array(capacity) }),
    ...(template.sourceIndex === undefined ? {} : { sourceIndex: new Uint32Array(capacity) }),
    ...(template.tableBySourceIndex === undefined
      ? {}
      : { tableBySourceIndex: new Array<string>(capacity) }),
  };
}

function ensureHistogramStreamColumnCapacity(
  storage: HistogramStreamColumnStorage,
  required: number,
): void {
  if (required <= storage.capacity) return;
  let capacity = storage.capacity;
  while (capacity < required) capacity = Math.max(required, Math.ceil(capacity * 1.5));
  storage.valuesByParameter = Object.fromEntries(
    Object.entries(storage.valuesByParameter).map(([key, values]) => [
      key,
      growHistogramValueColumn(values, capacity),
    ]),
  );
  if (storage.color !== undefined) {
    storage.color = growHistogramColor(storage.color, capacity);
  }
  if (storage.sourceIndex !== undefined) {
    const next = new Uint32Array(capacity);
    next.set(storage.sourceIndex);
    storage.sourceIndex = next;
  }
  storage.ids.length = capacity;
  if (storage.recordIdentityBySourceIndex !== undefined) {
    storage.recordIdentityBySourceIndex.length = capacity;
  }
  if (storage.tableBySourceIndex !== undefined) {
    storage.tableBySourceIndex.length = capacity;
  }
  storage.capacity = capacity;
}

function appendHistogramStreamColumns(
  storage: HistogramStreamColumnStorage,
  batch: HistogramColumns,
  offset: number,
): void {
  const count = batch.ids.length;
  for (let index = 0; index < count; index += 1) {
    storage.ids[offset + index] = batch.ids[index]!;
  }
  for (const [key, target] of Object.entries(storage.valuesByParameter)) {
    copyHistogramValueColumn(target, batch.valuesByParameter[key]!, offset, key);
  }
  if (storage.color !== undefined && batch.color !== undefined) {
    if (storage.color.constructor !== batch.color.constructor) {
      throw new Error('Streamed histogram color storage changed between batches.');
    }
    storage.color.set(batch.color, offset * storage.colorStride);
  } else if (storage.color !== undefined || batch.color !== undefined) {
    throw new Error('Streamed histogram color storage changed between batches.');
  }
  if (storage.sourceIndex !== undefined && batch.sourceIndex !== undefined) {
    for (let index = 0; index < count; index += 1) {
      if (batch.sourceIndex[index] !== offset + index) {
        throw new Error(
          'Streamed histogram source indices must be contiguous global row indices.',
        );
      }
    }
    storage.sourceIndex.set(batch.sourceIndex, offset);
  } else if (storage.sourceIndex !== undefined || batch.sourceIndex !== undefined) {
    throw new Error('Streamed histogram source-index storage changed between batches.');
  }
  if (
    storage.recordIdentityBySourceIndex !== undefined &&
    batch.recordIdentityBySourceIndex !== undefined
  ) {
    for (let index = 0; index < count; index += 1) {
      storage.recordIdentityBySourceIndex[offset + index] = {
        ...batch.recordIdentityBySourceIndex[index]!,
        sourceIndex: offset + index,
      };
    }
  } else if (
    storage.recordIdentityBySourceIndex !== undefined ||
    batch.recordIdentityBySourceIndex !== undefined
  ) {
    throw new Error('Streamed histogram record-identity storage changed between batches.');
  }
  if (storage.tableBySourceIndex !== undefined && batch.tableBySourceIndex !== undefined) {
    for (let index = 0; index < count; index += 1) {
      storage.tableBySourceIndex[offset + index] = batch.tableBySourceIndex[index]!;
    }
  } else if (storage.tableBySourceIndex !== undefined || batch.tableBySourceIndex !== undefined) {
    throw new Error('Streamed histogram table storage changed between batches.');
  }
}

function createVisibleHistogramStreamColumns(
  storage: HistogramStreamColumnStorage,
  count: number,
): HistogramColumns {
  const valuesByParameter = Object.fromEntries(
    Object.entries(storage.valuesByParameter).map(([key, values]) => [
      key,
      createVisibleHistogramValueColumn(values, count),
    ]),
  );
  return {
    ids: createReadonlyArrayView(storage.ids, count),
    valuesByParameter,
    ...(storage.color === undefined
      ? {}
      : {
          color: storage.color.subarray(
            0,
            count * storage.colorStride,
          ) as HistogramColorArray,
        }),
    ...(storage.colorFormat === undefined ? {} : { colorFormat: storage.colorFormat }),
    ...(storage.displayFields === undefined ? {} : { displayFields: storage.displayFields }),
    ...(storage.parameters === undefined ? {} : { parameters: storage.parameters }),
    ...(storage.recordIdentityBySourceIndex === undefined
      ? {}
      : {
          recordIdentityBySourceIndex: createReadonlyArrayView(
            storage.recordIdentityBySourceIndex,
            count,
          ),
        }),
    ...(storage.sourceIndex === undefined
      ? {}
      : { sourceIndex: storage.sourceIndex.subarray(0, count) }),
    ...(storage.tableBySourceIndex === undefined
      ? {}
      : { tableBySourceIndex: createReadonlyArrayView(storage.tableBySourceIndex, count) }),
  };
}

function allocateHistogramValueColumn(
  template: HistogramValueColumn,
  length: number,
): MutableHistogramValueColumn {
  if (!ArrayBuffer.isView(template)) return new Array<HistogramStreamValue>(length);
  const Constructor = template.constructor as {
    new (length: number): HistogramNumericArray;
  };
  return new Constructor(length);
}

function growHistogramValueColumn(
  values: MutableHistogramValueColumn,
  length: number,
): MutableHistogramValueColumn {
  if (!ArrayBuffer.isView(values)) {
    values.length = length;
    return values;
  }
  const Constructor = values.constructor as {
    new (length: number): HistogramNumericArray & { set(values: ArrayLike<number>): void };
  };
  const next = new Constructor(length);
  next.set(values as ArrayLike<number>);
  return next;
}

function copyHistogramValueColumn(
  target: MutableHistogramValueColumn,
  source: HistogramValueColumn,
  offset: number,
  key: string,
): void {
  if (ArrayBuffer.isView(target) && ArrayBuffer.isView(source)) {
    if (target.constructor !== source.constructor) {
      throw new Error(`Streamed histogram parameter "${key}" changed storage type.`);
    }
    (target as unknown as { set(values: ArrayLike<number>, offset: number): void }).set(
      source as ArrayLike<number>,
      offset,
    );
    return;
  }
  if (Array.isArray(target) && Array.isArray(source)) {
    for (let index = 0; index < source.length; index += 1) {
      target[offset + index] = source[index];
    }
    return;
  }
  throw new Error(`Streamed histogram parameter "${key}" changed storage type.`);
}

function createVisibleHistogramValueColumn(
  values: MutableHistogramValueColumn,
  count: number,
): HistogramValueColumn {
  if (ArrayBuffer.isView(values)) {
    return (values as unknown as { subarray(start: number, end: number): HistogramValueColumn })
      .subarray(0, count);
  }
  return createReadonlyArrayView(values, count) as HistogramValueColumn;
}

function allocateHistogramColor(
  template: HistogramColorArray,
  recordCapacity: number,
): HistogramColorArray {
  return template instanceof Uint8Array
    ? new Uint8Array(recordCapacity * 4)
    : new Uint32Array(recordCapacity);
}

function growHistogramColor(
  values: HistogramColorArray,
  recordCapacity: number,
): HistogramColorArray {
  const next = values instanceof Uint8Array
    ? new Uint8Array(recordCapacity * 4)
    : new Uint32Array(recordCapacity);
  next.set(values);
  return next;
}

function createReadonlyArrayView<T>(values: readonly T[], length: number): readonly T[] {
  return new Proxy({ length }, {
    get(target, property, receiver) {
      if (property === 'length') return target.length;
      if (property === 'toJSON') return () => Array.from(receiver as ArrayLike<T>);
      if (typeof property === 'string' && /^(0|[1-9]\d*)$/u.test(property)) {
        const index = Number(property);
        return index < target.length ? values[index] : undefined;
      }
      return Reflect.get(Array.prototype, property, receiver);
    },
    has(target, property) {
      if (typeof property === 'string' && /^(0|[1-9]\d*)$/u.test(property)) {
        return Number(property) < target.length;
      }
      return property === 'length' || property in Array.prototype;
    },
  }) as unknown as readonly T[];
}

function getNextRenderCount(
  renderedCount: number,
  expectedCount: number | undefined,
): number {
  const next = Math.max(renderedCount + 1, renderedCount * RENDER_PREFIX_GROWTH_FACTOR);
  return expectedCount === undefined ? next : Math.min(expectedCount, next);
}

async function readNextNonEmptyBatch(
  iterator: AsyncIterator<HistogramWebgpuStreamBatch>,
  signal: AbortSignal,
): Promise<HistogramWebgpuStreamBatch | null> {
  while (true) {
    const result = await nextWithAbort(iterator, signal);
    if (result.done) return null;
    if (result.value.columns.ids.length > 0) return result.value;
  }
}

async function nextWithAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal) {
  throwIfAborted(signal);
  return await new Promise<IteratorResult<T>>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void iterator.next().then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function closeIterator(iterator: AsyncIterator<unknown>): void {
  try {
    void iterator.return?.().catch(() => undefined);
  } catch {
    // Stream completion/abort remains the primary result.
  }
}

function validateCountHint(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`Histogram stream ${label} must be a non-negative safe integer.`);
  }
}

function normalizeCapacity(hint: number | undefined, count: number): number {
  return Math.max(count, hint ?? Math.max(1024, count));
}

function growCapacity(capacity: number, count: number): number {
  let next = capacity;
  while (next < count) next = Math.max(count, Math.ceil(next * 1.5));
  return next;
}

function createProgress(
  loadedCount: number,
  capacity: number,
  complete: boolean,
  expectedCount: number | undefined,
): HistogramWebgpuStreamProgress {
  return {
    capacity,
    complete,
    ...(expectedCount === undefined ? {} : { expectedCount }),
    loadedCount,
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Histogram stream loading was aborted.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
