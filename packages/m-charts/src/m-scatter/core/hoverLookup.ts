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
  FastScatterHeatmapSubplotAggregation,
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
  readonly plotRects: readonly FastScatterPlotRect[];
  readonly pointerCssX: number;
  readonly pointerCssY: number;
  readonly spec: FastScatterPlotSpec;
  readonly viewport: FastScatterViewport;
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
  const maxDistanceSquared = input.maxDistanceCssPx * input.maxDistanceCssPx;
  let bestHit: FastScatterNearestPointHit | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;

  for (let sortedIndex = scanStartIndex; sortedIndex < scanEndIndex; sortedIndex += 1) {
    const pointIndex = getPointIndexAtXOrder(input.columns, sortedIndex);
    const x = input.columns.x[pointIndex];
    const y = yColumn[pointIndex];

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

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
      continue;
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
  }

  return {
    diagnostics: withDuration(
      {
        candidateCount: scanEndIndex - scanStartIndex,
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
