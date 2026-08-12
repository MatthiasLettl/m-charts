import {
  createParallelWebgpuBuffers,
  type ParallelAxisDomains,
  type ParallelAxisViewports,
  type ParallelBrushIntervals,
  type ParallelBuffers,
  type ParallelFastColumns,
  type ParallelWebgpuPackedPage,
} from '../../m-parallel/core/index.js';
import {
  appendParallelWebgpuStreamPage,
  createParallelWebgpuPlot,
  updateParallelWebgpuStreamBuffers,
} from '../engine/createParallelWebgpuPlot.js';
import type {
  ParallelWebgpuPlotInstance,
  ParallelWebgpuPlotOptions,
  ParallelWebgpuPlotUpdateOptions,
} from '../engine/types.js';

// Decoder-prepared pages append every batch. Sources without packed pages keep
// a sparse replacement fallback because recreating the renderer is expensive.
const RENDER_PREFIX_GROWTH_FACTOR = 16;
const DEFAULT_REPRESENTATIVE_RECORD_LIMIT = 120_000;

export interface ParallelWebgpuStreamBatch {
  readonly columns: ParallelFastColumns;
  /** Optional decoder-prepared GPU page that avoids repacking this batch. */
  readonly packedPage?: ParallelWebgpuPackedPage;
}

export interface ParallelWebgpuStreamSource {
  readonly batches: AsyncIterable<ParallelWebgpuStreamBatch>;
  /** Capacity/progress hint. When supplied, the final count is validated. */
  readonly expectedCount?: number;
  /** Initial logical capacity hint retained across progressive prefixes. */
  readonly initialCapacity?: number;
  /** Stable full-stream domains used for every progressively built prefix. */
  readonly domainsByAxis: ParallelAxisDomains;
  readonly missingValueCountByAxis?: Readonly<Record<string, number>>;
}

export interface ParallelWebgpuStreamProgress {
  readonly capacity: number;
  readonly complete: boolean;
  readonly expectedCount?: number;
  readonly loadedCount: number;
}

export interface ParallelWebgpuStreamingController {
  readonly done: Promise<void>;
  abort(reason?: unknown): void;
  getBuffers(): ParallelBuffers;
  getProgress(): ParallelWebgpuStreamProgress;
}

export interface ParallelWebgpuStreamingPlotInstance
  extends Omit<ParallelWebgpuPlotInstance, 'update'> {
  readonly streaming: ParallelWebgpuStreamingController;
  update(options: Omit<ParallelWebgpuPlotUpdateOptions, 'buffers'>): void;
}

export interface ParallelWebgpuStreamingPlotOptions
  extends Omit<ParallelWebgpuPlotOptions, 'buffers'> {
  readonly dataSource: ParallelWebgpuStreamSource;
  readonly onStreamProgress?: (progress: ParallelWebgpuStreamProgress) => void;
  readonly signal?: AbortSignal;
}

/**
 * Creates an interactive WebGPU parallel plot from the first non-empty batch,
 * then progressively replaces its data prefix while retaining interaction state.
 */
export async function createParallelWebgpuStreamingPlot(
  hostElement: HTMLElement,
  options: ParallelWebgpuStreamingPlotOptions,
): Promise<ParallelWebgpuStreamingPlotInstance> {
  const { dataSource, onStreamProgress, signal, ...plotOptions } = options;
  validateCountHint(dataSource.expectedCount, 'expectedCount');
  validateCountHint(dataSource.initialCapacity, 'initialCapacity');
  throwIfAborted(signal);

  const abortController = new AbortController();
  const abortFromCaller = () => abortController.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const iterator = dataSource.batches[Symbol.asyncIterator]();
  const batches: ParallelFastColumns[] = [];
  const bufferBatches: ParallelBuffers[] = [];
  const packedPages: ParallelWebgpuPackedPage[] = [];
  let first: ParallelWebgpuStreamBatch | null;
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
    throw new Error('A streamed parallel source ended before supplying a non-empty batch.');
  }
  let firstCount: number;
  let columns: ParallelFastColumns;
  let buffers: ParallelBuffers;
  let capacity: number;
  try {
    firstCount = validateBatch(first.columns, null);
    validatePackedPage(first.packedPage, 0, firstCount, first.columns.axisOrder.length);
    capacity = normalizeCapacity(
      dataSource.expectedCount ?? dataSource.initialCapacity,
      firstCount,
    );
    batches.push(first.columns);
    bufferBatches.push(buildBatchBuffers(first.columns, dataSource));
    if (first.packedPage !== undefined) packedPages.push(first.packedPage);
    columns = first.columns;
    buffers = mergeParallelBufferBatches(
      batches,
      bufferBatches,
      dataSource,
      packedPages,
      plotOptions.representativeRecordLimit,
      capacity,
    );
  } catch (error) {
    signal?.removeEventListener('abort', abortFromCaller);
    closeIterator(iterator);
    throw error;
  }
  let loadedCount = firstCount;
  let renderedCount = loadedCount;
  let nextRenderCount = getNextRenderCount(
    renderedCount,
    dataSource.expectedCount,
  );
  let progress = createProgress(loadedCount, capacity, false, dataSource.expectedCount);

  let plot: ParallelWebgpuPlotInstance;
  try {
    onStreamProgress?.(progress);
    plot = createParallelWebgpuPlot(hostElement, { ...plotOptions, buffers });
  } catch (error) {
    signal?.removeEventListener('abort', abortFromCaller);
    abortController.abort(error);
    void closeIterator(iterator);
    throw error;
  }

  let currentAxisViewports: ParallelAxisViewports = plotOptions.axisViewports ?? {};
  let currentBrushIntervals: ParallelBrushIntervals = plotOptions.brushIntervals ?? {};
  let currentSelectedSourceIndices = plotOptions.selectedSourceIndices;
  const originalUpdate = plot.update.bind(plot);
  const stopViewportTracking = plot.on('axisviewportchange', (event) => {
    currentAxisViewports = event.axisViewports;
  });
  const stopBrushTracking = plot.on('brushchange', (event) => {
    currentBrushIntervals = event.brushIntervals;
  });
  const stopSelectionTracking = plot.on('selectionchange', (event) => {
    currentSelectedSourceIndices = event.sourceIndices;
  });
  let disposed = false;

  const renderPendingPrefix = async (): Promise<void> => {
    if (renderedCount === loadedCount) return;
    const nextBuffers = mergeParallelBufferBatches(
      batches,
      bufferBatches,
      dataSource,
      packedPages,
      plotOptions.representativeRecordLimit,
      capacity,
    );
    const selectedSourceIndices = currentSelectedSourceIndices;
    await waitForParallelBrushSelection(
      plot,
      currentBrushIntervals,
      () => updateParallelWebgpuStreamBuffers(plot, {
        axisViewports: currentAxisViewports,
        brushIntervals: currentBrushIntervals,
        buffers: nextBuffers,
      }),
    );
    if (
      selectedSourceIndices !== undefined &&
      !hasParallelBrushIntervals(currentBrushIntervals)
    ) {
      currentSelectedSourceIndices = selectedSourceIndices;
      plot.update({ selectedSourceIndices });
    }
    buffers = nextBuffers;
    renderedCount = loadedCount;
    nextRenderCount = getNextRenderCount(
      renderedCount,
      dataSource.expectedCount,
    );
  };

  const done = (async () => {
    try {
      await plot.interactive;
      while (!abortController.signal.aborted) {
        const result = await nextWithAbort(iterator, abortController.signal);
        if (result.done) break;
        const count = validateBatch(result.value.columns, columns);
        if (count === 0) continue;
        const nextLoadedCount = loadedCount + count;
        if (
          (result.value.packedPage === undefined) !==
          (first.packedPage === undefined)
        ) {
          throw new Error(
            'Every streamed parallel batch must consistently supply packed pages.',
          );
        }
        validatePackedPage(
          result.value.packedPage,
          loadedCount,
          count,
          columns.axisOrder.length,
        );
        batches.push(result.value.columns);
        bufferBatches.push(buildBatchBuffers(result.value.columns, dataSource));
        if (result.value.packedPage !== undefined) packedPages.push(result.value.packedPage);
        loadedCount = nextLoadedCount;
        const previousCapacity = capacity;
        capacity = growCapacity(capacity, loadedCount);
        if (result.value.packedPage !== undefined) {
          if (capacity > previousCapacity) {
            await renderPendingPrefix();
          } else {
            const nextBuffers = mergeParallelBufferBatches(
              batches,
              bufferBatches,
              dataSource,
              packedPages,
              plotOptions.representativeRecordLimit,
              capacity,
            );
            await waitForParallelBrushSelection(
              plot,
              currentBrushIntervals,
              async () => {
                await appendParallelWebgpuStreamPage(
                  plot,
                  result.value.packedPage!,
                  nextBuffers,
                );
                if (hasParallelBrushIntervals(currentBrushIntervals)) {
                  plot.update({ brushIntervals: currentBrushIntervals });
                }
              },
            );
            renderedCount = loadedCount;
            nextRenderCount = getNextRenderCount(
              renderedCount,
              dataSource.expectedCount,
            );
          }
        } else if (
          loadedCount >= nextRenderCount ||
          loadedCount === dataSource.expectedCount
        ) {
          await renderPendingPrefix();
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
      await renderPendingPrefix();
      if (
        dataSource.expectedCount !== undefined &&
        loadedCount !== dataSource.expectedCount
      ) {
        throw new Error(
          `Streamed parallel source supplied ${loadedCount} records; expected ${dataSource.expectedCount}.`,
        );
      }
      progress = createProgress(loadedCount, capacity, true, dataSource.expectedCount);
      onStreamProgress?.(progress);
    } finally {
      if (!disposed && renderedCount !== loadedCount) {
        try {
          await renderPendingPrefix();
        } catch {
          // Preserve the original transport, validation, or abort error.
        }
      }
      signal?.removeEventListener('abort', abortFromCaller);
      closeIterator(iterator);
    }
  })();
  void done.catch(() => undefined);

  const streaming: ParallelWebgpuStreamingController = {
    abort(reason = new DOMException('Parallel stream loading was aborted.', 'AbortError')) {
      if (!abortController.signal.aborted) abortController.abort(reason);
    },
    done,
    getBuffers: () => buffers,
    getProgress: () => progress,
  };
  const originalDispose = plot.dispose.bind(plot);
  Object.assign(plot, {
    dispose() {
      if (disposed) return;
      disposed = true;
      stopViewportTracking();
      stopBrushTracking();
      stopSelectionTracking();
      streaming.abort();
      originalDispose();
    },
    streaming,
    update(updateOptions: ParallelWebgpuPlotUpdateOptions) {
      if (updateOptions.buffers !== undefined) {
        throw new Error('A streamed parallel plot owns buffers through dataSource.');
      }
      originalUpdate(updateOptions);
    },
  });
  return plot as ParallelWebgpuStreamingPlotInstance;
}

export const createParallelFastWebgpuStreamingPlot =
  createParallelWebgpuStreamingPlot;

function buildBatchBuffers(
  columns: ParallelFastColumns,
  source: ParallelWebgpuStreamSource,
): ParallelBuffers {
  return createParallelWebgpuBuffers(columns, {
    preparedDomainsByAxis: source.domainsByAxis,
    ...(source.missingValueCountByAxis === undefined
      ? {}
      : { preparedMissingValueCountByAxis: source.missingValueCountByAxis }),
    trustedEncodedTypedColumns: true,
  });
}

function mergeParallelBufferBatches(
  columnBatches: readonly ParallelFastColumns[],
  bufferBatches: readonly ParallelBuffers[],
  source: ParallelWebgpuStreamSource,
  packedPages: readonly ParallelWebgpuPackedPage[],
  requestedRepresentativeRecordLimit: number | undefined,
  streamingCapacity: number,
): ParallelBuffers {
  const first = bufferBatches[0]!;
  const counts = bufferBatches.map((batch) => batch.recordCount);
  const offsets = prefixOffsets(counts);
  const recordCount = counts.reduce((sum, count) => sum + count, 0);
  const pages = [...packedPages];
  const ids = concatenateReadonlyArrays(columnBatches.map((batch) => batch.ids));
  const rawValuesByAxis = Object.fromEntries(first.axisOrder.map((axis) => [
    axis,
    pages.length === 0
      ? concatenateNumericValues(
          bufferBatches.map((batch) => batch.rawValuesByAxis[axis]!),
        )
      : createSegmentedNumericView(
          bufferBatches.map((batch) => batch.rawValuesByAxis[axis]!),
        ),
  ])) as ParallelBuffers['rawValuesByAxis'];
  const preselected: number[] = [];
  for (let batchIndex = 0; batchIndex < bufferBatches.length; batchIndex += 1) {
    const offset = offsets[batchIndex]!;
    for (const sourceIndex of bufferBatches[batchIndex]!.preselectedSourceIndices) {
      preselected.push(offset + sourceIndex);
    }
  }
  const styleColors = bufferBatches.map((batch) => batch.styleBuffers?.color);
  const styleBuffers = styleColors.every((color) => color !== undefined)
    ? {
        color: pages.length === 0
          ? concatenateRgbaColors(
              styleColors as readonly NonNullable<typeof styleColors[number]>[],
            )
          : createSegmentedRgbaView(
              styleColors as readonly NonNullable<typeof styleColors[number]>[],
            ),
        colorFormat: 'rgba8' as const,
        opacity: new Float32Array(0),
        styledRecordCount: recordCount,
      }
    : undefined;
  const recordIdentityBySourceIndex = columnBatches.some(
    (batch) => batch.recordIdentityBySourceIndex !== undefined,
  )
    ? createMergedRecordIdentities(columnBatches, offsets, ids)
    : undefined;
  const representativeRecordLimit = Math.min(
    normalizeRepresentativeRecordLimit(requestedRepresentativeRecordLimit),
    Math.max(
      recordCount,
      streamingCapacity,
    ),
  );
  const representativeSourceIndices = pages.length === 1
    ? createUniformRepresentativeSourceIndices(
        recordCount,
        Math.min(
          recordCount,
          Math.max(
            1,
            Math.round(
              (recordCount / streamingCapacity) * representativeRecordLimit,
            ),
          ),
        ),
      )
    : undefined;
  return {
    axisCount: first.axisCount,
    axisMetadataByAxis: first.axisMetadataByAxis,
    axisOrder: first.axisOrder,
    domainsByAxis: source.domainsByAxis,
    ids,
    lineSeriesBuffers: first.lineSeriesBuffers,
    missingValueCountByAxis:
      source.missingValueCountByAxis ?? first.missingValueCountByAxis,
    normalizedValuesByAxis: first.normalizedValuesByAxis,
    normalizedValuesDerivedFromRaw: true,
    preselectedCount: preselected.length,
    preselectedSourceIndices: Uint32Array.from(preselected),
    rawValuesByAxis,
    recordCount,
    ...(recordIdentityBySourceIndex === undefined
      ? {}
      : { recordIdentityBySourceIndex }),
    ...(styleBuffers === undefined ? {} : { styleBuffers }),
    ...(pages.length === 0
      ? {}
      : {
          webgpuPackedData: {
            async *createPages() {
              yield* pages;
            },
            representativeRecordLimit,
            ...(representativeSourceIndices === undefined
              ? {}
              : {
                  representativeSourceIndices: Promise.resolve(
                    representativeSourceIndices,
                  ),
                }),
            streamingCapacity,
          },
        }),
  };
}

function concatenateNumericValues(
  values: readonly ArrayLike<number>[],
): ParallelBuffers['rawValuesByAxis'][string] {
  const first = values[0]!;
  if (!ArrayBuffer.isView(first)) return createSegmentedNumericView(values);
  const Constructor = first.constructor as unknown as {
    new(length: number): {
      readonly length: number;
      set(values: ArrayLike<number>, offset: number): void;
    };
  };
  const length = values.reduce((sum, value) => sum + value.length, 0);
  const result = new Constructor(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result as unknown as ParallelBuffers['rawValuesByAxis'][string];
}

function concatenateRgbaColors(
  colors: readonly ArrayLike<number>[],
): Uint8Array {
  const length = colors.reduce((sum, color) => sum + color.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const color of colors) {
    result.set(color, offset);
    offset += color.length;
  }
  return result;
}

function createSegmentedNumericView(
  values: readonly ArrayLike<number>[],
): ParallelBuffers['rawValuesByAxis'][string] {
  const counts = values.map((value) => value.length);
  const offsets = prefixOffsets(counts);
  const length = counts.reduce((sum, count) => sum + count, 0);
  const getValue = (index: number) => {
    const batchIndex = findBatchIndex(index, offsets, counts);
    return batchIndex < 0
      ? Number.NaN
      : values[batchIndex]![index - offsets[batchIndex]!] ?? Number.NaN;
  };
  const target = {
    __parallelCompactGetValue: getValue,
    __parallelCompactNumericView: true as const,
    length,
  };
  return new Proxy(target, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target];
      return typeof property === 'string' && /^\d+$/u.test(property)
        ? getValue(Number(property))
        : undefined;
    },
  }) as unknown as ParallelBuffers['rawValuesByAxis'][string];
}

function createSegmentedRgbaView(
  colors: readonly ArrayLike<number>[],
): NonNullable<ParallelBuffers['styleBuffers']>['color'] {
  const recordCounts = colors.map((color) => Math.floor(color.length / 4));
  const offsets = prefixOffsets(recordCounts);
  const recordCount = recordCounts.reduce((sum, count) => sum + count, 0);
  const getChannel = (sourceIndex: number, channel: number) => {
    const batchIndex = findBatchIndex(sourceIndex, offsets, recordCounts);
    return batchIndex < 0
      ? 0
      : colors[batchIndex]![(sourceIndex - offsets[batchIndex]!) * 4 + channel] ?? 0;
  };
  const getPackedRgba = (sourceIndex: number) =>
    (
      getChannel(sourceIndex, 0) |
      (getChannel(sourceIndex, 1) << 8) |
      (getChannel(sourceIndex, 2) << 16) |
      (getChannel(sourceIndex, 3) << 24)
    ) >>> 0;
  const target = {
    __parallelCompactGetPackedRgba: getPackedRgba,
    __parallelCompactRgbaView: true as const,
    length: recordCount * 4,
  };
  return new Proxy(target, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target];
      if (typeof property !== 'string' || !/^\d+$/u.test(property)) {
        return undefined;
      }
      const index = Number(property);
      return index < target.length
        ? getChannel(Math.floor(index / 4), index % 4)
        : undefined;
    },
  });
}

function createMergedRecordIdentities(
  batches: readonly ParallelFastColumns[],
  offsets: readonly number[],
  ids: readonly string[],
): NonNullable<ParallelBuffers['recordIdentityBySourceIndex']> {
  const counts = batches.map((batch) => batch.ids.length);
  const length = counts.reduce((sum, count) => sum + count, 0);
  return createReadonlyIndexView(length, (sourceIndex) => {
      const batchIndex = findBatchIndex(sourceIndex, offsets, counts);
      if (batchIndex < 0) return undefined;
      const localIndex = sourceIndex - offsets[batchIndex]!;
      const batch = batches[batchIndex]!;
      const record = batch.recordIdentityBySourceIndex?.[localIndex];
      return record === undefined
        ? {
            id: ids[sourceIndex] ?? String(sourceIndex),
            sourceIndex,
            table: batch.tableBySourceIndex?.[localIndex] ?? '',
          }
        : { ...record, sourceIndex };
    }) as NonNullable<ParallelBuffers['recordIdentityBySourceIndex']>;
}

function findBatchIndex(
  index: number,
  offsets: readonly number[],
  counts: readonly number[],
): number {
  if (index < 0) return -1;
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const start = offsets[middle]!;
    const end = start + counts[middle]!;
    if (index < start) high = middle - 1;
    else if (index >= end) low = middle + 1;
    else return middle;
  }
  return -1;
}

function normalizeRepresentativeRecordLimit(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value)
    ? DEFAULT_REPRESENTATIVE_RECORD_LIMIT
    : Math.max(0, Math.floor(value));
}

function createUniformRepresentativeSourceIndices(
  recordCount: number,
  limit: number,
): Uint32Array {
  if (limit <= 0 || recordCount <= 0) return new Uint32Array(0);
  if (limit >= recordCount) {
    return Uint32Array.from({ length: recordCount }, (_, index) => index);
  }
  const result = new Uint32Array(limit);
  const denominator = Math.max(1, limit - 1);
  for (let index = 0; index < limit; index += 1) {
    result[index] = Math.floor((index * (recordCount - 1)) / denominator);
  }
  return result;
}

function validatePackedPage(
  page: ParallelWebgpuPackedPage | undefined,
  expectedStart: number,
  expectedCount: number,
  axisCount: number,
): void {
  if (page === undefined) return;
  if (page.start !== expectedStart || page.count !== expectedCount) {
    throw new Error(
      `Streamed parallel packed page starts at ${page.start} with ${page.count} records; expected ${expectedStart} with ${expectedCount}.`,
    );
  }
  const expectedValueWords = Math.max(
    1,
    Math.ceil((expectedCount * axisCount) / 2),
  );
  if (page.values.length !== expectedValueWords) {
    throw new Error(
      `Streamed parallel packed values contain ${page.values.length} words; expected ${expectedValueWords}.`,
    );
  }
  const expectedStyleWords = Math.max(1, Math.ceil(expectedCount / 2));
  if (page.densityStyles.length !== expectedStyleWords) {
    throw new Error(
      `Streamed parallel packed styles contain ${page.densityStyles.length} words; expected ${expectedStyleWords}.`,
    );
  }
}

function validateBatch(
  columns: ParallelFastColumns,
  previous: ParallelFastColumns | null,
): number {
  const count = columns.ids.length;
  if (columns.axisOrder.length === 0) {
    throw new Error('A streamed parallel batch requires at least one axis.');
  }
  if (
    previous !== null &&
    (previous.axisOrder.length !== columns.axisOrder.length ||
      previous.axisOrder.some((axis, index) => axis !== columns.axisOrder[index]))
  ) {
    throw new Error('Every streamed parallel batch must use the same axis order.');
  }
  for (const axis of columns.axisOrder) {
    const values = columns.valuesByAxis[axis];
    if (values?.length !== count) {
      throw new Error(`Streamed parallel axis "${axis}" does not match the batch count.`);
    }
    if (
      !ArrayBuffer.isView(values) &&
      !(typeof values === 'object' && '__parallelCompactNumericView' in values)
    ) {
      throw new Error(
        `Streamed parallel axis "${axis}" must already be a numeric typed column.`,
      );
    }
  }
  if (columns.opacity !== undefined && columns.opacity.length !== count) {
    throw new Error('Streamed parallel opacity does not match the batch count.');
  }
  const colorStride = columns.colorFormat === 'rgba8' ||
      (columns.colorFormat === undefined && columns.color?.length === count * 4)
    ? 4
    : 1;
  if (columns.color !== undefined && columns.color.length !== count * colorStride) {
    throw new Error('Streamed parallel color does not match the batch count.');
  }
  if (
    previous !== null &&
    (previous.color === undefined) !== (columns.color === undefined)
  ) {
    throw new Error('Every streamed parallel batch must consistently supply color.');
  }
  return count;
}

function concatenateReadonlyArrays<T>(
  arrays: readonly (readonly T[])[],
): readonly T[] {
  const lengths = arrays.map((array) => array.length);
  const offsets = prefixOffsets(lengths);
  const length = lengths.reduce((sum, value) => sum + value, 0);
  return createReadonlyIndexView(length, (index) => {
      let low = 0;
      let high = arrays.length - 1;
      while (low <= high) {
        const middle = (low + high) >>> 1;
        const start = offsets[middle]!;
        const end = start + lengths[middle]!;
        if (index < start) high = middle - 1;
        else if (index >= end) low = middle + 1;
        else return arrays[middle]![index - start];
      }
      return undefined;
    });
}

function createReadonlyIndexView<T>(
  length: number,
  getValue: (index: number) => T | undefined,
): readonly T[] {
  return new Proxy({ length }, {
    get(target, property, receiver) {
      if (property === 'length') return target.length;
      if (property === 'toJSON') return () => Array.from(receiver as ArrayLike<T>);
      if (typeof property === 'string' && /^(0|[1-9]\d*)$/u.test(property)) {
        const index = Number(property);
        return index < target.length ? getValue(index) : undefined;
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

function prefixOffsets(counts: readonly number[]): number[] {
  let total = 0;
  return counts.map((count) => {
    const offset = total;
    total += count;
    return offset;
  });
}

function hasParallelBrushIntervals(brushes: ParallelBrushIntervals): boolean {
  return Object.values(brushes).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined
  );
}

async function waitForParallelBrushSelection(
  plot: ParallelWebgpuPlotInstance,
  brushes: ParallelBrushIntervals,
  action: () => Promise<void>,
): Promise<void> {
  if (!hasParallelBrushIntervals(brushes)) {
    await action();
    return;
  }
  let stopSelection: () => void = () => {};
  let stopRenderState: () => void = () => {};
  const selection = new Promise<void>((resolve, reject) => {
    stopSelection = plot.on('selectionchange', () => resolve());
    stopRenderState = plot.on('renderstatechange', (event) => {
      if (event.state === 'error') {
        reject(new Error(event.message ?? 'Parallel WebGPU selection refresh failed.'));
      }
    });
  });
  try {
    await action();
    await selection;
  } finally {
    stopSelection();
    stopRenderState();
  }
}

async function readNextNonEmptyBatch(
  iterator: AsyncIterator<ParallelWebgpuStreamBatch>,
  signal: AbortSignal,
): Promise<ParallelWebgpuStreamBatch | null> {
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
    throw new Error(`Parallel stream ${label} must be a non-negative safe integer.`);
  }
}

function normalizeCapacity(hint: number | undefined, count: number): number {
  return Math.max(count, hint ?? Math.max(1024, count));
}

function growCapacity(capacity: number, count: number): number {
  let next = capacity;
  while (next < count) next = Math.max(count, next * 2);
  return next;
}

function getNextRenderCount(
  renderedCount: number,
  expectedCount: number | undefined,
): number {
  const doubled = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(
      renderedCount + 1,
      renderedCount * RENDER_PREFIX_GROWTH_FACTOR,
    ),
  );
  return expectedCount === undefined ? doubled : Math.min(expectedCount, doubled);
}

function createProgress(
  loadedCount: number,
  capacity: number,
  complete: boolean,
  expectedCount: number | undefined,
): ParallelWebgpuStreamProgress {
  return {
    capacity,
    complete,
    ...(expectedCount === undefined ? {} : { expectedCount }),
    loadedCount,
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Parallel stream loading was aborted.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
