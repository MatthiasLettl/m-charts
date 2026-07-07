import type {
  HistogramAggregationPreparedState,
  HistogramPreparedContinuousPlan,
  HistogramPreparedParameterPlan,
} from './aggregationPlanner.js';
import {
  prepareHistogramAggregationState,
  resolveContinuousVisibleWindow,
} from './aggregationPlanner.js';
import { resolveHistogramContinuousBinSize } from './binSizePolicy.js';
import type {
  HistogramAggregationBuildMetrics,
  HistogramAggregationSet,
  HistogramBin,
  HistogramBinDescriptor,
  HistogramBinSizeState,
  HistogramCategorySpec,
  HistogramColorArray,
  HistogramColorFormat,
  HistogramColorStackSegment,
  HistogramColumns,
  HistogramParameterKey,
  HistogramParameterSpec,
  HistogramPlotSpec,
  HistogramRange,
  HistogramSourceIndexArray,
  HistogramSourceIndicesStatus,
  HistogramSubplotBins,
  HistogramSubplotId,
  HistogramSubplotSpec,
  HistogramValueColumn,
  HistogramViewport,
} from './types.js';

const DEFAULT_CONTINUOUS_BIN_COUNT = 20;
const DEFAULT_PACKED_COLOR = 0xffffffff;

export interface HistogramAggregationRequest {
  readonly binSizes?: readonly HistogramBinSizeState[];
  readonly hoverSourceIndex?: number | null;
  readonly includeMembership?: boolean;
  readonly preparedState?: HistogramAggregationPreparedState;
  readonly plotSpec: Pick<HistogramPlotSpec, 'parameters' | 'subplots'>;
  readonly selectedSourceIndices?:
    | HistogramSourceIndexArray
    | ReadonlySet<number>
    | readonly number[];
  readonly viewport?: HistogramViewport;
}

export interface HistogramCalculatedDomain {
  readonly excludedValueCount: number;
  readonly invalidValueCount: number;
  readonly missingValueCount: number;
  readonly outOfDomainValueCount: number;
  readonly range: HistogramRange;
}

interface ContinuousBinPlan {
  readonly binCount: number;
  readonly binSize: number;
  readonly globalIndexStart: number;
  readonly max: number;
  readonly min: number;
}

interface CategoryBinPlan {
  readonly categories: readonly HistogramCategorySpec[];
  readonly encodedToBin: ReadonlyMap<number, number>;
  readonly valueToBin: ReadonlyMap<string, number>;
}

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

export function buildHistogramAggregation(
  columns: HistogramColumns,
  request: HistogramAggregationRequest,
): HistogramAggregationSet {
  const preparedState =
    request.preparedState ??
    prepareHistogramAggregationState(columns, request.plotSpec);
  const parameterByKey = createParameterLookup(request.plotSpec.parameters);
  const binSizeBySubplotAndParameter = createBinSizeLookup(request.binSizes);
  const selectedSourceIndices = createSelectedSourceIndexLookup(
    request.selectedSourceIndices,
  );
  const hoverSourceIndex = normalizeOptionalSourceIndex(request.hoverSourceIndex);
  const includeMembership = request.includeMembership ?? true;
  const subplots: HistogramSubplotBins[] = [];
  const metrics: MutableMetrics = createEmptyMutableMetrics();

  for (const subplot of request.plotSpec.subplots) {
    const parameter = parameterByKey.get(subplot.parameterKey);
    const column = columns.valuesByParameter[subplot.parameterKey];
    const preparedParameter = preparedState.parameterPlanByKey.get(subplot.parameterKey);

    if (parameter === undefined || column === undefined) {
      subplots.push(createEmptySubplot(subplot, 0));
      continue;
    }

    const binSize = getRequestedBinSize(
      binSizeBySubplotAndParameter,
      subplot.id,
      subplot.parameterKey,
    );
    const aggregation =
      parameter.kind === 'categorical' || parameter.kind === 'boolean'
        ? buildCategorySubplotAggregation(
            columns,
            column,
            parameter,
            subplot,
            selectedSourceIndices,
            hoverSourceIndex,
          )
        : buildContinuousSubplotAggregation(
            columns,
            resolveContinuousPreparedPlan(columns, parameter, preparedParameter),
            subplot,
            binSize,
            selectedSourceIndices,
            hoverSourceIndex,
            includeMembership,
            request.viewport,
          );

    addMetrics(metrics, aggregation.metrics);
    subplots.push(aggregation.subplot);
  }

  return {
    metrics,
    mode: 'histogram',
    pointCount: columns.ids.length,
    subplots,
  };
}

export function calculateHistogramDomain(
  columns: Pick<HistogramColumns, 'valuesByParameter'>,
  parameter: HistogramParameterSpec,
): HistogramCalculatedDomain {
  const column = columns.valuesByParameter[parameter.key];
  if (parameter.domain !== undefined) {
    const range = normalizeRange(parameter.domain);
    if (column === undefined) {
      return {
        excludedValueCount: 0,
        invalidValueCount: 0,
        missingValueCount: 0,
        outOfDomainValueCount: 0,
        range,
      };
    }
    let invalidValueCount = 0;
    let missingValueCount = 0;
    let outOfDomainValueCount = 0;
    for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
      const rawValue = readRawValue(column, rowIndex);
      if (isMissingValue(rawValue)) {
        missingValueCount += 1;
        continue;
      }
      const value = toFiniteNumber(rawValue);
      if (value === null) {
        invalidValueCount += 1;
        continue;
      }
      if (value < range.min || value > range.max) {
        outOfDomainValueCount += 1;
      }
    }
    return {
      excludedValueCount: invalidValueCount + missingValueCount + outOfDomainValueCount,
      invalidValueCount,
      missingValueCount,
      outOfDomainValueCount,
      range,
    };
  }

  if (parameter.kind === 'categorical' || parameter.kind === 'boolean') {
    const categories = parameter.categories ?? [];
    if (categories.length === 0) {
      return {
        excludedValueCount: 0,
        invalidValueCount: 0,
        missingValueCount: 0,
        outOfDomainValueCount: 0,
        range: { max: 1, min: 0 },
      };
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < categories.length; index += 1) {
      const encoded = categories[index]?.encoded ?? index;
      min = Math.min(min, encoded);
      max = Math.max(max, encoded);
    }

    return {
      excludedValueCount: 0,
      invalidValueCount: 0,
      missingValueCount: 0,
      outOfDomainValueCount: 0,
      range: normalizeRange({ max, min }),
    };
  }

  if (column === undefined) {
    return {
      excludedValueCount: 0,
      invalidValueCount: 0,
      missingValueCount: 0,
      outOfDomainValueCount: 0,
      range: { max: 1, min: 0 },
    };
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let invalidValueCount = 0;
  let missingValueCount = 0;

  for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
    const rawValue = readRawValue(column, rowIndex);
    if (isMissingValue(rawValue)) {
      missingValueCount += 1;
      continue;
    }

    const value = toFiniteNumber(rawValue);
    if (value === null) {
      invalidValueCount += 1;
      continue;
    }

    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  return {
    excludedValueCount: invalidValueCount + missingValueCount,
    invalidValueCount,
    missingValueCount,
    outOfDomainValueCount: 0,
    range: normalizeRange({
      max: Number.isFinite(max) ? max : 1,
      min: Number.isFinite(min) ? min : 0,
    }),
  };
}

export function materializeHistogramBinSourceIndices(
  subplot: HistogramSubplotBins,
  binIndex: number,
): HistogramSourceIndexArray {
  if (
    binIndex < 0 ||
    binIndex >= subplot.bins.length ||
    subplot.sourceIndices === undefined
  ) {
    return new Uint32Array(0);
  }

  const membership = subplot.bins[binIndex]?.membership;
  if (membership === undefined || !membership.sourceIndicesAvailable) {
    return new Uint32Array(0);
  }

  return subplot.sourceIndices.subarray(
    membership.offset,
    membership.offset + membership.count,
  );
}

function resolveContinuousPreparedPlan(
  columns: HistogramColumns,
  parameter: HistogramParameterSpec,
  preparedParameter: HistogramPreparedParameterPlan | undefined,
): HistogramPreparedContinuousPlan {
  if (preparedParameter?.kind === 'continuous') {
    return preparedParameter;
  }

  const rebuiltPlan = prepareHistogramAggregationState(columns, {
    parameters: [parameter],
  }).parameterPlanByKey.get(parameter.key);
  if (rebuiltPlan?.kind !== 'continuous') {
    throw new Error(`Expected continuous histogram plan for ${parameter.key}.`);
  }
  return rebuiltPlan;
}

function buildContinuousSubplotAggregation(
  columns: HistogramColumns,
  preparedPlan: HistogramPreparedContinuousPlan,
  subplot: HistogramSubplotSpec,
  requestedBinSize: number | null,
  selectedSourceIndices: ReadonlySet<number>,
  hoverSourceIndex: number | null,
  includeMembership: boolean,
  viewport: HistogramViewport | undefined,
): { metrics: HistogramAggregationBuildMetrics; subplot: HistogramSubplotBins } {
  const domain = preparedPlan.domain;
  const visibleWindow = resolveContinuousVisibleWindow(
    preparedPlan,
    viewport,
    subplot.id,
  );
  const binResolution = resolveHistogramContinuousBinSize({
    parameter: preparedPlan.parameter,
    requestedBinSize,
    visibleRange: visibleWindow.visibleRange,
  });
  const plan = createContinuousBinPlan(domain.range, binResolution);

  const counts = new Uint32Array(plan.binCount);
  const selectedCounts =
    selectedSourceIndices.size > 0 ? new Uint32Array(plan.binCount) : null;
  const hovered = hoverSourceIndex === null ? null : new Uint8Array(plan.binCount);
  const colorCountsByBin: Array<Map<number, number> | undefined> = new Array(
    plan.binCount,
  );
  const invalidValueCount = domain.invalidValueCount;
  const missingValueCount = domain.missingValueCount;
  let outOfDomainValueCount = domain.outOfDomainValueCount;
  let totalCount = 0;
  const candidateRowIndices =
    includeMembership
      ? new Uint32Array(
          Math.max(0, visibleWindow.candidateEnd - visibleWindow.candidateStart),
        )
      : null;
  const binIndicesByCandidate =
    includeMembership
      ? new Int32Array(
          Math.max(0, visibleWindow.candidateEnd - visibleWindow.candidateStart),
        )
      : null;
  let candidateWriteCount = 0;

  for (
    let candidateIndex = visibleWindow.candidateStart;
    candidateIndex < visibleWindow.candidateEnd;
    candidateIndex += 1
  ) {
    const rowIndex = preparedPlan.rowIndicesBySortedValue[candidateIndex] ?? -1;
    const value = preparedPlan.sortedValues[candidateIndex];
    if (rowIndex < 0 || !Number.isFinite(value)) {
      continue;
    }
    const binIndex = getContinuousBinIndex(value, plan);
    if (binIndex < 0) {
      outOfDomainValueCount += 1;
      continue;
    }

    const sourceIndex = readSourceIndex(columns.sourceIndex, rowIndex);
    const color = readPackedColorAtRow(
      columns.color,
      columns.colorFormat,
      rowIndex,
    );

    counts[binIndex] += 1;
    totalCount += 1;
    incrementColorCount(colorCountsByBin, binIndex, color);

    if (selectedCounts !== null && selectedSourceIndices.has(sourceIndex)) {
      selectedCounts[binIndex] += 1;
    }
    if (hovered !== null && sourceIndex === hoverSourceIndex) {
      hovered[binIndex] = 1;
    }
    if (candidateRowIndices !== null && binIndicesByCandidate !== null) {
      candidateRowIndices[candidateWriteCount] = rowIndex;
      binIndicesByCandidate[candidateWriteCount] = binIndex;
      candidateWriteCount += 1;
    }
  }

  return finalizeSubplotAggregation({
    binCount: plan.binCount,
    binIndicesByCandidate:
      binIndicesByCandidate === null
        ? null
        : binIndicesByCandidate.subarray(0, candidateWriteCount),
    candidateRowIndices:
      candidateRowIndices === null
        ? null
        : candidateRowIndices.subarray(0, candidateWriteCount),
    colorCountsByBin,
    counts,
    domain: createPopulatedRange(preparedPlan.sortedValues),
    hovered,
    metrics: {
      binCount: plan.binCount,
      colorSegmentCount: 0,
      excludedValueCount:
        invalidValueCount + missingValueCount + outOfDomainValueCount,
      invalidValueCount,
      missingValueCount,
      outOfDomainValueCount,
      sourceIndexCount: totalCount,
      totalCount,
    },
    parameterKey: preparedPlan.parameter.key,
    selectedCounts,
    sourceIndexColumn: columns.sourceIndex,
    sourceIndicesStatus: includeMembership ? 'available' : 'pending',
    subplotId: subplot.id,
    continuousBinResolution: binResolution,
    toDescriptor: (binIndex) =>
      createContinuousBinDescriptor(
        subplot.id,
        preparedPlan.parameter.key,
        binIndex,
        plan,
      ),
  });
}

function buildCategorySubplotAggregation(
  columns: HistogramColumns,
  column: HistogramValueColumn,
  parameter: HistogramParameterSpec,
  subplot: HistogramSubplotSpec,
  selectedSourceIndices: ReadonlySet<number>,
  hoverSourceIndex: number | null,
): { metrics: HistogramAggregationBuildMetrics; subplot: HistogramSubplotBins } {
  const plan = createCategoryBinPlan(parameter);
  const rowCount = column.length;
  const binIndicesByRow = new Int32Array(rowCount);
  binIndicesByRow.fill(-1);

  const counts = new Uint32Array(plan.categories.length);
  const selectedCounts =
    selectedSourceIndices.size > 0 ? new Uint32Array(plan.categories.length) : null;
  const hovered =
    hoverSourceIndex === null ? null : new Uint8Array(plan.categories.length);
  const colorCountsByBin: Array<Map<number, number> | undefined> = new Array(
    plan.categories.length,
  );
  let invalidValueCount = 0;
  let missingValueCount = 0;
  let totalCount = 0;

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const value = readRawValue(column, rowIndex);
    const binIndex = getCategoryBinIndex(value, plan);

    if (binIndex < 0) {
      if (isMissingValue(value)) {
        missingValueCount += 1;
      } else {
        invalidValueCount += 1;
      }
      continue;
    }

    const sourceIndex = readSourceIndex(columns.sourceIndex, rowIndex);
    const color = readPackedColorAtRow(
      columns.color,
      columns.colorFormat,
      rowIndex,
    );

    binIndicesByRow[rowIndex] = binIndex;
    counts[binIndex] += 1;
    totalCount += 1;
    incrementColorCount(colorCountsByBin, binIndex, color);

    if (selectedCounts !== null && selectedSourceIndices.has(sourceIndex)) {
      selectedCounts[binIndex] += 1;
    }
    if (hovered !== null && sourceIndex === hoverSourceIndex) {
      hovered[binIndex] = 1;
    }
  }

  return finalizeSubplotAggregation({
    binCount: plan.categories.length,
    binIndicesByCandidate: binIndicesByRow,
    candidateRowIndices: createSequentialRowIndices(rowCount),
    colorCountsByBin,
    counts,
    hovered,
    metrics: {
      binCount: plan.categories.length,
      colorSegmentCount: 0,
      excludedValueCount: invalidValueCount + missingValueCount,
      invalidValueCount,
      missingValueCount,
      outOfDomainValueCount: 0,
      sourceIndexCount: totalCount,
      totalCount,
    },
    parameterKey: parameter.key,
    selectedCounts,
    sourceIndexColumn: columns.sourceIndex,
    sourceIndicesStatus: 'available',
    subplotId: subplot.id,
    toDescriptor: (binIndex) =>
      createCategoryBinDescriptor(subplot.id, parameter.key, binIndex, plan),
  });
}

function finalizeSubplotAggregation(input: {
  readonly binCount: number;
  readonly binIndicesByCandidate: Int32Array | null;
  readonly candidateRowIndices: Uint32Array | null;
  readonly colorCountsByBin: ReadonlyArray<ReadonlyMap<number, number> | undefined>;
  readonly continuousBinResolution?: HistogramSubplotBins['continuousBinResolution'];
  readonly counts: Uint32Array;
  readonly domain?: HistogramRange;
  readonly hovered: Uint8Array | null;
  readonly metrics: HistogramAggregationBuildMetrics;
  readonly parameterKey: HistogramParameterKey;
  readonly selectedCounts: Uint32Array | null;
  readonly sourceIndexColumn?: HistogramSourceIndexArray;
  readonly sourceIndicesStatus: HistogramSourceIndicesStatus;
  readonly subplotId: HistogramSubplotId;
  readonly toDescriptor: (binIndex: number) => HistogramBinDescriptor;
}): { metrics: HistogramAggregationBuildMetrics; subplot: HistogramSubplotBins } {
  const offsets = new Uint32Array(input.binCount);
  let offset = 0;

  for (let binIndex = 0; binIndex < input.binCount; binIndex += 1) {
    offsets[binIndex] = offset;
    offset += input.counts[binIndex] ?? 0;
  }

  const sourceIndices =
    input.binIndicesByCandidate === null || input.candidateRowIndices === null
      ? undefined
      : new Uint32Array(offset);
  const writeOffsets =
    sourceIndices === undefined ? null : new Uint32Array(offsets);

  if (
    sourceIndices !== undefined &&
    writeOffsets !== null &&
    input.binIndicesByCandidate !== null &&
    input.candidateRowIndices !== null
  ) {
    for (let candidateIndex = 0; candidateIndex < input.binIndicesByCandidate.length; candidateIndex += 1) {
      const binIndex: number = input.binIndicesByCandidate[candidateIndex] ?? -1;
      if (binIndex < 0) {
        continue;
      }

      const rowIndex = input.candidateRowIndices[candidateIndex] ?? -1;
      const writeOffset = writeOffsets[binIndex] ?? 0;
      sourceIndices[writeOffset] = readSourceIndex(input.sourceIndexColumn, rowIndex);
      writeOffsets[binIndex] = writeOffset + 1;
    }
  }

  const bins: HistogramBin[] = new Array(input.binCount);
  let colorSegmentCount = 0;

  for (let binIndex = 0; binIndex < input.binCount; binIndex += 1) {
    const count = input.counts[binIndex] ?? 0;
    const stack = createColorStackSegments(input.colorCountsByBin[binIndex]);
    colorSegmentCount += stack.length;

    bins[binIndex] = {
      descriptor: input.toDescriptor(binIndex),
      hovered: input.hovered !== null ? input.hovered[binIndex] === 1 : false,
      membership: {
        count,
        offset: offsets[binIndex] ?? 0,
        sourceIndicesAvailable: input.sourceIndicesStatus === 'available',
      },
      selectedCount: input.selectedCounts?.[binIndex] ?? 0,
      stack,
      totalCount: count,
    };
  }

  const metrics = {
    ...input.metrics,
    colorSegmentCount,
  };

  return {
    metrics,
    subplot: {
      binCount: input.binCount,
      bins,
      continuousBinResolution: input.continuousBinResolution,
      dataMode: 'histogram',
      domain: input.domain,
      parameterKey: input.parameterKey,
      sourceIndices,
      sourceIndicesAvailable: input.sourceIndicesStatus === 'available',
      sourceIndicesState: input.sourceIndicesStatus,
      subplotId: input.subplotId,
    },
  };
}

function createContinuousBinPlan(
  domainRange: HistogramRange,
  resolution: HistogramSubplotBins['continuousBinResolution'],
): ContinuousBinPlan {
  const normalizedDomain = normalizeRange(domainRange);
  const visibleRange = resolution?.visibleRange ?? normalizedDomain;
  const normalizedVisible = normalizeRange({
    max: Math.min(normalizedDomain.max, visibleRange.max),
    min: Math.max(normalizedDomain.min, visibleRange.min),
  });
  const span = normalizedDomain.max - normalizedDomain.min;
  const binSize = resolution?.effectiveBinSize ?? (span > 0 ? span / DEFAULT_CONTINUOUS_BIN_COUNT : 1);
  const totalBinCount = Math.max(1, Math.ceil(span / binSize));
  const globalIndexStart = Math.max(
    0,
    Math.min(
      totalBinCount - 1,
      Math.floor((normalizedVisible.min - normalizedDomain.min) / binSize),
    ),
  );
  const globalIndexEnd = Math.max(
    globalIndexStart,
    Math.min(
      totalBinCount - 1,
      Math.ceil((normalizedVisible.max - normalizedDomain.min) / binSize) - 1,
    ),
  );
  const min = normalizedDomain.min + globalIndexStart * binSize;
  const max =
    globalIndexEnd === totalBinCount - 1
      ? normalizedDomain.max
      : Math.min(
          normalizedDomain.max,
          normalizedDomain.min + (globalIndexEnd + 1) * binSize,
        );

  return {
    binCount: globalIndexEnd - globalIndexStart + 1,
    binSize,
    globalIndexStart,
    max,
    min,
  };
}

function createPopulatedRange(sortedValues: Float64Array): HistogramRange | undefined {
  if (sortedValues.length === 0) {
    return undefined;
  }

  const min = sortedValues[0];
  const max = sortedValues[sortedValues.length - 1];
  if (min === undefined || max === undefined) {
    return undefined;
  }

  return normalizeRange({ max, min });
}

function createCategoryBinPlan(parameter: HistogramParameterSpec): CategoryBinPlan {
  const categories =
    parameter.categories !== undefined
      ? [...parameter.categories].sort(compareCategories)
      : createDefaultCategories(parameter);
  const encodedToBin = new Map<number, number>();
  const valueToBin = new Map<string, number>();

  for (let index = 0; index < categories.length; index += 1) {
    const category = categories[index];
    if (category === undefined) {
      continue;
    }

    encodedToBin.set(category.encoded, index);
    valueToBin.set(createCategoryValueKey(category.value), index);
  }

  return {
    categories,
    encodedToBin,
    valueToBin,
  };
}

function createDefaultCategories(
  parameter: HistogramParameterSpec,
): HistogramCategorySpec[] {
  if (parameter.kind === 'boolean') {
    return [
      { encoded: 0, label: 'False', value: false },
      { encoded: 1, label: 'True', value: true },
    ];
  }

  return [];
}

function createContinuousBinDescriptor(
  subplotId: HistogramSubplotId,
  parameterKey: HistogramParameterKey,
  binIndex: number,
  plan: ContinuousBinPlan,
): HistogramBinDescriptor {
  const min = plan.min + binIndex * plan.binSize;
  const max = binIndex === plan.binCount - 1 ? plan.max : min + plan.binSize;

  return {
    center: (min + max) / 2,
    index: plan.globalIndexStart + binIndex,
    max,
    min,
    parameterKey,
    subplotId,
  };
}

function createCategoryBinDescriptor(
  subplotId: HistogramSubplotId,
  parameterKey: HistogramParameterKey,
  binIndex: number,
  plan: CategoryBinPlan,
): HistogramBinDescriptor {
  const category = plan.categories[binIndex];
  const encoded = category?.encoded ?? binIndex;

  return {
    category,
    center: encoded,
    index: binIndex,
    max: encoded + 0.5,
    min: encoded - 0.5,
    parameterKey,
    subplotId,
  };
}

function getContinuousBinIndex(value: number, plan: ContinuousBinPlan): number {
  if (value < plan.min || value > plan.max) {
    return -1;
  }

  if (value === plan.max) {
    return plan.binCount - 1;
  }

  const binIndex = Math.floor((value - plan.min) / plan.binSize);
  return binIndex >= 0 && binIndex < plan.binCount ? binIndex : -1;
}

function getCategoryBinIndex(
  value: bigint | boolean | number | string | null | undefined,
  plan: CategoryBinPlan,
): number {
  if (isMissingValue(value)) {
    return -1;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? plan.encodedToBin.get(value) ?? -1 : -1;
  }

  if (typeof value === 'bigint') {
    const encoded = Number(value);
    return Number.isSafeInteger(encoded) ? plan.encodedToBin.get(encoded) ?? -1 : -1;
  }

  return plan.valueToBin.get(createCategoryValueKey(value)) ?? -1;
}

function createColorStackSegments(
  colorCounts: ReadonlyMap<number, number> | undefined,
): HistogramColorStackSegment[] {
  if (colorCounts === undefined || colorCounts.size === 0) {
    return [];
  }

  const segments: HistogramColorStackSegment[] = [];
  let startCount = 0;

  for (const [color, count] of colorCounts) {
    const endCount = startCount + count;
    segments.push({
      color,
      count,
      endCount,
      startCount,
    });
    startCount = endCount;
  }

  return segments;
}

function incrementColorCount(
  colorCountsByBin: Array<Map<number, number> | undefined>,
  binIndex: number,
  color: number,
): void {
  let colorCounts = colorCountsByBin[binIndex];
  if (colorCounts === undefined) {
    colorCounts = new Map();
    colorCountsByBin[binIndex] = colorCounts;
  }

  colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
}

function toFiniteNumber(
  value: bigint | boolean | number | string,
): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'bigint') {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  return null;
}

function readRawValue(
  column: HistogramValueColumn,
  rowIndex: number,
): bigint | boolean | number | string | null | undefined {
  return column[rowIndex];
}

function readPackedColorAtRow(
  color: HistogramColorArray | undefined,
  colorFormat: HistogramColorFormat | undefined,
  rowIndex: number,
): number {
  if (color === undefined) {
    return DEFAULT_PACKED_COLOR;
  }

  if (color instanceof Uint32Array || colorFormat === 'rgba32') {
    return color[rowIndex] ?? DEFAULT_PACKED_COLOR;
  }

  const offset = rowIndex * 4;
  if (offset + 3 >= color.length) {
    return DEFAULT_PACKED_COLOR;
  }

  return (
    (((color[offset] ?? 0) << 24) |
      ((color[offset + 1] ?? 0) << 16) |
      ((color[offset + 2] ?? 0) << 8) |
      (color[offset + 3] ?? 0)) >>>
    0
  );
}

function readSourceIndex(
  sourceIndexColumn: HistogramSourceIndexArray | undefined,
  rowIndex: number,
): number {
  return sourceIndexColumn?.[rowIndex] ?? rowIndex;
}

function normalizeRange(range: HistogramRange): HistogramRange {
  const min = Number.isFinite(range.min) ? range.min : 0;
  const max = Number.isFinite(range.max) ? range.max : min + 1;

  if (max > min) {
    return { max, min };
  }

  return {
    max: min + 1,
    min,
  };
}

function compareCategories(
  left: HistogramCategorySpec,
  right: HistogramCategorySpec,
): number {
  return (left.order ?? left.encoded) - (right.order ?? right.encoded);
}

function createCategoryValueKey(value: boolean | number | string): string {
  return `${typeof value}:${String(value)}`;
}

function isMissingValue(
  value: bigint | boolean | number | string | null | undefined,
): value is null | undefined {
  return value === null || value === undefined;
}

function createParameterLookup(
  parameters: readonly HistogramParameterSpec[],
): ReadonlyMap<HistogramParameterKey, HistogramParameterSpec> {
  const lookup = new Map<HistogramParameterKey, HistogramParameterSpec>();

  for (const parameter of parameters) {
    lookup.set(parameter.key, parameter);
  }

  return lookup;
}

function createBinSizeLookup(
  binSizes: readonly HistogramBinSizeState[] | undefined,
): ReadonlyMap<string, number> {
  const lookup = new Map<string, number>();
  if (binSizes === undefined) {
    return lookup;
  }

  for (const binSize of binSizes) {
    if (binSize.mode !== 'continuous') {
      continue;
    }

    lookup.set(
      createBinSizeLookupKey(binSize.subplotId, binSize.parameterKey),
      binSize.binSize,
    );
    lookup.set(createBinSizeLookupKey('', binSize.parameterKey), binSize.binSize);
  }

  return lookup;
}

function getRequestedBinSize(
  lookup: ReadonlyMap<string, number>,
  subplotId: HistogramSubplotId,
  parameterKey: HistogramParameterKey,
): number | null {
  return (
    lookup.get(createBinSizeLookupKey(subplotId, parameterKey)) ??
    lookup.get(createBinSizeLookupKey('', parameterKey)) ??
    null
  );
}

function createBinSizeLookupKey(
  subplotId: HistogramSubplotId,
  parameterKey: HistogramParameterKey,
): string {
  return `${subplotId}\u0000${parameterKey}`;
}

function createSelectedSourceIndexLookup(
  selectedSourceIndices:
    | HistogramSourceIndexArray
    | ReadonlySet<number>
    | readonly number[]
    | undefined,
): ReadonlySet<number> {
  if (selectedSourceIndices === undefined) {
    return new Set();
  }

  if ('size' in selectedSourceIndices) {
    return selectedSourceIndices;
  }

  if (selectedSourceIndices.length === 0) {
    return new Set();
  }

  return new Set(selectedSourceIndices);
}

function normalizeOptionalSourceIndex(sourceIndex: number | null | undefined): number | null {
  return typeof sourceIndex === 'number' && Number.isFinite(sourceIndex)
    ? sourceIndex
    : null;
}

function createEmptySubplot(
  subplot: HistogramSubplotSpec,
  binCount: number,
): HistogramSubplotBins {
  return {
    binCount,
    bins: [],
    dataMode: 'histogram',
    parameterKey: subplot.parameterKey,
    sourceIndices: new Uint32Array(0),
    sourceIndicesAvailable: true,
    sourceIndicesState: 'available',
    subplotId: subplot.id,
  };
}

function createSequentialRowIndices(rowCount: number): Uint32Array {
  const rowIndices = new Uint32Array(rowCount);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    rowIndices[rowIndex] = rowIndex;
  }
  return rowIndices;
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

function addMetrics(
  target: MutableMetrics,
  source: HistogramAggregationBuildMetrics,
): void {
  target.binCount += source.binCount;
  target.colorSegmentCount += source.colorSegmentCount;
  target.excludedValueCount += source.excludedValueCount;
  target.invalidValueCount += source.invalidValueCount;
  target.missingValueCount += source.missingValueCount;
  target.outOfDomainValueCount += source.outOfDomainValueCount;
  target.sourceIndexCount += source.sourceIndexCount;
  target.totalCount += source.totalCount;
}
