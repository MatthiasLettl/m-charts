import {
  getFastScatterAggregationByteLength,
  type FastScatterBubbleAggregationRequest,
  type FastScatterBubbleAggregationSet,
  type FastScatterBubbleSubplotAggregation,
  type FastScatterPointColumns,
} from '../../m-scatter/core/index.js';

export const FAST_SCATTER_WEBGPU_MAX_BUBBLE_AGGREGATES_PER_SUBPLOT = 1_000_000;

interface BubbleGroup {
  count: number;
  hovered: boolean;
  selectedCount: number;
  singleSourceIndex?: number;
  sourceIndices?: number[];
  y: number;
}

interface BubbleScanSummary {
  maxCount: number;
  maxOrdinal: number;
  totalAggregateCount: number;
}

/**
 * Builds exact duplicate counts while retaining a bounded, sorted aggregate LOD.
 * The WebGL2 builder materializes every aggregate and every membership list;
 * that becomes larger than the source dataset when most of a 25M-point series
 * is unique. WebGPU renders at most the same one-million-instance budget as the
 * point path, while always retaining the largest bubble.
 */
export function buildFastScatterWebgpuBubbleAggregation(
  columns: Pick<
    FastScatterPointColumns,
    'sourceIndex' | 'x' | 'xOrder' | 'y'
  >,
  request: FastScatterBubbleAggregationRequest,
  maxAggregates = FAST_SCATTER_WEBGPU_MAX_BUBBLE_AGGREGATES_PER_SUBPLOT,
): FastScatterBubbleAggregationSet {
  const startedAt = performance.now();
  const selected = new Set<number>(request.selectedSourceIndices ?? []);
  const hoverSourceIndex = normalizeSourceIndex(request.hoverSourceIndex);
  const scanRange = resolveScanRange(columns, request.xRange);
  const subplots = request.subplots.map((subplot) => {
    const yValues = columns.y[subplot.yKey];
    if (yValues === undefined) return createEmptySubplot(subplot.plotId, subplot.yKey);
    if (scanRange.end - scanRange.start > Math.max(1, maxAggregates) * 2) {
      return materializeBubbleHashedLod(
        columns,
        yValues,
        subplot.plotId,
        subplot.yKey,
        subplot.yRange,
        scanRange,
        selected,
        hoverSourceIndex,
        maxAggregates,
      );
    }
    const summary = scanBubbleGroups(
      columns,
      yValues,
      subplot.yRange,
      scanRange,
      selected,
      hoverSourceIndex,
      false,
    );
    return materializeBubbleLod(
      columns,
      yValues,
      subplot.plotId,
      subplot.yKey,
      subplot.yRange,
      scanRange,
      selected,
      hoverSourceIndex,
      summary,
      maxAggregates,
    );
  });
  const result: FastScatterBubbleAggregationSet = {
    kind: 'bubble',
    metrics: { aggregateBuildMs: 0, resultBytes: 0 },
    pointCount: columns.x.length,
    subplots,
    totalAggregateCount: subplots.reduce(
      (total, subplot) => total + subplot.totalAggregateCount,
      0,
    ),
  };
  result.metrics.resultBytes = getFastScatterAggregationByteLength(result);
  result.metrics.aggregateBuildMs = performance.now() - startedAt;
  return result;
}

function materializeBubbleHashedLod(
  columns: Pick<FastScatterPointColumns, 'sourceIndex' | 'x' | 'xOrder'>,
  yValues: ArrayLike<number>,
  plotId: string,
  yKey: string,
  yRange: { min: number; max: number },
  scanRange: { start: number; end: number },
  selected: ReadonlySet<number>,
  hoverSourceIndex: number | null,
  maxAggregates: number,
): FastScatterBubbleSubplotAggregation {
  const budget = Math.max(1, Math.floor(maxAggregates));
  const regularBudget = Math.max(0, budget - 1);
  const pointCount = scanRange.end - scanRange.start;
  const stride = regularBudget === 0
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.ceil(pointCount / (regularBudget * 0.98)));
  const centerX: number[] = [];
  const centerY: number[] = [];
  const counts: number[] = [];
  const hovered: number[] = [];
  const selectedCounts: number[] = [];
  const membershipCounts: number[] = [];
  const membershipOffsets: number[] = [];
  const sourceIndexValues: number[] = [];
  let totalAggregateCount = 0;
  let singletonCount = 0;
  let largest: { group: BubbleGroup; membership: number[]; regular: boolean; x: number } | null = null;

  visitBubbleGroups(
    columns,
    yValues,
    yRange,
    scanRange,
    selected,
    hoverSourceIndex,
    true,
    (x, group) => {
      const membership = group.sourceIndices ?? (
        group.singleSourceIndex === undefined ? [] : [group.singleSourceIndex]
      );
      const keepRegular = centerX.length < regularBudget &&
        (stride === 1 || hashBubbleCoordinate(x, group.y) % stride === 0);
      if (keepRegular) {
        appendBubbleGroup(
          centerX,
          centerY,
          counts,
          hovered,
          selectedCounts,
          membershipOffsets,
          membershipCounts,
          sourceIndexValues,
          x,
          group,
          membership,
        );
        if (group.count === 1) singletonCount += 1;
      }
      if (largest === null || group.count > largest.group.count) {
        largest = {
          group: { ...group, sourceIndices: undefined },
          membership: membership.sort((left, right) => left - right),
          regular: keepRegular,
          x,
        };
      }
      totalAggregateCount += 1;
    },
  );

  const retainedLargest = largest as {
    group: BubbleGroup;
    membership: number[];
    regular: boolean;
    x: number;
  } | null;
  if (retainedLargest !== null && !retainedLargest.regular) {
    const insertionIndex = findBubbleInsertionIndex(
      centerX,
      centerY,
      retainedLargest.x,
      retainedLargest.group.y,
    );
    const membershipOffset = insertionIndex < membershipOffsets.length
      ? membershipOffsets[insertionIndex] ?? sourceIndexValues.length
      : sourceIndexValues.length;
    centerX.splice(insertionIndex, 0, retainedLargest.x);
    centerY.splice(insertionIndex, 0, retainedLargest.group.y);
    counts.splice(insertionIndex, 0, retainedLargest.group.count);
    hovered.splice(insertionIndex, 0, retainedLargest.group.hovered ? 1 : 0);
    selectedCounts.splice(insertionIndex, 0, retainedLargest.group.selectedCount);
    membershipCounts.splice(insertionIndex, 0, retainedLargest.membership.length);
    membershipOffsets.splice(insertionIndex, 0, membershipOffset);
    insertNumbers(sourceIndexValues, membershipOffset, retainedLargest.membership);
    for (let index = insertionIndex + 1; index < membershipOffsets.length; index += 1) {
      membershipOffsets[index] =
        (membershipOffsets[index] ?? 0) + retainedLargest.membership.length;
    }
    if (retainedLargest.group.count === 1) singletonCount += 1;
  }

  return finalizeBubbleLod(
    plotId,
    yKey,
    totalAggregateCount,
    singletonCount,
    centerX,
    centerY,
    counts,
    hovered,
    selectedCounts,
    membershipOffsets,
    membershipCounts,
    sourceIndexValues,
  );
}

function insertNumbers(target: number[], offset: number, values: readonly number[]): void {
  if (values.length === 0) return;
  const previousLength = target.length;
  target.length = previousLength + values.length;
  for (let index = previousLength - 1; index >= offset; index -= 1) {
    target[index + values.length] = target[index] ?? 0;
  }
  for (let index = 0; index < values.length; index += 1) {
    target[offset + index] = values[index] ?? 0;
  }
}

function appendBubbleGroup(
  centerX: number[],
  centerY: number[],
  counts: number[],
  hovered: number[],
  selectedCounts: number[],
  membershipOffsets: number[],
  membershipCounts: number[],
  sourceIndexValues: number[],
  x: number,
  group: BubbleGroup,
  membershipInput: readonly number[],
): void {
  const membership = [...membershipInput].sort((left, right) => left - right);
  centerX.push(x);
  centerY.push(group.y);
  counts.push(group.count);
  hovered.push(group.hovered ? 1 : 0);
  selectedCounts.push(group.selectedCount);
  membershipOffsets.push(sourceIndexValues.length);
  membershipCounts.push(membership.length);
  for (const sourceIndex of membership) sourceIndexValues.push(sourceIndex);
}

function hashBubbleCoordinate(x: number, y: number): number {
  const xLow = Math.floor(x) >>> 0;
  const xFraction = Math.floor(Math.abs(x - Math.floor(x)) * 0x1_0000_0000) >>> 0;
  const yLow = Math.floor(y) >>> 0;
  const yFraction = Math.floor(Math.abs(y - Math.floor(y)) * 0x1_0000_0000) >>> 0;
  let value = (Math.imul(xLow ^ xFraction, 0x9e37_79b1) ^
    Math.imul(yLow ^ yFraction, 0x85eb_ca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d) >>> 0;
  value ^= value >>> 15;
  return value >>> 0;
}

function findBubbleInsertionIndex(
  centerX: readonly number[],
  centerY: readonly number[],
  x: number,
  y: number,
): number {
  let low = 0;
  let high = centerX.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const middleX = centerX[middle] ?? 0;
    const middleY = centerY[middle] ?? 0;
    if (middleX < x || (middleX === x && middleY < y)) low = middle + 1;
    else high = middle;
  }
  return low;
}

function materializeBubbleLod(
  columns: Pick<FastScatterPointColumns, 'sourceIndex' | 'x' | 'xOrder'>,
  yValues: ArrayLike<number>,
  plotId: string,
  yKey: string,
  yRange: { min: number; max: number },
  scanRange: { start: number; end: number },
  selected: ReadonlySet<number>,
  hoverSourceIndex: number | null,
  summary: BubbleScanSummary,
  maxAggregates: number,
): FastScatterBubbleSubplotAggregation {
  const budget = Math.max(1, Math.floor(maxAggregates));
  const reserveLargest = summary.totalAggregateCount > budget && summary.maxOrdinal >= 0;
  const regularBudget = Math.max(1, budget - (reserveLargest ? 1 : 0));
  const stride = Math.max(1, Math.ceil(summary.totalAggregateCount / regularBudget));
  const centerX: number[] = [];
  const centerY: number[] = [];
  const counts: number[] = [];
  const hovered: number[] = [];
  const selectedCounts: number[] = [];
  const membershipCounts: number[] = [];
  const membershipOffsets: number[] = [];
  const sourceIndexValues: number[] = [];
  let ordinal = 0;
  let singletonCount = 0;

  visitBubbleGroups(
    columns,
    yValues,
    yRange,
    scanRange,
    selected,
    hoverSourceIndex,
    true,
    (x, group) => {
      const keepLargest = ordinal === summary.maxOrdinal;
      const keepRegular = ordinal % stride === 0 && centerX.length < regularBudget;
      if (keepLargest || keepRegular) {
        centerX.push(x);
        centerY.push(group.y);
        counts.push(group.count);
        hovered.push(group.hovered ? 1 : 0);
        selectedCounts.push(group.selectedCount);
        const membership = group.sourceIndices ?? (
          group.singleSourceIndex === undefined ? [] : [group.singleSourceIndex]
        );
        membership.sort((left, right) => left - right);
        membershipOffsets.push(sourceIndexValues.length);
        membershipCounts.push(membership.length);
        for (const sourceIndex of membership) sourceIndexValues.push(sourceIndex);
        if (group.count === 1) singletonCount += 1;
      }
      ordinal += 1;
    },
  );

  return finalizeBubbleLod(
    plotId,
    yKey,
    summary.totalAggregateCount,
    singletonCount,
    centerX,
    centerY,
    counts,
    hovered,
    selectedCounts,
    membershipOffsets,
    membershipCounts,
    sourceIndexValues,
  );
}

function finalizeBubbleLod(
  plotId: string,
  yKey: string,
  totalAggregateCount: number,
  singletonCount: number,
  centerX: readonly number[],
  centerY: readonly number[],
  counts: readonly number[],
  hovered: readonly number[],
  selectedCounts: readonly number[],
  membershipOffsets: readonly number[],
  membershipCounts: readonly number[],
  sourceIndexValues: readonly number[],
): FastScatterBubbleSubplotAggregation {
  const aggregateCount = centerX.length;
  const representativeColor = new Uint32Array(aggregateCount);
  representativeColor.fill(0xffff_ffff);
  return {
    aggregateCount,
    centerX: Float64Array.from(centerX),
    centerY: Float64Array.from(centerY),
    counts: Uint32Array.from(counts),
    hovered: Uint8Array.from(hovered),
    membershipCounts: Uint32Array.from(membershipCounts),
    membershipOffsets: Uint32Array.from(membershipOffsets),
    plotId,
    representativeColor,
    selectedCounts: Uint32Array.from(selectedCounts),
    singletonCount,
    sourceIndices: Uint32Array.from(sourceIndexValues),
    totalAggregateCount,
    yKey,
  };
}

function scanBubbleGroups(
  columns: Pick<FastScatterPointColumns, 'sourceIndex' | 'x' | 'xOrder'>,
  yValues: ArrayLike<number>,
  yRange: { min: number; max: number },
  scanRange: { start: number; end: number },
  selected: ReadonlySet<number>,
  hoverSourceIndex: number | null,
  collectMembership: boolean,
): BubbleScanSummary {
  let totalAggregateCount = 0;
  let maxCount = 0;
  let maxOrdinal = -1;
  visitBubbleGroups(
    columns,
    yValues,
    yRange,
    scanRange,
    selected,
    hoverSourceIndex,
    collectMembership,
    (_x, group) => {
      if (group.count > maxCount) {
        maxCount = group.count;
        maxOrdinal = totalAggregateCount;
      }
      totalAggregateCount += 1;
    },
  );
  return { maxCount, maxOrdinal, totalAggregateCount };
}

function visitBubbleGroups(
  columns: Pick<FastScatterPointColumns, 'sourceIndex' | 'x' | 'xOrder'>,
  yValues: ArrayLike<number>,
  yRangeInput: { min: number; max: number },
  scanRange: { start: number; end: number },
  selected: ReadonlySet<number>,
  hoverSourceIndex: number | null,
  collectMembership: boolean,
  visitor: (x: number, group: BubbleGroup) => void,
): void {
  const readX = createXValueReader(columns.x);
  const yMin = Math.min(yRangeInput.min, yRangeInput.max);
  const yMax = Math.max(yRangeInput.min, yRangeInput.max);
  const singletonGroup: BubbleGroup = {
    count: 1,
    hovered: false,
    selectedCount: 0,
    y: 0,
  };
  let sortedIndex = scanRange.start;
  while (sortedIndex < scanRange.end) {
    const firstPointIndex = pointIndexAt(columns, sortedIndex);
    const x = readX(firstPointIndex);
    if (!Number.isFinite(x)) {
      sortedIndex += 1;
      continue;
    }
    let runEnd = sortedIndex + 1;
    while (runEnd < scanRange.end) {
      const pointIndex = pointIndexAt(columns, runEnd);
      if (!Object.is(readX(pointIndex), x)) break;
      runEnd += 1;
    }
    if (runEnd === sortedIndex + 1) {
      const y = yValues[firstPointIndex];
      if (Number.isFinite(y) && y >= yMin && y <= yMax) {
        const sourceIndex = columns.sourceIndex?.[firstPointIndex] ?? firstPointIndex;
        singletonGroup.hovered = sourceIndex === hoverSourceIndex;
        singletonGroup.selectedCount = selected.has(sourceIndex) ? 1 : 0;
        singletonGroup.singleSourceIndex = sourceIndex;
        singletonGroup.y = y;
        visitor(x, singletonGroup);
      }
      sortedIndex = runEnd;
      continue;
    }
    const groups = new Map<number, BubbleGroup>();
    for (let runIndex = sortedIndex; runIndex < runEnd; runIndex += 1) {
      const pointIndex = pointIndexAt(columns, runIndex);
      const y = yValues[pointIndex];
      if (!Number.isFinite(y) || y < yMin || y > yMax) continue;
      const sourceIndex = columns.sourceIndex?.[pointIndex] ?? pointIndex;
      let group = groups.get(y);
      if (group === undefined) {
        group = { count: 0, hovered: false, selectedCount: 0, y };
        if (collectMembership) group.sourceIndices = [];
        groups.set(y, group);
      }
      group.count += 1;
      group.selectedCount += selected.has(sourceIndex) ? 1 : 0;
      group.hovered ||= sourceIndex === hoverSourceIndex;
      group.sourceIndices?.push(sourceIndex);
    }
    const orderedGroups = [...groups.values()].sort((left, right) => left.y - right.y);
    for (const group of orderedGroups) visitor(x, group);
    sortedIndex = runEnd;
  }
}

function resolveScanRange(
  columns: Pick<FastScatterPointColumns, 'x' | 'xOrder'>,
  rangeInput: { min: number; max: number },
): { start: number; end: number } {
  const min = Math.min(rangeInput.min, rangeInput.max);
  const max = Math.max(rangeInput.min, rangeInput.max);
  const order = columns.xOrder;
  if (order === undefined && isNondecreasing(columns.x)) {
    return { start: lowerBound(columns.x, min), end: upperBound(columns.x, max) };
  }
  if (order !== undefined) {
    return {
      start: lowerBoundOrdered(columns.x, order, min),
      end: upperBoundOrdered(columns.x, order, max),
    };
  }
  return { start: 0, end: columns.x.length };
}

function pointIndexAt(
  columns: Pick<FastScatterPointColumns, 'xOrder'>,
  sortedIndex: number,
): number {
  return columns.xOrder?.[sortedIndex] ?? sortedIndex;
}

function lowerBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[middle] ?? Number.POSITIVE_INFINITY) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[middle] ?? Number.POSITIVE_INFINITY) <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function lowerBoundOrdered(
  values: ArrayLike<number>,
  order: Uint32Array,
  target: number,
): number {
  let low = 0;
  let high = order.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[order[middle] ?? 0] ?? Number.POSITIVE_INFINITY) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBoundOrdered(
  values: ArrayLike<number>,
  order: Uint32Array,
  target: number,
): number {
  let low = 0;
  let high = order.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[order[middle] ?? 0] ?? Number.POSITIVE_INFINITY) <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function isNondecreasing(values: ArrayLike<number>): boolean {
  if (isGeneratedOverlapIndex(values)) return true;
  let previous = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (Number.isFinite(value) && value < previous) return false;
    if (Number.isFinite(value)) previous = value;
  }
  return true;
}

function createXValueReader(values: ArrayLike<number>): (index: number) => number {
  if (isGeneratedOverlapIndex(values)) {
    return (index) => {
      const blockStart = Math.floor(index / 24) * 24;
      const offset = index - blockStart;
      if (offset >= 2 && offset < 5) return blockStart + 2;
      if (offset >= 14 && offset < 16) return blockStart + 14;
      return index;
    };
  }
  return (index) => values[index] ?? Number.NaN;
}

function isGeneratedOverlapIndex(values: ArrayLike<number>): boolean {
  return (values as ArrayLike<number> & { generatedOverlapIndex?: boolean })
    .generatedOverlapIndex === true;
}

function normalizeSourceIndex(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function createEmptySubplot(plotId: string, yKey: string): FastScatterBubbleSubplotAggregation {
  return {
    aggregateCount: 0,
    centerX: new Float64Array(0),
    centerY: new Float64Array(0),
    counts: new Uint32Array(0),
    hovered: new Uint8Array(0),
    membershipCounts: new Uint32Array(0),
    membershipOffsets: new Uint32Array(0),
    plotId,
    representativeColor: new Uint32Array(0),
    selectedCounts: new Uint32Array(0),
    singletonCount: 0,
    sourceIndices: new Uint32Array(0),
    totalAggregateCount: 0,
    yKey,
  };
}
