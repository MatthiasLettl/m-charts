import {
  getFastScatterBubbleAggregateMembershipSpan,
  getFastScatterHeatmapCellAxisBounds,
  getFastScatterHeatmapCellMembershipSpan,
  locateFastScatterHeatmapCellAtPixel,
  type FastScatterAggregateAxisRange,
  type FastScatterAggregationMembershipSpan,
} from './aggregation.js';
import {
  axisToPixel,
  pixelToAxis,
  type FastScatterPlotRect,
} from './transforms.js';
import { findFastScatterPlotRectAtPoint } from './zoom.js';
import type {
  FastScatterAggregationSet,
  FastScatterBubbleSubplotAggregation,
  FastScatterCanvasPoint,
  FastScatterCompactHoverIndex,
  FastScatterHeatmapSubplotAggregation,
  FastScatterHoverGridIndex,
  FastScatterHoverIndexSet,
  FastScatterPlotSpec,
  FastScatterPointColumns,
  FastScatterPointRef,
  FastScatterViewport,
} from './types.js';

export interface FastScatterNearestPointLookupInput {
  readonly columns: Pick<
    FastScatterPointColumns,
    | 'ids'
    | 'recordIdentityBySourceIndex'
    | 'sourceIndex'
    | 'tableBySourceIndex'
    | 'x'
    | 'xOrder'
    | 'y'
  >;
  readonly maxDistanceCssPx: number;
  readonly hoverIndex?: FastScatterHoverIndexSet | null;
  readonly isPointEligible?: (pointIndex: number, plotId: string) => boolean;
  readonly plotRects: readonly FastScatterPlotRect[];
  readonly pointerCssX: number;
  readonly pointerCssY: number;
  readonly spec: FastScatterPlotSpec;
  readonly viewport: FastScatterViewport;
}

export interface CreateFastScatterHoverIndexOptions {
  readonly targetPointsPerCell?: number;
  readonly xBinCount?: number;
  readonly yBinCount?: number;
  readonly yKeys?: readonly string[];
}

export interface CreateFastScatterCompactHoverIndexOptions {
  readonly blockSize?: number;
  readonly sortedX?: boolean;
  readonly yBinCount?: number;
  readonly yDomainByKey?: Readonly<Record<string, { max: number; min: number }>>;
  readonly yieldInterval?: number;
  readonly yKeys?: readonly string[];
}

const COMPACT_HOVER_INVALID_BIN = 0xff;
const OVERVIEW_REPRESENTATIVE_BLOCK_SIZE = 4_096;
const OVERVIEW_CATEGORY_LIMIT = 16;

export async function createFastScatterCompactHoverIndex(
  columns: Pick<FastScatterPointColumns, 'x' | 'xOrder' | 'y'>,
  options: CreateFastScatterCompactHoverIndexOptions = {},
): Promise<FastScatterHoverIndexSet> {
  const pointCount = columns.x.length;
  const compactByYKey: Record<string, FastScatterCompactHoverIndex> = {};
  const blockSize = clampInteger(options.blockSize ?? 256, 32, 4096);
  const requestedYBinCount = clampInteger(options.yBinCount ?? 255, 8, 255);
  const yieldInterval = Math.max(1, Math.floor(options.yieldInterval ?? 250_000));
  const xSorted = columns.xOrder === undefined && (
    options.sortedX === true ||
    await isNondecreasingFiniteAsync(columns.x, yieldInterval)
  );
  if (!xSorted) {
    return { compactByYKey, gridsByYKey: {}, pointCount };
  }

  for (const yKey of options.yKeys ?? Object.keys(columns.y)) {
    const y = columns.y[yKey];
    if (y === undefined || y.length !== pointCount) continue;
    const requestedDomain = options.yDomainByKey?.[yKey];
    const yDomain =
      requestedDomain !== undefined &&
      Number.isFinite(requestedDomain.min) &&
      Number.isFinite(requestedDomain.max) &&
      requestedDomain.max >= requestedDomain.min
        ? requestedDomain
        : await finiteDomainAsync(y, yieldInterval);
    if (yDomain === null) continue;
    const reuseIntegerBins = y instanceof Uint8Array && yDomain.min === 0 &&
      Number.isInteger(yDomain.max) && yDomain.max >= 0 && yDomain.max < 255;
    const yBinCount = reuseIntegerBins
      ? Math.max(1, Math.floor(yDomain.max) + 1)
      : requestedYBinCount;
    const occupancyWordsPerBlock = Math.ceil(yBinCount / 32);
    const yBins = reuseIntegerBins ? y : new Uint8Array(pointCount);
    if (!reuseIntegerBins) yBins.fill(COMPACT_HOVER_INVALID_BIN);
    const blockCount = Math.ceil(pointCount / blockSize);
    const blockOccupancy = new Uint32Array(blockCount * occupancyWordsPerBlock);
    const overviewIndices: number[] = [];
    const categoryFirstIndex = y instanceof Uint8Array ? new Int32Array(256) : null;
    categoryFirstIndex?.fill(-1);
    let overviewBlock = -1;
    let overviewCategoryCount = 0;
    let overviewCategoryOverflow = false;
    let overviewMinIndex = -1;
    let overviewMinValue = Number.POSITIVE_INFINITY;
    let overviewMaxIndex = -1;
    let overviewMaxValue = Number.NEGATIVE_INFINITY;
    const finishOverviewBlock = () => {
      const blockIndices: number[] = [];
      if (categoryFirstIndex !== null && !overviewCategoryOverflow) {
        for (const pointIndex of categoryFirstIndex) {
          if (pointIndex >= 0) blockIndices.push(pointIndex);
        }
      } else {
        if (overviewMinIndex >= 0) blockIndices.push(overviewMinIndex);
        if (overviewMaxIndex >= 0 && overviewMaxIndex !== overviewMinIndex) {
          blockIndices.push(overviewMaxIndex);
        }
      }
      blockIndices.sort((left, right) => left - right);
      overviewIndices.push(...blockIndices);
    };
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const value = y[pointIndex];
      if (Number.isFinite(value)) {
        const nextOverviewBlock = Math.floor(pointIndex / OVERVIEW_REPRESENTATIVE_BLOCK_SIZE);
        if (nextOverviewBlock !== overviewBlock) {
          if (overviewBlock >= 0) finishOverviewBlock();
          overviewBlock = nextOverviewBlock;
          overviewCategoryCount = 0;
          overviewCategoryOverflow = false;
          overviewMinIndex = -1;
          overviewMinValue = Number.POSITIVE_INFINITY;
          overviewMaxIndex = -1;
          overviewMaxValue = Number.NEGATIVE_INFINITY;
          categoryFirstIndex?.fill(-1);
        }
        if (value! < overviewMinValue) {
          overviewMinValue = value!;
          overviewMinIndex = pointIndex;
        }
        if (value! > overviewMaxValue) {
          overviewMaxValue = value!;
          overviewMaxIndex = pointIndex;
        }
        if (categoryFirstIndex !== null && !overviewCategoryOverflow) {
          const category = value! & 0xff;
          if (categoryFirstIndex[category] === -1) {
            categoryFirstIndex[category] = pointIndex;
            overviewCategoryCount += 1;
            overviewCategoryOverflow = overviewCategoryCount > OVERVIEW_CATEGORY_LIMIT;
          }
        }
        const yBin = reuseIntegerBins
          ? value!
          : gridBinIndex(value!, yDomain.min, yDomain.max, yBinCount);
        if (!reuseIntegerBins) yBins[pointIndex] = yBin;
        const wordIndex =
          Math.floor(pointIndex / blockSize) * occupancyWordsPerBlock + (yBin >>> 5);
        blockOccupancy[wordIndex] =
          ((blockOccupancy[wordIndex] ?? 0) | (1 << (yBin & 31))) >>> 0;
      }
      if (pointIndex > 0 && pointIndex % yieldInterval === 0) await yieldToHost();
    }
    if (overviewBlock >= 0) finishOverviewBlock();
    compactByYKey[yKey] = {
      blockOccupancy,
      blockSize,
      occupancyWordsPerBlock,
      overviewIndices: Uint32Array.from(overviewIndices),
      yBinCount,
      yBins,
      yKey,
      yMax: yDomain.max,
      yMin: yDomain.min,
    };
    await yieldToHost();
  }
  return { compactByYKey, gridsByYKey: {}, pointCount };
}

export function createFastScatterHoverIndex(
  columns: Pick<FastScatterPointColumns, 'x' | 'y'>,
  options: CreateFastScatterHoverIndexOptions = {},
): FastScatterHoverIndexSet {
  const pointCount = columns.x.length;
  const targetPointsPerCell = Math.max(1, Math.floor(options.targetPointsPerCell ?? 24));
  const defaultCellCount = Math.max(1, Math.ceil(pointCount / targetPointsPerCell));
  // Scatter plots are normally much wider than they are tall, and time-series
  // data can be concentrated into a narrow Y band. Favor fine X buckets so a
  // center-cell nearest-neighbor query remains bounded in that common case.
  const defaultXBinCount = clampInteger(defaultCellCount, 1, 2048);
  const defaultYBinCount = clampInteger(Math.ceil(defaultCellCount / defaultXBinCount), 1, 1024);
  const xBinCount = clampInteger(options.xBinCount ?? defaultXBinCount, 1, 4096);
  const yBinCount = clampInteger(options.yBinCount ?? defaultYBinCount, 1, 2048);
  const xDomain = finiteDomain(columns.x);
  const requestedYKeys = options.yKeys ?? Object.keys(columns.y);
  const gridsByYKey: Record<string, FastScatterHoverGridIndex> = {};

  if (xDomain === null || pointCount === 0) {
    return { gridsByYKey, pointCount };
  }

  for (const yKey of requestedYKeys) {
    const y = columns.y[yKey];
    const yDomain = y === undefined ? null : finiteDomain(y);
    if (y === undefined || y.length !== pointCount || yDomain === null) {
      continue;
    }

    const cellCount = xBinCount * yBinCount;
    const counts = new Uint32Array(cellCount);
    let indexedPointCount = 0;
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const xValue = columns.x[pointIndex];
      const yValue = y[pointIndex];
      if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue;
      counts[gridCellIndex(xValue, yValue, xDomain, yDomain, xBinCount, yBinCount)] += 1;
      indexedPointCount += 1;
    }

    const cellOffsets = new Uint32Array(cellCount + 1);
    for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
      cellOffsets[cellIndex + 1] = cellOffsets[cellIndex] + counts[cellIndex];
    }
    const writeOffsets = cellOffsets.slice(0, cellCount);
    const pointIndices = new Uint32Array(indexedPointCount);
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const xValue = columns.x[pointIndex];
      const yValue = y[pointIndex];
      if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue;
      const cellIndex = gridCellIndex(
        xValue,
        yValue,
        xDomain,
        yDomain,
        xBinCount,
        yBinCount,
      );
      pointIndices[writeOffsets[cellIndex]++] = pointIndex;
    }

    gridsByYKey[yKey] = {
      cellOffsets,
      pointIndices,
      xBinCount,
      xMax: xDomain.max,
      xMin: xDomain.min,
      yBinCount,
      yKey,
      yMax: yDomain.max,
      yMin: yDomain.min,
    };
  }

  return { gridsByYKey, pointCount };
}

export interface FastScatterNearestPointLookupDiagnostics {
  readonly candidateCount: number;
  readonly durationMs: number;
  readonly plotId: string | null;
  readonly scanEndIndex: number;
  readonly scanStartIndex: number;
  readonly yKey: string | null;
}

export interface FastScatterNearestPointHit {
  readonly canvasPoint: FastScatterCanvasPoint;
  readonly distancePx: number;
  readonly point: FastScatterPointRef;
  readonly pointIndex: number;
}

export interface FastScatterNearestPointLookupResult {
  readonly diagnostics: FastScatterNearestPointLookupDiagnostics;
  readonly hit: FastScatterNearestPointHit | null;
}

export type FastScatterBubbleRadiusResolver =
  | number
  | ((input: {
      aggregateIndex: number;
      count: number;
      plotId: string;
      subplot: FastScatterBubbleSubplotAggregation;
    }) => number);

export interface FastScatterAggregateLookupInput {
  readonly aggregation: FastScatterAggregationSet;
  readonly bubbleMaxRadiusCssPx?: number;
  readonly bubbleRadiusCssPx?: FastScatterBubbleRadiusResolver;
  readonly columns: Pick<FastScatterPointColumns, 'ids'>;
  readonly plotRects: readonly FastScatterPlotRect[];
  readonly pointerCssX: number;
  readonly pointerCssY: number;
  readonly sampleSize?: number;
  readonly viewport: FastScatterViewport;
}

export interface FastScatterAggregateLookupDiagnostics {
  readonly candidateCount: number;
  readonly durationMs: number;
  readonly plotId: string | null;
  readonly yKey: string | null;
}

export interface FastScatterAggregateHoverHitBase {
  readonly aggregateKind: FastScatterAggregationSet['kind'];
  readonly axis: {
    readonly x: FastScatterAggregateAxisRange;
    readonly y: FastScatterAggregateAxisRange;
  };
  readonly canvasPoint: FastScatterCanvasPoint;
  readonly count: number;
  readonly membership: FastScatterAggregationMembershipSpan;
  readonly plotId: string;
  readonly sampleIds: readonly string[];
  readonly yKey: string;
}

export interface FastScatterBubbleAggregateHoverHit
  extends FastScatterAggregateHoverHitBase {
  readonly aggregateIndex: number;
  readonly aggregateKind: 'bubble';
  readonly distancePx: number;
  readonly radiusCssPx: number;
}

export interface FastScatterHeatmapAggregateHoverHit
  extends FastScatterAggregateHoverHitBase {
  readonly aggregateKind: 'heatmap';
  readonly cellIndex: number;
  readonly xBin: number;
  readonly yBin: number;
}

export type FastScatterAggregateHoverHit =
  | FastScatterBubbleAggregateHoverHit
  | FastScatterHeatmapAggregateHoverHit;

export interface FastScatterAggregateLookupResult {
  readonly diagnostics: FastScatterAggregateLookupDiagnostics;
  readonly hit: FastScatterAggregateHoverHit | null;
}

export function lookupFastScatterNearestPoint(
  input: FastScatterNearestPointLookupInput,
): FastScatterNearestPointLookupResult {
  const startedAt = nowMs();
  const emptyDiagnostics = {
    candidateCount: 0,
    plotId: null,
    scanEndIndex: 0,
    scanStartIndex: 0,
    yKey: null,
  };

  if (
    input.columns.x.length === 0 ||
    !Number.isFinite(input.pointerCssX) ||
    !Number.isFinite(input.pointerCssY) ||
    !Number.isFinite(input.maxDistanceCssPx) ||
    input.maxDistanceCssPx < 0
  ) {
    return {
      diagnostics: withDuration(emptyDiagnostics, startedAt),
      hit: null,
    };
  }

  const plotRect = findFastScatterPlotRectAtPoint(
    input.plotRects,
    input.pointerCssX,
    input.pointerCssY,
  );

  if (plotRect === null) {
    return {
      diagnostics: withDuration(emptyDiagnostics, startedAt),
      hit: null,
    };
  }

  const plot = input.spec.plots.find((candidate) => candidate.id === plotRect.id);
  const yRange = input.viewport.yByPlot[plotRect.id];
  const yColumn = plot === undefined ? undefined : input.columns.y[plot.yKey];

  if (plot === undefined || yRange === undefined || yColumn === undefined) {
    return {
      diagnostics: withDuration(
        {
          ...emptyDiagnostics,
          plotId: plotRect.id,
          yKey: plot?.yKey ?? null,
        },
        startedAt,
      ),
      hit: null,
    };
  }

  const xMin = pixelToAxis(
    input.pointerCssX - input.maxDistanceCssPx,
    input.viewport.x,
    plotRect.xCssPx,
    plotRect.xCssPx + plotRect.widthCssPx,
  );
  const xMax = pixelToAxis(
    input.pointerCssX + input.maxDistanceCssPx,
    input.viewport.x,
    plotRect.xCssPx,
    plotRect.xCssPx + plotRect.widthCssPx,
  );
  const xRange = normalizeRange(xMin, xMax);
  const scanStartIndex = lowerBoundByX(input.columns, xRange.min);
  const scanEndIndex = upperBoundByX(input.columns, xRange.max);
  const pointerAxisX = pixelToAxis(
    input.pointerCssX,
    input.viewport.x,
    plotRect.xCssPx,
    plotRect.xCssPx + plotRect.widthCssPx,
  );
  const pointerXIndex = lowerBoundByX(input.columns, pointerAxisX);
  const yMin = pixelToAxis(
    input.pointerCssY + input.maxDistanceCssPx,
    yRange,
    plotRect.yCssPx + plotRect.heightCssPx,
    plotRect.yCssPx,
  );
  const yMax = pixelToAxis(
    input.pointerCssY - input.maxDistanceCssPx,
    yRange,
    plotRect.yCssPx + plotRect.heightCssPx,
    plotRect.yCssPx,
  );
  const hoverYRange = normalizeRange(yMin, yMax);
  const maxDistanceSquared = input.maxDistanceCssPx * input.maxDistanceCssPx;
  let bestHit: FastScatterNearestPointHit | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  let candidateCount = 0;

  const considerPoint = (pointIndex: number): void => {
    if (input.isPointEligible?.(pointIndex, plot.id) === false) {
      return;
    }
    const x = input.columns.x[pointIndex];
    const y = yColumn[pointIndex];

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    if (x < xRange.min || x > xRange.max || y < hoverYRange.min || y > hoverYRange.max) {
      return;
    }
    candidateCount += 1;

    const canvasX = axisToPixel(
      x,
      input.viewport.x,
      plotRect.xCssPx,
      plotRect.xCssPx + plotRect.widthCssPx,
    );
    const canvasY = axisToPixel(
      y,
      yRange,
      plotRect.yCssPx + plotRect.heightCssPx,
      plotRect.yCssPx,
    );
    const distanceSquared =
      (canvasX - input.pointerCssX) * (canvasX - input.pointerCssX) +
      (canvasY - input.pointerCssY) * (canvasY - input.pointerCssY);

    if (distanceSquared > maxDistanceSquared) {
      return;
    }

    if (
      distanceSquared < bestDistanceSquared ||
      (distanceSquared === bestDistanceSquared &&
        compareTieBreak(input.columns, pointIndex, bestHit?.pointIndex) < 0)
    ) {
      const sourceIndex = input.columns.sourceIndex?.[pointIndex] ?? pointIndex;
      bestDistanceSquared = distanceSquared;
      bestHit = {
        canvasPoint: {
          canvasX,
          canvasY,
        },
        distancePx: Math.sqrt(distanceSquared),
        point: createFastScatterPointRef({
          columns: input.columns,
          fallbackId: input.columns.ids[pointIndex],
          plotId: plot.id,
          sourceIndex,
          x,
          y,
          yKey: plot.yKey,
        }),
        pointIndex,
      };
    }
  };

  const compactHover =
    input.columns.xOrder === undefined &&
    input.hoverIndex?.pointCount === input.columns.x.length
      ? input.hoverIndex.compactByYKey?.[plot.yKey]
      : undefined;
  const hoverGrid =
    input.hoverIndex?.pointCount === input.columns.x.length
      ? input.hoverIndex.gridsByYKey[plot.yKey]
      : undefined;
  if (compactHover !== undefined) {
    visitFastScatterCompactHoverCandidates(
      compactHover,
      scanStartIndex,
      scanEndIndex,
      pointerXIndex,
      hoverYRange,
      considerPoint,
      (pointIndex) => {
        const x = input.columns.x[pointIndex];
        if (!Number.isFinite(x)) return Number.POSITIVE_INFINITY;
        const canvasX = axisToPixel(
          x,
          input.viewport.x,
          plotRect.xCssPx,
          plotRect.xCssPx + plotRect.widthCssPx,
        );
        const distance = canvasX - input.pointerCssX;
        return distance * distance;
      },
      () => bestDistanceSquared,
    );
  } else if (hoverGrid === undefined) {
    for (let sortedIndex = scanStartIndex; sortedIndex < scanEndIndex; sortedIndex += 1) {
      considerPoint(getPointIndexAtXOrder(input.columns, sortedIndex));
    }
    // Preserve the established diagnostic definition for the unfiltered X-only fallback.
    if (input.isPointEligible === undefined) {
      candidateCount = scanEndIndex - scanStartIndex;
    }
  } else {
    const pointerAxisY = pixelToAxis(
      input.pointerCssY,
      yRange,
      plotRect.yCssPx + plotRect.heightCssPx,
      plotRect.yCssPx,
    );
    visitFastScatterHoverGridCandidates(
      hoverGrid,
      xRange,
      hoverYRange,
      pointerAxisX,
      pointerAxisY,
      considerPoint,
      (scanned) => {
        if (!Number.isFinite(bestDistanceSquared)) return false;
        let nearestUnscannedDistance = Number.POSITIVE_INFINITY;
        if (scanned.xStart > scanned.queryXStart) {
          const boundaryX = gridBinBoundary(hoverGrid.xMin, hoverGrid.xMax, hoverGrid.xBinCount, scanned.xStart);
          nearestUnscannedDistance = Math.min(
            nearestUnscannedDistance,
            Math.abs(axisToPixel(boundaryX, input.viewport.x, plotRect.xCssPx, plotRect.xCssPx + plotRect.widthCssPx) - input.pointerCssX),
          );
        }
        if (scanned.xEnd < scanned.queryXEnd) {
          const boundaryX = gridBinBoundary(hoverGrid.xMin, hoverGrid.xMax, hoverGrid.xBinCount, scanned.xEnd + 1);
          nearestUnscannedDistance = Math.min(
            nearestUnscannedDistance,
            Math.abs(axisToPixel(boundaryX, input.viewport.x, plotRect.xCssPx, plotRect.xCssPx + plotRect.widthCssPx) - input.pointerCssX),
          );
        }
        if (scanned.yStart > scanned.queryYStart) {
          const boundaryY = gridBinBoundary(hoverGrid.yMin, hoverGrid.yMax, hoverGrid.yBinCount, scanned.yStart);
          nearestUnscannedDistance = Math.min(
            nearestUnscannedDistance,
            Math.abs(axisToPixel(boundaryY, yRange, plotRect.yCssPx + plotRect.heightCssPx, plotRect.yCssPx) - input.pointerCssY),
          );
        }
        if (scanned.yEnd < scanned.queryYEnd) {
          const boundaryY = gridBinBoundary(hoverGrid.yMin, hoverGrid.yMax, hoverGrid.yBinCount, scanned.yEnd + 1);
          nearestUnscannedDistance = Math.min(
            nearestUnscannedDistance,
            Math.abs(axisToPixel(boundaryY, yRange, plotRect.yCssPx + plotRect.heightCssPx, plotRect.yCssPx) - input.pointerCssY),
          );
        }
        return bestDistanceSquared < nearestUnscannedDistance * nearestUnscannedDistance;
      },
    );
  }

  return {
    diagnostics: withDuration(
      {
        candidateCount,
        plotId: plot.id,
        scanEndIndex,
        scanStartIndex,
        yKey: plot.yKey,
      },
      startedAt,
    ),
    hit: bestHit,
  };
}

function visitFastScatterCompactHoverCandidates(
  index: FastScatterCompactHoverIndex,
  scanStartIndex: number,
  scanEndIndex: number,
  pointerXIndex: number,
  yRange: { max: number; min: number },
  visit: (pointIndex: number) => void,
  xDistanceSquared: (pointIndex: number) => number,
  bestDistanceSquared: () => number,
): void {
  if (
    scanStartIndex >= scanEndIndex ||
    yRange.max < index.yMin ||
    yRange.min > index.yMax
  ) return;
  const yStart = gridBinIndex(
    Math.max(yRange.min, index.yMin), index.yMin, index.yMax, index.yBinCount,
  );
  const yEnd = gridBinIndex(
    Math.min(yRange.max, index.yMax), index.yMin, index.yMax, index.yBinCount,
  );
  const firstBlock = Math.floor(scanStartIndex / index.blockSize);
  const lastBlock = Math.floor((scanEndIndex - 1) / index.blockSize);
  const visitBlock = (block: number) => {
    if (!compactBlockIntersectsY(index, block, yStart, yEnd)) return;
    const blockStart = block * index.blockSize;
    const start = Math.max(scanStartIndex, blockStart);
    const end = Math.min(scanEndIndex, blockStart + index.blockSize);
    for (let pointIndex = start; pointIndex < end; pointIndex += 1) {
      const yBin = index.yBins[pointIndex]!;
      if (yBin >= yStart && yBin <= yEnd) visit(pointIndex);
    }
  };
  const centerBlock = clampInteger(
    Math.floor(Math.min(scanEndIndex - 1, Math.max(scanStartIndex, pointerXIndex)) / index.blockSize),
    firstBlock,
    lastBlock,
  );
  visitBlock(centerBlock);

  let leftBlock = centerBlock - 1;
  let rightBlock = centerBlock + 1;
  while (leftBlock >= firstBlock || rightBlock <= lastBlock) {
    while (
      leftBlock >= firstBlock &&
      !compactBlockIntersectsY(index, leftBlock, yStart, yEnd)
    ) leftBlock -= 1;
    while (
      rightBlock <= lastBlock &&
      !compactBlockIntersectsY(index, rightBlock, yStart, yEnd)
    ) rightBlock += 1;

    const leftPointIndex = leftBlock < firstBlock
      ? null
      : Math.min(scanEndIndex - 1, (leftBlock + 1) * index.blockSize - 1);
    const rightPointIndex = rightBlock > lastBlock
      ? null
      : Math.max(scanStartIndex, rightBlock * index.blockSize);
    const leftDistance = leftPointIndex === null
      ? Number.POSITIVE_INFINITY
      : xDistanceSquared(leftPointIndex);
    const rightDistance = rightPointIndex === null
      ? Number.POSITIVE_INFINITY
      : xDistanceSquared(rightPointIndex);
    if (bestDistanceSquared() < Math.min(leftDistance, rightDistance)) return;
    if (leftDistance <= rightDistance) {
      if (leftBlock < firstBlock) return;
      visitBlock(leftBlock);
      leftBlock -= 1;
    } else {
      if (rightBlock > lastBlock) return;
      visitBlock(rightBlock);
      rightBlock += 1;
    }
  }
}

function compactBlockIntersectsY(
  index: FastScatterCompactHoverIndex,
  block: number,
  yStart: number,
  yEnd: number,
): boolean {
  const firstWord = yStart >>> 5;
  const lastWord = yEnd >>> 5;
  const occupancyOffset = block * index.occupancyWordsPerBlock;
  for (let word = firstWord; word <= lastWord; word += 1) {
    const lowerMask = word === firstWord
      ? (0xffff_ffff << (yStart & 31)) >>> 0
      : 0xffff_ffff;
    const upperMask = word === lastWord
      ? (0xffff_ffff >>> (31 - (yEnd & 31))) >>> 0
      : 0xffff_ffff;
    if (((index.blockOccupancy[occupancyOffset + word] ?? 0) & lowerMask & upperMask) !== 0) {
      return true;
    }
  }
  return false;
}

export function createFastScatterPointRef({
  columns,
  fallbackId,
  plotId,
  sourceIndex,
  x,
  y,
  yKey,
}: {
  readonly columns: Pick<
    FastScatterPointColumns,
    'ids' | 'recordIdentityBySourceIndex' | 'tableBySourceIndex'
  >;
  readonly fallbackId?: string;
  readonly plotId: string;
  readonly sourceIndex: number;
  readonly x: number;
  readonly y: number;
  readonly yKey: string;
}): FastScatterPointRef {
  const id = columns.ids[sourceIndex] ?? fallbackId ?? String(sourceIndex);
  const record = resolveFastScatterRecordIdentity(columns, sourceIndex, id);
  return {
    id,
    ...(record === undefined ? {} : { record }),
    plotId,
    sourceIndex,
    x,
    y,
    yKey,
  };
}

function resolveFastScatterRecordIdentity(
  columns: Pick<
    FastScatterPointColumns,
    'recordIdentityBySourceIndex' | 'tableBySourceIndex'
  >,
  sourceIndex: number,
  id: string,
): FastScatterPointRef['record'] | undefined {
  const explicit = columns.recordIdentityBySourceIndex?.[sourceIndex];
  if (explicit !== undefined) {
    return explicit;
  }
  const table = columns.tableBySourceIndex?.[sourceIndex];
  if (table === undefined) {
    return undefined;
  }
  return { id, sourceIndex, table, tableKey: table };
}

export function lookupFastScatterAggregateHit(
  input: FastScatterAggregateLookupInput,
): FastScatterAggregateLookupResult {
  const startedAt = nowMs();
  const emptyDiagnostics = {
    candidateCount: 0,
    plotId: null,
    yKey: null,
  };

  if (
    !Number.isFinite(input.pointerCssX) ||
    !Number.isFinite(input.pointerCssY)
  ) {
    return {
      diagnostics: withDuration(emptyDiagnostics, startedAt),
      hit: null,
    };
  }

  const plotRect = findFastScatterPlotRectAtPoint(
    input.plotRects,
    input.pointerCssX,
    input.pointerCssY,
  );

  if (plotRect === null) {
    return {
      diagnostics: withDuration(emptyDiagnostics, startedAt),
      hit: null,
    };
  }

  if (input.aggregation.kind === 'bubble') {
    const subplot = input.aggregation.subplots.find(
      (candidate) => candidate.plotId === plotRect.id,
    );

    if (subplot === undefined) {
      return {
        diagnostics: withDuration(
          {
            ...emptyDiagnostics,
            plotId: plotRect.id,
          },
          startedAt,
        ),
        hit: null,
      };
    }

    const yRange = input.viewport.yByPlot[plotRect.id];

    if (yRange === undefined) {
      return {
        diagnostics: withDuration(
          {
            candidateCount: subplot.aggregateCount,
            plotId: plotRect.id,
            yKey: subplot.yKey,
          },
          startedAt,
        ),
        hit: null,
      };
    }

    const hit = lookupBubbleAggregateHit(
      subplot,
      input.columns,
      input.pointerCssX,
      input.pointerCssY,
      plotRect,
      input.viewport.x,
      yRange,
      input.bubbleRadiusCssPx ?? 0,
      input.bubbleMaxRadiusCssPx,
      input.sampleSize,
    );

    return {
      diagnostics: withDuration(
        {
          candidateCount: hit.candidateCount,
          plotId: plotRect.id,
          yKey: subplot.yKey,
        },
        startedAt,
      ),
      hit: hit.hit,
    };
  }

  const subplot = input.aggregation.subplots.find(
    (candidate) => candidate.plotId === plotRect.id,
  );

  if (subplot === undefined) {
    return {
      diagnostics: withDuration(
        {
          ...emptyDiagnostics,
          plotId: plotRect.id,
        },
        startedAt,
      ),
      hit: null,
    };
  }

  const plotPixelX =
    ((input.pointerCssX - plotRect.xCssPx) / plotRect.widthCssPx) * subplot.plotWidthPx;
  const plotPixelY =
    ((input.pointerCssY - plotRect.yCssPx) / plotRect.heightCssPx) * subplot.plotHeightPx;
  const location = locateFastScatterHeatmapCellAtPixel(subplot, plotPixelX, plotPixelY);
  const cellCount =
    location === null ? 0 : (subplot.counts[location.cellIndex] ?? 0);
  const hit =
    location === null || cellCount <= 0
      ? null
      : createHeatmapAggregateHoverHit(
          subplot,
          input.columns,
          plotRect,
          location.cellIndex,
          input.sampleSize,
        );

  return {
    diagnostics: withDuration(
      {
        candidateCount: hit === null ? 0 : 1,
        plotId: plotRect.id,
        yKey: subplot.yKey,
      },
      startedAt,
    ),
    hit,
  };
}

function lookupBubbleAggregateHit(
  subplot: FastScatterBubbleSubplotAggregation,
  columns: Pick<FastScatterPointColumns, 'ids'>,
  pointerCssX: number,
  pointerCssY: number,
  plotRect: FastScatterPlotRect,
  xRange: FastScatterViewport['x'],
  yRange: FastScatterViewport['x'],
  radiusResolver: FastScatterBubbleRadiusResolver,
  maxRadiusCssPx: number | undefined,
  sampleSize: number | undefined,
): { candidateCount: number; hit: FastScatterBubbleAggregateHoverHit | null } {
  const scanRange = resolveBubbleAggregateScanRange(
    subplot,
    pointerCssX,
    plotRect,
    xRange,
    maxRadiusCssPx,
  );
  let bestHit: FastScatterBubbleAggregateHoverHit | null = null;

  for (
    let aggregateIndex = scanRange.startIndex;
    aggregateIndex < scanRange.endIndex;
    aggregateIndex += 1
  ) {
    const centerX = subplot.centerX[aggregateIndex];
    const centerY = subplot.centerY[aggregateIndex];

    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
      continue;
    }

    const canvasX = axisToPixel(
      centerX,
      xRange,
      plotRect.xCssPx,
      plotRect.xCssPx + plotRect.widthCssPx,
    );
    const canvasY = axisToPixel(
      centerY,
      yRange,
      plotRect.yCssPx + plotRect.heightCssPx,
      plotRect.yCssPx,
    );
    const radiusCssPx = resolveBubbleRadiusCssPx(
      radiusResolver,
      subplot,
      aggregateIndex,
    );
    const distancePx = Math.hypot(canvasX - pointerCssX, canvasY - pointerCssY);

    if (distancePx > radiusCssPx) {
      continue;
    }

    const membership = getFastScatterBubbleAggregateMembershipSpan(subplot, aggregateIndex);

    if (membership === null) {
      continue;
    }

    const nextHit = createBubbleAggregateHoverHit(
      subplot,
      columns,
      aggregateIndex,
      {
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
      },
      membership,
      {
        canvasX,
        canvasY,
      },
      distancePx,
      radiusCssPx,
      sampleSize,
    );

    if (
      bestHit === null ||
      nextHit.distancePx < bestHit.distancePx ||
      (nextHit.distancePx === bestHit.distancePx &&
        compareAggregateTieBreak(nextHit.membership, bestHit.membership) < 0)
    ) {
      bestHit = nextHit;
    }
  }

  return {
    candidateCount: scanRange.endIndex - scanRange.startIndex,
    hit: bestHit,
  };
}

function resolveBubbleAggregateScanRange(
  subplot: FastScatterBubbleSubplotAggregation,
  pointerCssX: number,
  plotRect: FastScatterPlotRect,
  xRange: FastScatterViewport['x'],
  maxRadiusCssPx: number | undefined,
): { endIndex: number; startIndex: number } {
  if (
    maxRadiusCssPx === undefined ||
    !Number.isFinite(maxRadiusCssPx) ||
    maxRadiusCssPx < 0
  ) {
    return {
      endIndex: subplot.aggregateCount,
      startIndex: 0,
    };
  }

  const xMin = pixelToAxis(
    pointerCssX - maxRadiusCssPx,
    xRange,
    plotRect.xCssPx,
    plotRect.xCssPx + plotRect.widthCssPx,
  );
  const xMax = pixelToAxis(
    pointerCssX + maxRadiusCssPx,
    xRange,
    plotRect.xCssPx,
    plotRect.xCssPx + plotRect.widthCssPx,
  );
  const range = normalizeRange(xMin, xMax);

  return {
    endIndex: upperBound(subplot.centerX, range.max),
    startIndex: lowerBound(subplot.centerX, range.min),
  };
}

function createBubbleAggregateHoverHit(
  subplot: FastScatterBubbleSubplotAggregation,
  columns: Pick<FastScatterPointColumns, 'ids'>,
  aggregateIndex: number,
  axisBounds: {
    readonly x: FastScatterAggregateAxisRange;
    readonly y: FastScatterAggregateAxisRange;
  },
  membership: FastScatterAggregationMembershipSpan,
  canvasPoint: FastScatterCanvasPoint,
  distancePx: number,
  radiusCssPx: number,
  sampleSize: number | undefined,
): FastScatterBubbleAggregateHoverHit {
  return {
    aggregateIndex,
    aggregateKind: 'bubble',
    axis: axisBounds,
    canvasPoint,
    count: subplot.counts[aggregateIndex] ?? membership.count,
    distancePx,
    membership,
    plotId: subplot.plotId,
    radiusCssPx,
    sampleIds: materializeSampleIds(columns, membership, subplot.sourceIndices, sampleSize),
    yKey: subplot.yKey,
  };
}

function createHeatmapAggregateHoverHit(
  subplot: FastScatterHeatmapSubplotAggregation,
  columns: Pick<FastScatterPointColumns, 'ids'>,
  plotRect: FastScatterPlotRect,
  cellIndex: number,
  sampleSize: number | undefined,
): FastScatterHeatmapAggregateHoverHit | null {
  const axisBounds = getFastScatterHeatmapCellAxisBounds(subplot, cellIndex);
  const membership = getFastScatterHeatmapCellMembershipSpan(subplot, cellIndex);
  const count = subplot.counts[cellIndex] ?? membership?.count ?? 0;

  if (axisBounds === null || membership === null || count <= 0) {
    return null;
  }

  return {
    aggregateKind: 'heatmap',
    axis: {
      x: axisBounds.x,
      y: axisBounds.y,
    },
    canvasPoint: resolveHeatmapCanvasPoint(axisBounds, plotRect, subplot),
    cellIndex,
    count,
    membership,
    plotId: subplot.plotId,
    sampleIds: materializeSampleIds(columns, membership, subplot.sourceIndices, sampleSize),
    xBin: axisBounds.xBin,
    yBin: axisBounds.yBin,
    yKey: subplot.yKey,
  };
}

function resolveBubbleRadiusCssPx(
  radiusResolver: FastScatterBubbleRadiusResolver,
  subplot: FastScatterBubbleSubplotAggregation,
  aggregateIndex: number,
): number {
  const count = subplot.counts[aggregateIndex] ?? 0;
  const radiusCssPx =
    typeof radiusResolver === 'function'
      ? radiusResolver({
          aggregateIndex,
          count,
          plotId: subplot.plotId,
          subplot,
        })
      : radiusResolver;

  if (!Number.isFinite(radiusCssPx) || radiusCssPx < 0) {
    return 0;
  }

  return radiusCssPx;
}

function compareAggregateTieBreak(
  left: FastScatterAggregationMembershipSpan,
  right: FastScatterAggregationMembershipSpan,
): number {
  const leftSourceIndex = left.minSourceIndex ?? Number.POSITIVE_INFINITY;
  const rightSourceIndex = right.minSourceIndex ?? Number.POSITIVE_INFINITY;

  if (leftSourceIndex !== rightSourceIndex) {
    return leftSourceIndex - rightSourceIndex;
  }

  return left.offset - right.offset;
}

function materializeSampleIds(
  columns: Pick<FastScatterPointColumns, 'ids'>,
  membership: FastScatterAggregationMembershipSpan,
  sourceIndices: Uint32Array,
  sampleSize: number | undefined,
): string[] {
  const normalizedSampleSize = normalizeSampleSize(sampleSize);
  const count = Math.min(normalizedSampleSize, membership.count);
  const sampleIds = new Array<string>(count);

  for (let index = 0; index < count; index += 1) {
    const sourceIndex = sourceIndices[membership.offset + index];
    sampleIds[index] = columns.ids[sourceIndex] ?? String(sourceIndex);
  }

  return sampleIds;
}

function resolveHeatmapCanvasPoint(
  axisBounds: {
    readonly x: FastScatterAggregateAxisRange;
    readonly y: FastScatterAggregateAxisRange;
  },
  plotRect: FastScatterPlotRect,
  subplot: FastScatterHeatmapSubplotAggregation,
): FastScatterCanvasPoint {
  const xFraction = resolveAxisRangeFraction(
    axisBounds.x.center,
    subplot.xRange.min,
    subplot.xRange.max,
  );
  const yFraction = resolveAxisRangeFraction(
    axisBounds.y.center,
    subplot.yRange.min,
    subplot.yRange.max,
  );

  return {
    canvasX: plotRect.xCssPx + xFraction * plotRect.widthCssPx,
    canvasY: plotRect.yCssPx + (1 - yFraction) * plotRect.heightCssPx,
  };
}

function resolveAxisRangeFraction(
  value: number,
  min: number,
  max: number,
): number {
  const span = max - min;

  if (!Number.isFinite(value) || !Number.isFinite(span) || span <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, (value - min) / span));
}

function normalizeSampleSize(sampleSize: number | undefined): number {
  if (sampleSize === undefined || !Number.isFinite(sampleSize) || sampleSize <= 0) {
    return 5;
  }

  return Math.floor(sampleSize);
}

function compareTieBreak(
  columns: Pick<FastScatterPointColumns, 'sourceIndex'>,
  pointIndex: number,
  bestPointIndex: number | undefined,
): number {
  if (bestPointIndex === undefined) {
    return -1;
  }

  const sourceIndex = columns.sourceIndex?.[pointIndex] ?? pointIndex;
  const bestSourceIndex = columns.sourceIndex?.[bestPointIndex] ?? bestPointIndex;

  if (sourceIndex !== bestSourceIndex) {
    return sourceIndex - bestSourceIndex;
  }

  return pointIndex - bestPointIndex;
}

function lowerBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (values[mid] < target) {
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
    if (values[mid] <= target) {
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

function normalizeRange(min: number, max: number): { max: number; min: number } {
  return min <= max ? { max, min } : { max: min, min: max };
}

function finiteDomain(values: ArrayLike<number>): { max: number; min: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { max, min } : null;
}

async function finiteDomainAsync(
  values: ArrayLike<number>,
  yieldInterval: number,
): Promise<{ max: number; min: number } | null> {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (Number.isFinite(value)) {
      min = Math.min(min, value!);
      max = Math.max(max, value!);
    }
    if (index > 0 && index % yieldInterval === 0) await yieldToHost();
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { max, min } : null;
}

async function isNondecreasingFiniteAsync(
  values: ArrayLike<number>,
  yieldInterval: number,
): Promise<boolean> {
  let previous = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (index > 0 && index % yieldInterval === 0) await yieldToHost();
    if (!Number.isFinite(value)) continue;
    if (value! < previous) return false;
    previous = value!;
  }
  return true;
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function gridCellIndex(
  x: number,
  y: number,
  xDomain: { max: number; min: number },
  yDomain: { max: number; min: number },
  xBinCount: number,
  yBinCount: number,
): number {
  const xBin = gridBinIndex(x, xDomain.min, xDomain.max, xBinCount);
  const yBin = gridBinIndex(y, yDomain.min, yDomain.max, yBinCount);
  return yBin * xBinCount + xBin;
}

function gridBinIndex(value: number, min: number, max: number, binCount: number): number {
  if (max <= min) return 0;
  return clampInteger(Math.floor(((value - min) / (max - min)) * binCount), 0, binCount - 1);
}

function visitFastScatterHoverGridCandidates(
  grid: FastScatterHoverGridIndex,
  xRange: { max: number; min: number },
  yRange: { max: number; min: number },
  pointerX: number,
  pointerY: number,
  visit: (pointIndex: number) => void,
  shouldStop: (scanned: {
    queryXEnd: number;
    queryXStart: number;
    queryYEnd: number;
    queryYStart: number;
    xEnd: number;
    xStart: number;
    yEnd: number;
    yStart: number;
  }) => boolean,
): void {
  if (
    xRange.max < grid.xMin || xRange.min > grid.xMax ||
    yRange.max < grid.yMin || yRange.min > grid.yMax
  ) {
    return;
  }
  const xStart = gridBinIndex(Math.max(xRange.min, grid.xMin), grid.xMin, grid.xMax, grid.xBinCount);
  const xEnd = gridBinIndex(Math.min(xRange.max, grid.xMax), grid.xMin, grid.xMax, grid.xBinCount);
  const yStart = gridBinIndex(Math.max(yRange.min, grid.yMin), grid.yMin, grid.yMax, grid.yBinCount);
  const yEnd = gridBinIndex(Math.min(yRange.max, grid.yMax), grid.yMin, grid.yMax, grid.yBinCount);
  const centerX = clampInteger(
    gridBinIndex(pointerX, grid.xMin, grid.xMax, grid.xBinCount),
    xStart,
    xEnd,
  );
  const centerY = clampInteger(
    gridBinIndex(pointerY, grid.yMin, grid.yMax, grid.yBinCount),
    yStart,
    yEnd,
  );
  const maxRing = Math.max(centerX - xStart, xEnd - centerX, centerY - yStart, yEnd - centerY);

  for (let ring = 0; ring <= maxRing; ring += 1) {
    const ringXStart = Math.max(xStart, centerX - ring);
    const ringXEnd = Math.min(xEnd, centerX + ring);
    const ringYStart = Math.max(yStart, centerY - ring);
    const ringYEnd = Math.min(yEnd, centerY + ring);
    for (let yBin = ringYStart; yBin <= ringYEnd; yBin += 1) {
      const rowOffset = yBin * grid.xBinCount;
      for (let xBin = ringXStart; xBin <= ringXEnd; xBin += 1) {
        if (Math.max(Math.abs(xBin - centerX), Math.abs(yBin - centerY)) !== ring) {
          continue;
        }
        const cellIndex = rowOffset + xBin;
        const start = grid.cellOffsets[cellIndex];
        const end = grid.cellOffsets[cellIndex + 1];
        for (let offset = start; offset < end; offset += 1) {
          visit(grid.pointIndices[offset]);
        }
      }
    }
    if (shouldStop({
      queryXEnd: xEnd,
      queryXStart: xStart,
      queryYEnd: yEnd,
      queryYStart: yStart,
      xEnd: ringXEnd,
      xStart: ringXStart,
      yEnd: ringYEnd,
      yStart: ringYStart,
    })) return;
  }
}

function gridBinBoundary(min: number, max: number, binCount: number, bin: number): number {
  return max <= min ? min : min + ((max - min) * bin) / binCount;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function withDuration<T extends object>(
  diagnostics: T,
  startedAt: number,
): T & { readonly durationMs: number } {
  return {
    ...diagnostics,
    durationMs: nowMs() - startedAt,
  };
}

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
