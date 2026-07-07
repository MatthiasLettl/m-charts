import type {
  FastScatterAggregationRequest,
  FastScatterAggregationSet,
  FastScatterAggregationSubplotRequest,
  FastScatterBubbleAggregationRequest,
  FastScatterBubbleAggregationSet,
  FastScatterBubbleSubplotAggregation,
  FastScatterColorArray,
  FastScatterHeatmapAggregationRequest,
  FastScatterHeatmapAggregationSet,
  FastScatterHeatmapCellLocation,
  FastScatterHeatmapSubplotAggregation,
  FastScatterPointColumns,
  FastScatterRange,
} from './types.js';

const DEFAULT_PACKED_COLOR = 0xffffffff;

export interface FastScatterAggregationMembershipSpan {
  readonly count: number;
  readonly maxSourceIndex: number | null;
  readonly minSourceIndex: number | null;
  readonly offset: number;
}

export interface FastScatterAggregateAxisRange {
  readonly center: number;
  readonly max: number;
  readonly min: number;
}

export interface FastScatterBubbleAggregateAxisBounds {
  readonly x: FastScatterAggregateAxisRange;
  readonly y: FastScatterAggregateAxisRange;
}

export interface FastScatterHeatmapCellAxisBounds {
  readonly cellIndex: number;
  readonly x: FastScatterAggregateAxisRange;
  readonly xBin: number;
  readonly y: FastScatterAggregateAxisRange;
  readonly yBin: number;
}

export function buildFastScatterAggregation(
  columns: Pick<
    FastScatterPointColumns,
    'color' | 'colorFormat' | 'sourceIndex' | 'x' | 'xOrder' | 'y'
  >,
  request: FastScatterAggregationRequest,
): FastScatterAggregationSet {
  return request.mode === 'bubble'
    ? buildFastScatterBubbleAggregation(columns, request)
    : buildFastScatterHeatmapAggregation(columns, request);
}

export function buildFastScatterBubbleAggregation(
  columns: Pick<
    FastScatterPointColumns,
    'color' | 'colorFormat' | 'sourceIndex' | 'x' | 'xOrder' | 'y'
  >,
  request: FastScatterBubbleAggregationRequest,
): FastScatterBubbleAggregationSet {
  const buildStartedAt = performance.now();
  const selection = createSelectedSourceIndexLookup(request.selectedSourceIndices);
  const hoverSourceIndex = normalizeOptionalSourceIndex(request.hoverSourceIndex);
  const xRange = normalizeRange(request.xRange);
  const subplots = request.subplots.map((subplot) =>
    buildBubbleSubplotAggregation(columns, subplot, xRange, selection, hoverSourceIndex),
  );
  let totalAggregateCount = 0;

  for (const subplot of subplots) {
    totalAggregateCount += subplot.totalAggregateCount;
  }

  const result: FastScatterBubbleAggregationSet = {
    kind: 'bubble',
    metrics: {
      aggregateBuildMs: 0,
      resultBytes: 0,
    },
    pointCount: columns.x.length,
    subplots,
    totalAggregateCount,
  };

  result.metrics.resultBytes = getFastScatterAggregationByteLength(result);
  result.metrics.aggregateBuildMs = performance.now() - buildStartedAt;

  return result;
}

export function buildFastScatterHeatmapAggregation(
  columns: Pick<
    FastScatterPointColumns,
    'sourceIndex' | 'x' | 'xOrder' | 'y'
  >,
  request: FastScatterHeatmapAggregationRequest,
): FastScatterHeatmapAggregationSet {
  const buildStartedAt = performance.now();
  const selection = createSelectedSourceIndexLookup(request.selectedSourceIndices);
  const hoverSourceIndex = normalizeOptionalSourceIndex(request.hoverSourceIndex);
  const xRange = normalizeRange(request.xRange);
  const heatBinPx = normalizeHeatBinPx(request.heatBinPx);
  const subplots = request.subplots.map((subplot) =>
    buildHeatmapSubplotAggregation(
      columns,
      subplot,
      xRange,
      heatBinPx,
      selection,
      hoverSourceIndex,
    ),
  );
  let totalCellCount = 0;
  let totalPopulatedCellCount = 0;

  for (const subplot of subplots) {
    totalCellCount += subplot.cellCount;
    totalPopulatedCellCount += subplot.populatedCellCount;
  }

  const result: FastScatterHeatmapAggregationSet = {
    kind: 'heatmap',
    metrics: {
      aggregateBuildMs: 0,
      resultBytes: 0,
    },
    pointCount: columns.x.length,
    subplots,
    totalCellCount,
    totalPopulatedCellCount,
  };

  result.metrics.resultBytes = getFastScatterAggregationByteLength(result);
  result.metrics.aggregateBuildMs = performance.now() - buildStartedAt;

  return result;
}

export function materializeFastScatterBubbleSourceIndices(
  aggregation: FastScatterBubbleSubplotAggregation,
  aggregateIndex: number,
): Uint32Array {
  const membership = getFastScatterBubbleAggregateMembershipSpan(
    aggregation,
    aggregateIndex,
  );

  if (membership === null) {
    return new Uint32Array(0);
  }

  return aggregation.sourceIndices.subarray(
    membership.offset,
    membership.offset + membership.count,
  );
}

export function materializeFastScatterHeatmapCellSourceIndices(
  aggregation: FastScatterHeatmapSubplotAggregation,
  cellIndex: number,
): Uint32Array {
  const membership = getFastScatterHeatmapCellMembershipSpan(aggregation, cellIndex);

  if (membership === null) {
    return new Uint32Array(0);
  }

  return aggregation.sourceIndices.subarray(
    membership.offset,
    membership.offset + membership.count,
  );
}

export function getFastScatterBubbleAggregateMembershipSpan(
  aggregation: FastScatterBubbleSubplotAggregation,
  aggregateIndex: number,
): FastScatterAggregationMembershipSpan | null {
  if (aggregateIndex < 0 || aggregateIndex >= aggregation.aggregateCount) {
    return null;
  }

  return readAggregationMembershipSpan(
    aggregation.sourceIndices,
    aggregation.membershipOffsets,
    aggregation.membershipCounts,
    aggregateIndex,
  );
}

export function getFastScatterHeatmapCellMembershipSpan(
  aggregation: FastScatterHeatmapSubplotAggregation,
  cellIndex: number,
): FastScatterAggregationMembershipSpan | null {
  if (cellIndex < 0 || cellIndex >= aggregation.cellCount) {
    return null;
  }

  return readAggregationMembershipSpan(
    aggregation.sourceIndices,
    aggregation.membershipOffsets,
    aggregation.membershipCounts,
    cellIndex,
  );
}

export function getFastScatterBubbleAggregateAxisBounds(
  aggregation: FastScatterBubbleSubplotAggregation,
  aggregateIndex: number,
): FastScatterBubbleAggregateAxisBounds | null {
  if (aggregateIndex < 0 || aggregateIndex >= aggregation.aggregateCount) {
    return null;
  }

  const centerX = aggregation.centerX[aggregateIndex];
  const centerY = aggregation.centerY[aggregateIndex];

  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
    return null;
  }

  return {
    x: {
      center: centerX,
      max: centerX,
      min: centerX,
    },
    y: {
      center: centerY,
      max: centerY,
      min: centerY,
    },
  };
}

export function getFastScatterHeatmapCellAxisBounds(
  aggregation: FastScatterHeatmapSubplotAggregation,
  location: FastScatterHeatmapCellLocation | number,
): FastScatterHeatmapCellAxisBounds | null {
  const cellLocation =
    typeof location === 'number'
      ? createHeatmapCellLocationFromCellIndex(aggregation, location)
      : location;

  if (cellLocation === null) {
    return null;
  }

  const x = getHeatmapBinAxisRange(
    aggregation.xRange,
    aggregation.xBinCount,
    cellLocation.xBin,
  );
  const y = getHeatmapBinAxisRange(
    aggregation.yRange,
    aggregation.yBinCount,
    cellLocation.yBin,
  );

  if (x === null || y === null) {
    return null;
  }

  return {
    cellIndex: cellLocation.cellIndex,
    x,
    xBin: cellLocation.xBin,
    y,
    yBin: cellLocation.yBin,
  };
}

export function locateFastScatterHeatmapCellAtAxisValue(
  aggregation: FastScatterHeatmapSubplotAggregation,
  xValue: number,
  yValue: number,
): FastScatterHeatmapCellLocation | null {
  if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) {
    return null;
  }

  const xRange = normalizeRange(aggregation.xRange);
  const yRange = normalizeRange(aggregation.yRange);

  if (
    xValue < xRange.min ||
    xValue > xRange.max ||
    yValue < yRange.min ||
    yValue > yRange.max
  ) {
    return null;
  }

  return createHeatmapCellLocation(
    getBinIndex(xValue, xRange, aggregation.xBinCount),
    getBinIndex(yValue, yRange, aggregation.yBinCount),
    aggregation.xBinCount,
  );
}

export function locateFastScatterHeatmapCellAtPixel(
  aggregation: FastScatterHeatmapSubplotAggregation,
  plotPixelX: number,
  plotPixelY: number,
): FastScatterHeatmapCellLocation | null {
  if (!Number.isFinite(plotPixelX) || !Number.isFinite(plotPixelY)) {
    return null;
  }

  if (
    plotPixelX < 0 ||
    plotPixelX > aggregation.plotWidthPx ||
    plotPixelY < 0 ||
    plotPixelY > aggregation.plotHeightPx
  ) {
    return null;
  }

  const xBin = getPixelBinIndex(
    plotPixelX,
    aggregation.plotWidthPx,
    aggregation.xBinCount,
  );
  const yBin = aggregation.yBinCount - 1 - getPixelBinIndex(
    plotPixelY,
    aggregation.plotHeightPx,
    aggregation.yBinCount,
  );

  return createHeatmapCellLocation(xBin, yBin, aggregation.xBinCount);
}

export function getFastScatterAggregationByteLength(
  aggregation: FastScatterAggregationSet,
): number {
  if (aggregation.kind === 'bubble') {
    let total = 0;

    for (const subplot of aggregation.subplots) {
      total +=
        subplot.centerX.byteLength +
        subplot.centerY.byteLength +
        subplot.counts.byteLength +
        subplot.hovered.byteLength +
        subplot.membershipCounts.byteLength +
        subplot.membershipOffsets.byteLength +
        subplot.representativeColor.byteLength +
        subplot.selectedCounts.byteLength +
        subplot.sourceIndices.byteLength;
    }

    return total;
  }

  let total = 0;

  for (const subplot of aggregation.subplots) {
    total +=
      subplot.counts.byteLength +
      subplot.hovered.byteLength +
      subplot.membershipCounts.byteLength +
      subplot.membershipOffsets.byteLength +
      subplot.selectedCounts.byteLength +
      subplot.sourceIndices.byteLength;
  }

  return total;
}

export function collectFastScatterAggregationTransferables(
  aggregation: FastScatterAggregationSet,
): Transferable[] {
  const buffers = new Set<ArrayBuffer>();

  if (aggregation.kind === 'bubble') {
    for (const subplot of aggregation.subplots) {
      maybeAddTransferableBuffer(buffers, subplot.centerX.buffer);
      maybeAddTransferableBuffer(buffers, subplot.centerY.buffer);
      maybeAddTransferableBuffer(buffers, subplot.counts.buffer);
      maybeAddTransferableBuffer(buffers, subplot.hovered.buffer);
      maybeAddTransferableBuffer(buffers, subplot.membershipCounts.buffer);
      maybeAddTransferableBuffer(buffers, subplot.membershipOffsets.buffer);
      maybeAddTransferableBuffer(buffers, subplot.representativeColor.buffer);
      maybeAddTransferableBuffer(buffers, subplot.selectedCounts.buffer);
      maybeAddTransferableBuffer(buffers, subplot.sourceIndices.buffer);
    }
  } else {
    for (const subplot of aggregation.subplots) {
      maybeAddTransferableBuffer(buffers, subplot.counts.buffer);
      maybeAddTransferableBuffer(buffers, subplot.hovered.buffer);
      maybeAddTransferableBuffer(buffers, subplot.membershipCounts.buffer);
      maybeAddTransferableBuffer(buffers, subplot.membershipOffsets.buffer);
      maybeAddTransferableBuffer(buffers, subplot.selectedCounts.buffer);
      maybeAddTransferableBuffer(buffers, subplot.sourceIndices.buffer);
    }
  }

  return Array.from(buffers);
}

function buildBubbleSubplotAggregation(
  columns: Pick<
    FastScatterPointColumns,
    'color' | 'colorFormat' | 'sourceIndex' | 'x' | 'xOrder' | 'y'
  >,
  subplot: FastScatterAggregationSubplotRequest,
  xRange: FastScatterRange,
  selection: ReadonlySet<number>,
  hoverSourceIndex: number | null,
): FastScatterBubbleSubplotAggregation {
  const yColumn = columns.y[subplot.yKey];

  if (yColumn === undefined) {
    return createEmptyBubbleAggregation(subplot);
  }

  const scanRange = getXScanRange(columns, xRange);
  const yRange = normalizeRange(subplot.yRange);
  const counts: number[] = [];
  const hovered: number[] = [];
  const membershipByAggregate = new Map<number, number[]>();
  const representativeColor: number[] = [];
  const representativeSourceIndex: number[] = [];
  const selectedCounts: number[] = [];
  let singletonCount = 0;
  const xValues: number[] = [];
  const yValues: number[] = [];

  let sortedIndex = scanRange.startIndex;
  while (sortedIndex < scanRange.endIndex) {
    const runPointIndex = getPointIndexAtXOrder(columns, sortedIndex);
    const runXValue = columns.x[runPointIndex];

    if (!Number.isFinite(runXValue)) {
      sortedIndex += 1;
      continue;
    }

    let runEndIndex = sortedIndex + 1;
    while (runEndIndex < scanRange.endIndex) {
      const nextPointIndex = getPointIndexAtXOrder(columns, runEndIndex);
      const nextXValue = columns.x[nextPointIndex];
      if (!Object.is(nextXValue, runXValue)) {
        break;
      }
      runEndIndex += 1;
    }

    const aggregateIndexByYValue = new Map<number, number>();

    for (let runIndex = sortedIndex; runIndex < runEndIndex; runIndex += 1) {
      const pointIndex = getPointIndexAtXOrder(columns, runIndex);
      const yValue = yColumn[pointIndex];

      if (
        !Number.isFinite(yValue) ||
        yValue < yRange.min ||
        yValue > yRange.max
      ) {
        continue;
      }

      const sourceIndex = columns.sourceIndex?.[pointIndex] ?? pointIndex;
      const aggregateIndex = aggregateIndexByYValue.get(yValue);

      if (aggregateIndex === undefined) {
        const nextAggregateIndex = counts.length;
        aggregateIndexByYValue.set(yValue, nextAggregateIndex);
        counts.push(1);
        hovered.push(
          hoverSourceIndex !== null && sourceIndex === hoverSourceIndex ? 1 : 0,
        );
        membershipByAggregate.set(nextAggregateIndex, [sourceIndex]);
        representativeColor.push(
          readPackedColorAtPoint(columns.color, columns.colorFormat, pointIndex),
        );
        representativeSourceIndex.push(sourceIndex);
        selectedCounts.push(selection.has(sourceIndex) ? 1 : 0);
        xValues.push(runXValue);
        yValues.push(yValue);
        continue;
      }

      counts[aggregateIndex] = (counts[aggregateIndex] ?? 0) + 1;
      membershipByAggregate.get(aggregateIndex)?.push(sourceIndex);

      if (selection.has(sourceIndex)) {
        selectedCounts[aggregateIndex] = (selectedCounts[aggregateIndex] ?? 0) + 1;
      }

      if (hoverSourceIndex !== null && sourceIndex === hoverSourceIndex) {
        hovered[aggregateIndex] = 1;
      }

      if (sourceIndex < representativeSourceIndex[aggregateIndex]) {
        representativeSourceIndex[aggregateIndex] = sourceIndex;
        representativeColor[aggregateIndex] = readPackedColorAtPoint(
          columns.color,
          columns.colorFormat,
          pointIndex,
        );
      }
    }

    sortedIndex = runEndIndex;
  }

  for (const count of counts) {
    if (count === 1) {
      singletonCount += 1;
    }
  }

  const totalAggregateCount = counts.length;
  const order = createBubbleAggregateSortOrder(
    counts.map((_, index) => index),
    xValues,
    yValues,
  );

  return finalizeBubbleAggregation(
    subplot,
    counts,
    totalAggregateCount,
    singletonCount,
    hovered,
    membershipByAggregate,
    representativeColor,
    selectedCounts,
    xValues,
    yValues,
    order,
  );
}

function buildHeatmapSubplotAggregation(
  columns: Pick<FastScatterPointColumns, 'sourceIndex' | 'x' | 'xOrder' | 'y'>,
  subplot: FastScatterAggregationSubplotRequest,
  xRange: FastScatterRange,
  heatBinPx: number,
  selection: ReadonlySet<number>,
  hoverSourceIndex: number | null,
): FastScatterHeatmapSubplotAggregation {
  const yRange = normalizeRange(subplot.yRange);
  const xBinCount = Math.max(1, Math.ceil(normalizePlotPixelSize(subplot.plotWidthPx) / heatBinPx));
  const yBinCount = Math.max(1, Math.ceil(normalizePlotPixelSize(subplot.plotHeightPx) / heatBinPx));
  const cellCount = xBinCount * yBinCount;
  const counts = new Uint32Array(cellCount);
  const hovered = new Uint8Array(cellCount);
  const membershipByCell = Array.from({ length: cellCount }, () => [] as number[]);
  const selectedCounts = new Uint32Array(cellCount);
  const yColumn = columns.y[subplot.yKey];

  if (yColumn !== undefined) {
    const scanRange = getXScanRange(columns, xRange);

    for (
      let sortedIndex = scanRange.startIndex;
      sortedIndex < scanRange.endIndex;
      sortedIndex += 1
    ) {
      const pointIndex = getPointIndexAtXOrder(columns, sortedIndex);
      const xValue = columns.x[pointIndex];
      const yValue = yColumn[pointIndex];

      if (
        !Number.isFinite(xValue) ||
        !Number.isFinite(yValue) ||
        yValue < yRange.min ||
        yValue > yRange.max
      ) {
        continue;
      }

      const cellIndex =
        getBinIndex(yValue, yRange, yBinCount) * xBinCount +
        getBinIndex(xValue, xRange, xBinCount);
      const sourceIndex = columns.sourceIndex?.[pointIndex] ?? pointIndex;

      counts[cellIndex] += 1;
      membershipByCell[cellIndex]?.push(sourceIndex);

      if (selection.has(sourceIndex)) {
        selectedCounts[cellIndex] += 1;
      }

      if (hoverSourceIndex !== null && sourceIndex === hoverSourceIndex) {
        hovered[cellIndex] = 1;
      }
    }
  }

  const finalizedMembership = flattenMembershipLists(membershipByCell);

  return {
    cellCount,
    counts,
    heatBinPx,
    hovered,
    membershipCounts: finalizedMembership.counts,
    membershipOffsets: finalizedMembership.offsets,
    plotHeightPx: normalizePlotPixelSize(subplot.plotHeightPx),
    plotId: subplot.plotId,
    plotWidthPx: normalizePlotPixelSize(subplot.plotWidthPx),
    populatedCellCount: finalizedMembership.populatedCount,
    selectedCounts,
    sourceIndices: finalizedMembership.sourceIndices,
    xBinCount,
    xBinSize: getBinSize(xRange, xBinCount),
    xRange,
    yBinCount,
    yBinSize: getBinSize(yRange, yBinCount),
    yKey: subplot.yKey,
    yRange,
  };
}

function finalizeBubbleAggregation(
  subplot: FastScatterAggregationSubplotRequest,
  counts: readonly number[],
  totalAggregateCount: number,
  singletonCount: number,
  hovered: readonly number[],
  membershipByAggregate: ReadonlyMap<number, readonly number[]>,
  representativeColor: readonly number[],
  selectedCounts: readonly number[],
  xValues: readonly number[],
  yValues: readonly number[],
  order: readonly number[],
): FastScatterBubbleSubplotAggregation {
  const aggregateCount = order.length;
  const centerX = new Float64Array(aggregateCount);
  const centerY = new Float64Array(aggregateCount);
  const finalizedCounts = new Uint32Array(aggregateCount);
  const finalizedHovered = new Uint8Array(aggregateCount);
  const finalizedRepresentativeColor = new Uint32Array(aggregateCount);
  const finalizedSelectedCounts = new Uint32Array(aggregateCount);
  const orderedMembershipLists = new Array<number[]>(aggregateCount);

  for (let outputIndex = 0; outputIndex < order.length; outputIndex += 1) {
    const sourceIndex = order[outputIndex] ?? outputIndex;
    centerX[outputIndex] = xValues[sourceIndex] ?? Number.NaN;
    centerY[outputIndex] = yValues[sourceIndex] ?? Number.NaN;
    finalizedCounts[outputIndex] = counts[sourceIndex] ?? 0;
    finalizedHovered[outputIndex] = hovered[sourceIndex] ?? 0;
    finalizedRepresentativeColor[outputIndex] =
      representativeColor[sourceIndex] ?? DEFAULT_PACKED_COLOR;
    finalizedSelectedCounts[outputIndex] = selectedCounts[sourceIndex] ?? 0;
    orderedMembershipLists[outputIndex] = Array.from(
      membershipByAggregate.get(sourceIndex) ?? [],
    );
  }

  const finalizedMembership = flattenMembershipLists(orderedMembershipLists);

  return {
    aggregateCount,
    centerX,
    centerY,
    counts: finalizedCounts,
    hovered: finalizedHovered,
    membershipCounts: finalizedMembership.counts,
    membershipOffsets: finalizedMembership.offsets,
    plotId: subplot.plotId,
    representativeColor: finalizedRepresentativeColor,
    selectedCounts: finalizedSelectedCounts,
    singletonCount,
    sourceIndices: finalizedMembership.sourceIndices,
    totalAggregateCount,
    yKey: subplot.yKey,
  };
}

function flattenMembershipLists(
  membershipLists: readonly number[][],
): {
  counts: Uint32Array;
  offsets: Uint32Array;
  populatedCount: number;
  sourceIndices: Uint32Array;
} {
  const offsets = new Uint32Array(membershipLists.length);
  const counts = new Uint32Array(membershipLists.length);
  let totalSourceIndices = 0;
  let populatedCount = 0;

  for (let index = 0; index < membershipLists.length; index += 1) {
    const sourceIndices = membershipLists[index] ?? [];
    sourceIndices.sort((left, right) => left - right);
    counts[index] = sourceIndices.length;
    offsets[index] = totalSourceIndices;
    totalSourceIndices += sourceIndices.length;
    if (sourceIndices.length > 0) {
      populatedCount += 1;
    }
  }

  const flattened = new Uint32Array(totalSourceIndices);
  let writeOffset = 0;

  for (const sourceIndices of membershipLists) {
    for (let index = 0; index < sourceIndices.length; index += 1) {
      flattened[writeOffset] = normalizeSourceIndex(sourceIndices[index], writeOffset);
      writeOffset += 1;
    }
  }

  return {
    counts,
    offsets,
    populatedCount,
    sourceIndices: flattened,
  };
}

function readAggregationMembershipSpan(
  sourceIndices: Uint32Array,
  offsets: Uint32Array,
  counts: Uint32Array,
  index: number,
): FastScatterAggregationMembershipSpan {
  const offset = offsets[index] ?? 0;
  const count = counts[index] ?? 0;

  return {
    count,
    maxSourceIndex: count === 0 ? null : (sourceIndices[offset + count - 1] ?? null),
    minSourceIndex: count === 0 ? null : (sourceIndices[offset] ?? null),
    offset,
  };
}

function createBubbleAggregateSortOrder(
  indices: readonly number[],
  xValues: readonly number[],
  yValues: readonly number[],
): number[] {
  const order = [...indices];

  order.sort((left, right) => {
    const xDelta = (xValues[left] ?? 0) - (xValues[right] ?? 0);
    if (xDelta !== 0) {
      return xDelta;
    }

    return (yValues[left] ?? 0) - (yValues[right] ?? 0);
  });

  return order;
}

function createEmptyBubbleAggregation(
  subplot: FastScatterAggregationSubplotRequest,
): FastScatterBubbleSubplotAggregation {
  return {
    aggregateCount: 0,
    centerX: new Float64Array(0),
    centerY: new Float64Array(0),
    counts: new Uint32Array(0),
    hovered: new Uint8Array(0),
    membershipCounts: new Uint32Array(0),
    membershipOffsets: new Uint32Array(0),
    plotId: subplot.plotId,
    representativeColor: new Uint32Array(0),
    selectedCounts: new Uint32Array(0),
    singletonCount: 0,
    sourceIndices: new Uint32Array(0),
    totalAggregateCount: 0,
    yKey: subplot.yKey,
  };
}

function createHeatmapCellLocation(
  xBin: number,
  yBin: number,
  xBinCount: number,
): FastScatterHeatmapCellLocation {
  return {
    cellIndex: yBin * xBinCount + xBin,
    xBin,
    yBin,
  };
}

function createHeatmapCellLocationFromCellIndex(
  aggregation: FastScatterHeatmapSubplotAggregation,
  cellIndex: number,
): FastScatterHeatmapCellLocation | null {
  if (cellIndex < 0 || cellIndex >= aggregation.cellCount) {
    return null;
  }

  return {
    cellIndex,
    xBin: cellIndex % aggregation.xBinCount,
    yBin: Math.floor(cellIndex / aggregation.xBinCount),
  };
}

function createSelectedSourceIndexLookup(
  sourceIndices: Uint32Array | undefined,
): ReadonlySet<number> {
  if (sourceIndices === undefined || sourceIndices.length === 0) {
    return new Set<number>();
  }

  return new Set<number>(sourceIndices);
}

function readPackedColorAtPoint(
  color: FastScatterColorArray | undefined,
  colorFormat: FastScatterPointColumns['colorFormat'],
  pointIndex: number,
): number {
  if (color === undefined) {
    return DEFAULT_PACKED_COLOR;
  }

  if (color instanceof Uint32Array) {
    if (colorFormat !== 'rgba32') {
      throw new Error('Fast scatter Uint32 color columns must use rgba32 format.');
    }

    return color[pointIndex] ?? DEFAULT_PACKED_COLOR;
  }

  if (colorFormat !== undefined && colorFormat !== 'rgba8') {
    throw new Error('Fast scatter Uint8 color columns must use rgba8 format.');
  }

  const offset = pointIndex * 4;
  const red = color[offset] ?? 255;
  const green = color[offset + 1] ?? 255;
  const blue = color[offset + 2] ?? 255;
  const alpha = color[offset + 3] ?? 255;

  return (((red << 24) | (green << 16) | (blue << 8) | alpha) >>> 0);
}

function maybeAddTransferableBuffer(
  buffers: Set<ArrayBuffer>,
  buffer: ArrayBufferLike,
): void {
  if (buffer instanceof ArrayBuffer) {
    buffers.add(buffer);
  }
}

function normalizeOptionalSourceIndex(sourceIndex: number | null | undefined): number | null {
  if (sourceIndex === null || sourceIndex === undefined) {
    return null;
  }

  return normalizeSourceIndex(sourceIndex, 0);
}

function normalizeRange(range: { readonly max: number; readonly min: number }): FastScatterRange {
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) {
    return { min: 0, max: 0 };
  }

  return range.min <= range.max
    ? { max: range.max, min: range.min }
    : { max: range.min, min: range.max };
}

function normalizeHeatBinPx(heatBinPx: number): number {
  if (!Number.isFinite(heatBinPx) || heatBinPx <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor(heatBinPx));
}

function normalizePlotPixelSize(plotPixelSize: number): number {
  if (!Number.isFinite(plotPixelSize) || plotPixelSize <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor(plotPixelSize));
}

function normalizeSourceIndex(sourceIndex: number, offset: number): number {
  if (
    !Number.isSafeInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex > 0xffffffff
  ) {
    throw new Error(
      `Scatter-fast aggregation source index at offset ${offset} must fit in Uint32.`,
    );
  }

  return sourceIndex;
}

function getBinSize(range: FastScatterRange, binCount: number): number {
  const span = range.max - range.min;

  if (!Number.isFinite(span) || span <= 0 || binCount <= 0) {
    return 0;
  }

  return span / binCount;
}

function getHeatmapBinAxisRange(
  range: FastScatterRange,
  binCount: number,
  binIndex: number,
): FastScatterAggregateAxisRange | null {
  if (binCount <= 0 || binIndex < 0 || binIndex >= binCount) {
    return null;
  }

  const normalizedRange = normalizeRange(range);
  const binSize = getBinSize(normalizedRange, binCount);

  if (!Number.isFinite(binSize) || binSize <= 0) {
    return {
      center: normalizedRange.min,
      max: normalizedRange.min,
      min: normalizedRange.min,
    };
  }

  const min = normalizedRange.min + binSize * binIndex;
  const max =
    binIndex === binCount - 1 ? normalizedRange.max : normalizedRange.min + binSize * (binIndex + 1);

  return {
    center: (min + max) / 2,
    max,
    min,
  };
}

function getBinIndex(value: number, range: FastScatterRange, binCount: number): number {
  if (binCount <= 1) {
    return 0;
  }

  const span = range.max - range.min;

  if (!Number.isFinite(span) || span <= 0) {
    return 0;
  }

  if (value <= range.min) {
    return 0;
  }

  if (value >= range.max) {
    return binCount - 1;
  }

  return Math.min(binCount - 1, Math.max(0, Math.floor(((value - range.min) / span) * binCount)));
}

function getPixelBinIndex(pixel: number, sizePx: number, binCount: number): number {
  if (binCount <= 1 || sizePx <= 0) {
    return 0;
  }

  if (pixel <= 0) {
    return 0;
  }

  if (pixel >= sizePx) {
    return binCount - 1;
  }

  return Math.min(binCount - 1, Math.max(0, Math.floor((pixel / sizePx) * binCount)));
}

function lowerBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if ((values[mid] ?? Number.NaN) < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function upperBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if ((values[mid] ?? Number.NaN) <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function getPointIndexAtXOrder(
  columns: Pick<FastScatterPointColumns, 'xOrder'>,
  sortedIndex: number,
): number {
  return columns.xOrder?.[sortedIndex] ?? sortedIndex;
}

function getXValueAtOrder(
  columns: Pick<FastScatterPointColumns, 'x' | 'xOrder'>,
  sortedIndex: number,
): number {
  return columns.x[getPointIndexAtXOrder(columns, sortedIndex)] ?? Number.NaN;
}

function getXScanRange(
  columns: Pick<FastScatterPointColumns, 'x' | 'xOrder'>,
  range: FastScatterRange,
): { endIndex: number; startIndex: number } {
  return {
    endIndex: upperBoundByX(columns, range.max),
    startIndex: lowerBoundByX(columns, range.min),
  };
}

function lowerBoundByX(
  columns: Pick<FastScatterPointColumns, 'x' | 'xOrder'>,
  target: number,
): number {
  if (columns.xOrder === undefined) {
    return lowerBound(columns.x, target);
  }

  let low = 0;
  let high = columns.xOrder.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (getXValueAtOrder(columns, mid) < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function upperBoundByX(
  columns: Pick<FastScatterPointColumns, 'x' | 'xOrder'>,
  target: number,
): number {
  if (columns.xOrder === undefined) {
    return upperBound(columns.x, target);
  }

  let low = 0;
  let high = columns.xOrder.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (getXValueAtOrder(columns, mid) <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}
