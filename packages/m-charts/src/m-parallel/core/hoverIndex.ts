import {
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  forEachParallelRoutedSegment,
  parallelRenderedNormalizedValueToDisplayValue,
  projectParallelRenderedNormalizedValue,
  resolveParallelRecordIdentity,
  type ParallelBuffers,
  type ParallelNearestRecordResult,
} from './buffers.js';

export interface ParallelHoverIndexOptions {
  candidatesPerCell?: number;
  samplesPerSegment?: number;
  searchRadiusCells?: number;
  xBinsPerAxisPair?: number;
  yBins?: number;
}

export interface ParallelHoverIndexMetrics {
  buildMs: number;
  byteLength: number;
  candidateCount: number;
  cellCount: number;
}

export interface ParallelHoverIndex {
  axisPairCount: number;
  candidates: Uint32Array;
  candidatesPerCell: number;
  metrics: ParallelHoverIndexMetrics;
  searchRadiusCells: number;
  xBinsPerAxisPair: number;
  yBins: number;
}

export interface ParallelHoverIndexQuery {
  axisPosition: number;
  buffers: ParallelBuffers;
  index: ParallelHoverIndex;
  maxDistancePx: number;
  normalizedValue: number;
  plotHeightPx: number;
  plotWidthPx: number;
}

const DEFAULT_X_BINS_PER_AXIS_PAIR = 64;
const DEFAULT_Y_BINS = 512;
const DEFAULT_CANDIDATES_PER_CELL = 8;
const DEFAULT_SEARCH_RADIUS_CELLS = 4;
const DEFAULT_SAMPLES_PER_SEGMENT = 9;
const EMPTY_SOURCE_INDEX = 0xffffffff;

export function createParallelHoverIndex(
  buffers: ParallelBuffers,
  options: ParallelHoverIndexOptions = {},
): ParallelHoverIndex {
  const buildStartedAt = performance.now();
  const axisPairCount = Math.max(0, buffers.axisCount - 1);
  const xBinsPerAxisPair = normalizePositiveInteger(
    options.xBinsPerAxisPair,
    DEFAULT_X_BINS_PER_AXIS_PAIR,
  );
  const yBins = normalizePositiveInteger(options.yBins, DEFAULT_Y_BINS);
  const candidatesPerCell = normalizePositiveInteger(
    options.candidatesPerCell,
    DEFAULT_CANDIDATES_PER_CELL,
  );
  const searchRadiusCells = normalizePositiveInteger(
    options.searchRadiusCells,
    DEFAULT_SEARCH_RADIUS_CELLS,
  );
  const samplesPerSegment = normalizePositiveInteger(
    options.samplesPerSegment,
    DEFAULT_SAMPLES_PER_SEGMENT,
  );
  const cellCount = axisPairCount * xBinsPerAxisPair * yBins;
  const candidates = new Uint32Array(cellCount * candidatesPerCell);
  candidates.fill(EMPTY_SOURCE_INDEX);
  let candidateCount = 0;

  for (let sourceIndex = 0; sourceIndex < buffers.recordCount; sourceIndex += 1) {
    forEachParallelRoutedSegment(
      buffers.normalizedValuesByAxis,
      buffers.axisOrder,
      sourceIndex,
      (segment) => {
        const axisPairIndex = segment.startAxisIndex;
        const start = projectParallelRenderedNormalizedValue(
          segment.startNormalizedValue,
        );
        const end = projectParallelRenderedNormalizedValue(
          segment.endNormalizedValue,
        );

        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          return;
        }

        const seedCount = Math.max(samplesPerSegment, xBinsPerAxisPair);
        for (let sample = 0; sample < seedCount; sample += 1) {
          const t = seedCount === 1 ? 0.5 : sample / (seedCount - 1);
          const xBin = clampInteger(
            Math.floor(t * xBinsPerAxisPair),
            0,
            xBinsPerAxisPair - 1,
          );
          const y = start + (end - start) * t;
          const yBin = normalizedValueToHoverYBin(y, yBins);

          if (insertCandidate(
            candidates,
            axisPairIndex,
            xBin,
            yBin,
            sourceIndex,
            xBinsPerAxisPair,
            yBins,
            candidatesPerCell,
          )) {
            candidateCount += 1;
          }
        }
      },
    );
  }

  return {
    axisPairCount,
    candidates,
    candidatesPerCell,
    metrics: {
      buildMs: performance.now() - buildStartedAt,
      byteLength: candidates.byteLength,
      candidateCount,
      cellCount,
    },
    searchRadiusCells,
    xBinsPerAxisPair,
    yBins,
  };
}

export function findNearestParallelRecordByIndexedPoint({
  axisPosition,
  buffers,
  index,
  maxDistancePx,
  normalizedValue,
  plotHeightPx,
  plotWidthPx,
}: ParallelHoverIndexQuery): ParallelNearestRecordResult | null {
  if (
    buffers.recordCount === 0 ||
    index.axisPairCount === 0 ||
    maxDistancePx < 0 ||
    plotWidthPx <= 0 ||
    plotHeightPx <= 0 ||
    !Number.isFinite(axisPosition) ||
    !Number.isFinite(normalizedValue)
  ) {
    return null;
  }

  const axisPairCandidates = getAxisPairCandidates(axisPosition, index.axisPairCount);
  const seen = new Set<number>();
  const sourceCandidates: number[] = [];
  const localX = axisPosition - Math.floor(axisPosition);
  const xBin = clampInteger(
    Math.floor(localX * index.xBinsPerAxisPair),
    0,
    index.xBinsPerAxisPair - 1,
  );
  const yBin = clampInteger(
    normalizedValueToHoverYBin(normalizedValue, index.yBins),
    0,
    index.yBins - 1,
  );

  for (const axisPairIndex of axisPairCandidates) {
    for (
      let radius = 0;
      radius <= index.searchRadiusCells;
      radius += 1
    ) {
      collectCandidatesInRadius({
        axisPairIndex,
        candidates: sourceCandidates,
        hoverIndex: index,
        radius,
        seen,
        xBin,
        yBin,
      });
    }
  }

  if (sourceCandidates.length === 0) {
    return null;
  }

  return refineNearestCandidate({
    axisPosition,
    buffers,
    maxDistancePx,
    normalizedValue,
    plotHeightPx,
    plotWidthPx,
    sourceCandidates,
  });
}

function collectCandidatesInRadius({
  axisPairIndex,
  candidates,
  hoverIndex,
  radius,
  seen,
  xBin,
  yBin,
}: {
  axisPairIndex: number;
  candidates: number[];
  hoverIndex: ParallelHoverIndex;
  radius: number;
  seen: Set<number>;
  xBin: number;
  yBin: number;
}): void {
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
        continue;
      }
      const cellX = xBin + dx;
      const cellY = yBin + dy;
      if (
        cellX < 0 ||
        cellX >= hoverIndex.xBinsPerAxisPair ||
        cellY < 0 ||
        cellY >= hoverIndex.yBins
      ) {
        continue;
      }
      const offset =
        ((axisPairIndex * hoverIndex.xBinsPerAxisPair + cellX) * hoverIndex.yBins +
          cellY) *
        hoverIndex.candidatesPerCell;

      for (let slot = 0; slot < hoverIndex.candidatesPerCell; slot += 1) {
        const sourceIndex = hoverIndex.candidates[offset + slot];
        if (sourceIndex === EMPTY_SOURCE_INDEX || seen.has(sourceIndex)) {
          continue;
        }
        seen.add(sourceIndex);
        candidates.push(sourceIndex);
      }
    }
  }
}

function refineNearestCandidate({
  axisPosition,
  buffers,
  maxDistancePx,
  normalizedValue,
  plotHeightPx,
  plotWidthPx,
  sourceCandidates,
}: {
  axisPosition: number;
  buffers: ParallelBuffers;
  maxDistancePx: number;
  normalizedValue: number;
  plotHeightPx: number;
  plotWidthPx: number;
  sourceCandidates: readonly number[];
}): ParallelNearestRecordResult | null {
  const clampedAxisPosition = clampNumber(
    axisPosition,
    0,
    Math.max(0, buffers.axisCount - 1),
  );
  const clampedNormalizedValue = projectParallelRenderedNormalizedValue(
    normalizedValue,
  );
  const xScale = plotWidthPx / Math.max(1, buffers.axisCount - 1);
  const pointerX = clampedAxisPosition * xScale;
  const pointerY =
    (1 - parallelRenderedNormalizedValueToDisplayValue(clampedNormalizedValue)) *
    plotHeightPx;
  let nearest: ParallelNearestRecordResult | null = null;
  let nearestDistanceSquared = maxDistancePx * maxDistancePx;

  for (const sourceIndex of sourceCandidates) {
    forEachParallelRoutedSegment(
      buffers.normalizedValuesByAxis,
      buffers.axisOrder,
      sourceIndex,
      (segment) => {
        const startNormalized = projectParallelRenderedNormalizedValue(
          segment.startNormalizedValue,
        );
        const endNormalized = projectParallelRenderedNormalizedValue(
          segment.endNormalizedValue,
        );

        if (!Number.isFinite(startNormalized) || !Number.isFinite(endNormalized)) {
          return;
        }

        const startX = segment.startAxisIndex * xScale;
        const startY =
          (1 - parallelRenderedNormalizedValueToDisplayValue(startNormalized)) *
          plotHeightPx;
        const endX = segment.endAxisIndex * xScale;
        const endY =
          (1 - parallelRenderedNormalizedValueToDisplayValue(endNormalized)) *
          plotHeightPx;
        const deltaX = endX - startX;
        const deltaY = endY - startY;
        const segmentLengthSquared = deltaX * deltaX + deltaY * deltaY;
        const projection =
          segmentLengthSquared === 0
            ? 0
            : clampNumber(
                ((pointerX - startX) * deltaX + (pointerY - startY) * deltaY) /
                  segmentLengthSquared,
                0,
                1,
              );
        const projectedX = startX + deltaX * projection;
        const projectedY = startY + deltaY * projection;
        const distanceX = pointerX - projectedX;
        const distanceY = pointerY - projectedY;
        const distanceSquared = distanceX * distanceX + distanceY * distanceY;

        if (distanceSquared > nearestDistanceSquared) {
          return;
        }

        const activeAxisIndex = clampInteger(
          Math.round(clampedAxisPosition),
          0,
          buffers.axisCount - 1,
        );
        const activeAxis = buffers.axisOrder[activeAxisIndex];

        nearestDistanceSquared = distanceSquared;
        const record = resolveParallelRecordIdentity(buffers, sourceIndex);
        nearest = {
          activeAxis,
          activeAxisValue: buffers.rawValuesByAxis[activeAxis][sourceIndex],
          distancePx: Math.sqrt(distanceSquared),
          id: buffers.ids[sourceIndex],
          normalizedAxisValue: buffers.normalizedValuesByAxis[activeAxis][sourceIndex],
          projectedAxisPosition:
            segment.startAxisIndex +
            (segment.endAxisIndex - segment.startAxisIndex) * projection,
          projectedNormalizedValue:
            startNormalized + (endNormalized - startNormalized) * projection,
          ...(record === undefined ? {} : { record }),
          recordIndex: sourceIndex,
          segmentEndAxis: segment.endAxis,
          segmentStartAxis: segment.startAxis,
        };
      },
    );
  }

  return nearest;
}

function normalizedValueToHoverYBin(value: number, yBins: number): number {
  const projected = projectParallelRenderedNormalizedValue(value);
  if (!Number.isFinite(projected)) {
    return 0;
  }
  const span = 1 - PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y;
  return clampInteger(
    Math.floor(
      ((projected - PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y) / span) * yBins,
    ),
    0,
    yBins - 1,
  );
}

function getAxisPairCandidates(
  axisPosition: number,
  axisPairCount: number,
): readonly number[] {
  const base = clampInteger(Math.floor(axisPosition), 0, axisPairCount - 1);
  const local = axisPosition - Math.floor(axisPosition);

  if (local < 0.08 && base > 0) {
    return [base - 1, base];
  }
  if (local > 0.92 && base < axisPairCount - 1) {
    return [base, base + 1];
  }

  return [base];
}

function insertCandidate(
  candidates: Uint32Array,
  axisPairIndex: number,
  xBin: number,
  yBin: number,
  sourceIndex: number,
  xBinsPerAxisPair: number,
  yBins: number,
  candidatesPerCell: number,
): boolean {
  const offset =
    ((axisPairIndex * xBinsPerAxisPair + xBin) * yBins + yBin) * candidatesPerCell;

  for (let slot = 0; slot < candidatesPerCell; slot += 1) {
    const current = candidates[offset + slot];
    if (current === sourceIndex) {
      return false;
    }
    if (current === EMPTY_SOURCE_INDEX) {
      candidates[offset + slot] = sourceIndex;
      return true;
    }
  }

  return false;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? value
    : fallback;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
