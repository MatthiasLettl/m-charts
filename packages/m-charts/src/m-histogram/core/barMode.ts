import type {
  HistogramAggregationSet,
  HistogramBarBinInput,
  HistogramBarSeries,
  HistogramBin,
  HistogramBinDescriptor,
  HistogramBinSizeState,
  HistogramCategorySpec,
  HistogramColorStackSegment,
  HistogramParameterKey,
  HistogramSourceIndexArray,
  HistogramSubplotBins,
  HistogramSubplotId,
} from './types.js';

interface MutableMetrics {
  binCount: number;
  colorSegmentCount: number;
  excludedValueCount: number;
  invalidValueCount: number;
  missingValueCount: number;
  outOfDomainValueCount: number;
  sourceIndexCount: number;
  totalCount: number;
}

interface NormalizedBinMembership {
  readonly sourceIndices: Uint32Array | null;
  readonly sourceIndicesAvailable: boolean;
}

export function normalizeHistogramBarSeries(
  input: HistogramBarSeries | readonly HistogramBarSeries[],
): HistogramAggregationSet {
  const series = Array.isArray(input) ? input : [input];
  const subplots: HistogramSubplotBins[] = [];
  const metrics = createEmptyMutableMetrics();

  for (const subplotSeries of series) {
    const subplot = normalizeHistogramBarSubplot(subplotSeries);
    subplots.push(subplot);
    metrics.binCount += subplot.binCount;
    metrics.totalCount += sumSubplotCounts(subplot);
    metrics.sourceIndexCount += subplot.sourceIndices?.length ?? 0;
    metrics.colorSegmentCount += sumColorSegments(subplot);
  }

  return {
    metrics,
    mode: 'bar',
    pointCount: metrics.totalCount,
    subplots,
  };
}

export function normalizeHistogramBarBinSizeState(
  binSize: HistogramBinSizeState,
): HistogramBinSizeState {
  return {
    ...binSize,
    adjustment: 'none',
  };
}

function normalizeHistogramBarSubplot(
  series: HistogramBarSeries,
): HistogramSubplotBins {
  const sourceIndicesByBin: Uint32Array[] = [];
  const bins: HistogramBin[] = new Array(series.bins.length);
  const seriesSourceIndices =
    series.sourceIndices === undefined ? null : toUint32Array(series.sourceIndices);
  let sourceIndicesAvailable = true;
  let sourceOffset = 0;

  for (let binIndex = 0; binIndex < series.bins.length; binIndex += 1) {
    const input = series.bins[binIndex];
    const count = normalizeCount(input?.totalCount ?? input?.count);
    const membership = normalizeBinMembership(input, count, seriesSourceIndices);
    const stack = normalizeColorStack(input?.colorStack);

    if (!membership.sourceIndicesAvailable) {
      sourceIndicesAvailable = false;
    }

    const binSourceIndices = membership.sourceIndices;
    if (binSourceIndices !== null) {
      sourceIndicesByBin.push(binSourceIndices);
    }

    bins[binIndex] = {
      descriptor: createBarBinDescriptor(
        input,
        series,
        series.parameterKey,
        series.subplotId,
        binIndex,
      ),
      hovered: false,
      membership: {
        count: binSourceIndices?.length ?? count,
        offset: binSourceIndices === null ? 0 : sourceOffset,
        sourceIndicesAvailable: membership.sourceIndicesAvailable,
      },
      selectedCount: 0,
      stack,
      totalCount: count,
    };

    sourceOffset += binSourceIndices?.length ?? 0;
  }

  return {
    binCount: bins.length,
    bins,
    dataMode: 'bar',
    parameterKey: series.parameterKey,
    sourceIndices:
      sourceIndicesByBin.length > 0
        ? flattenSourceIndices(sourceIndicesByBin, sourceOffset)
        : undefined,
    sourceIndicesAvailable,
    subplotId: series.subplotId,
  };
}

function normalizeBinMembership(
  input: HistogramBarBinInput | undefined,
  count: number,
  seriesSourceIndices: Uint32Array | null,
): NormalizedBinMembership {
  if (input === undefined) {
    return { sourceIndices: null, sourceIndicesAvailable: false };
  }

  if (input.sourceIndices !== undefined) {
    return {
      sourceIndices: toUint32Array(input.sourceIndices),
      sourceIndicesAvailable: true,
    };
  }

  if (input.sourceIndexRange !== undefined) {
    return {
      sourceIndices: createSourceIndexRange(input.sourceIndexRange),
      sourceIndicesAvailable: true,
    };
  }

  if (input.sourceMembership?.sourceIndicesAvailable === true) {
    if (seriesSourceIndices !== null) {
      return {
        sourceIndices: seriesSourceIndices.slice(
          input.sourceMembership.offset,
          input.sourceMembership.offset + input.sourceMembership.count,
        ),
        sourceIndicesAvailable: true,
      };
    }

    return {
      sourceIndices: createSourceIndexRange({
        count: input.sourceMembership.count,
        start: input.sourceMembership.offset,
      }),
      sourceIndicesAvailable: true,
    };
  }

  if (count === 0) {
    return { sourceIndices: new Uint32Array(0), sourceIndicesAvailable: true };
  }

  return { sourceIndices: null, sourceIndicesAvailable: false };
}

function createBarBinDescriptor(
  input: HistogramBarBinInput | undefined,
  series: HistogramBarSeries,
  parameterKey: HistogramParameterKey,
  subplotId: HistogramSubplotId,
  binIndex: number,
): HistogramBinDescriptor {
  const category = normalizeCategory(input, binIndex);
  const min = normalizeNumber(input?.min);
  const max = normalizeNumber(input?.max);

  if (category !== undefined && (min === null || max === null)) {
    const encoded = category.encoded;
    return {
      category,
      center: encoded,
      index: binIndex,
      max: encoded + 0.5,
      metadata: input?.metadata ?? series.metadata,
      min: encoded - 0.5,
      parameterKey,
      source: input?.source ?? series.source,
      subplotId,
      table: input?.table ?? series.table,
    };
  }

  const normalizedMin = min ?? binIndex;
  const normalizedMax = max !== null && max > normalizedMin ? max : normalizedMin + 1;

  return {
    category,
    center: (normalizedMin + normalizedMax) / 2,
    index: binIndex,
    max: normalizedMax,
    metadata: input?.metadata ?? series.metadata,
    min: normalizedMin,
    parameterKey,
    source: input?.source ?? series.source,
    subplotId,
    table: input?.table ?? series.table,
  };
}

function normalizeCategory(
  input: HistogramBarBinInput | undefined,
  binIndex: number,
): HistogramCategorySpec | undefined {
  if (input?.category !== undefined) {
    return input.category;
  }

  if (input?.categoryValue === undefined) {
    return undefined;
  }

  const encoded =
    normalizeNumber(input.categoryEncoded) ??
    (typeof input.categoryValue === 'number' && Number.isFinite(input.categoryValue)
      ? input.categoryValue
      : binIndex);

  return {
    encoded,
    label: input.categoryLabel ?? String(input.categoryValue),
    value: input.categoryValue,
  };
}

function normalizeColorStack(
  stack: readonly Pick<HistogramColorStackSegment, 'color' | 'count'>[] | undefined,
): HistogramColorStackSegment[] {
  if (stack === undefined || stack.length === 0) {
    return [];
  }

  const segments: HistogramColorStackSegment[] = [];
  let startCount = 0;

  for (const segment of stack) {
    const count = normalizeCount(segment.count);
    if (count === 0) {
      continue;
    }

    const endCount = startCount + count;
    segments.push({
      color: segment.color >>> 0,
      count,
      endCount,
      startCount,
    });
    startCount = endCount;
  }

  return segments;
}

function flattenSourceIndices(
  sourceIndicesByBin: readonly Uint32Array[],
  totalCount: number,
): HistogramSourceIndexArray {
  const sourceIndices = new Uint32Array(totalCount);
  let offset = 0;

  for (const binSourceIndices of sourceIndicesByBin) {
    sourceIndices.set(binSourceIndices, offset);
    offset += binSourceIndices.length;
  }

  return sourceIndices;
}

function toUint32Array(values: HistogramSourceIndexArray | readonly number[]): Uint32Array {
  if (values instanceof Uint32Array) {
    return values;
  }

  return Uint32Array.from(values, (value) => normalizeSourceIndex(value));
}

function createSourceIndexRange(range: {
  readonly count: number;
  readonly start: number;
}): Uint32Array {
  const count = normalizeCount(range.count);
  const start = normalizeSourceIndex(range.start);
  const sourceIndices = new Uint32Array(count);

  for (let index = 0; index < count; index += 1) {
    sourceIndices[index] = start + index;
  }

  return sourceIndices;
}

function normalizeCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

function normalizeSourceIndex(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeNumber(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}

function sumSubplotCounts(subplot: HistogramSubplotBins): number {
  let totalCount = 0;
  for (const bin of subplot.bins) {
    totalCount += bin.totalCount;
  }
  return totalCount;
}

function sumColorSegments(subplot: HistogramSubplotBins): number {
  let colorSegmentCount = 0;
  for (const bin of subplot.bins) {
    colorSegmentCount += bin.stack.length;
  }
  return colorSegmentCount;
}

function createEmptyMutableMetrics(): MutableMetrics {
  return {
    binCount: 0,
    colorSegmentCount: 0,
    excludedValueCount: 0,
    invalidValueCount: 0,
    missingValueCount: 0,
    outOfDomainValueCount: 0,
    sourceIndexCount: 0,
    totalCount: 0,
  };
}
