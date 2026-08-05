import {
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  parallelRenderedNormalizedValueToDisplayValue,
  projectParallelRenderedNormalizedValue,
  projectParallelViewportNormalizedValue,
  readParallelNormalizedValue,
  type ParallelAxisViewports,
  type ParallelBuffers,
  type ParallelNearestRecordResult,
} from '../../m-parallel/index.js';
import { interpolateParallelRenderedNormalizedValue } from '../../m-parallel/core/buffers.js';

/** Maps a GPU hover-population index back to the public source record. */
export function resolveParallelWebgpuHoverSourceIndex(
  populationIndex: number,
  representativeSourceIndices?: Uint32Array,
): number | null {
  if (!Number.isSafeInteger(populationIndex) || populationIndex < 0) {
    return null;
  }
  if (representativeSourceIndices === undefined) {
    return populationIndex;
  }
  return populationIndex < representativeSourceIndices.length
    ? representativeSourceIndices[populationIndex]!
    : null;
}

export function createParallelWebgpuInspectionResult(
  buffers: ParallelBuffers,
  sourceIndex: number,
  pair: number,
  axisPosition: number,
  distancePx: number,
  viewports: ParallelAxisViewports,
): ParallelNearestRecordResult {
  const startAxis = buffers.axisOrder[pair]!;
  const endAxis = buffers.axisOrder[pair + 1]!;
  const activeAxisIndex = Math.max(
    0,
    Math.min(buffers.axisCount - 1, Math.round(axisPosition)),
  );
  const activeAxis = buffers.axisOrder[activeAxisIndex]!;
  const start = viewportNormalizedValue(
    buffers,
    startAxis,
    sourceIndex,
    viewports,
  );
  const end = viewportNormalizedValue(
    buffers,
    endAxis,
    sourceIndex,
    viewports,
  );
  const projection = Math.max(0, Math.min(1, axisPosition - pair));
  const record = buffers.recordIdentityBySourceIndex?.[sourceIndex];
  return {
    activeAxis,
    activeAxisValue:
      buffers.rawValuesByAxis[activeAxis]?.[sourceIndex] ?? Number.NaN,
    distancePx,
    id: buffers.ids[sourceIndex] ?? String(sourceIndex),
    normalizedAxisValue: readParallelNormalizedValue(
      buffers,
      activeAxis,
      sourceIndex,
    ),
    projectedAxisPosition: pair + projection,
    projectedNormalizedValue: interpolateParallelRenderedNormalizedValue(
      start,
      end,
      projection,
    ),
    ...(record === undefined ? {} : { record }),
    recordIndex: sourceIndex,
    segmentEndAxis: endAxis,
    segmentStartAxis: startAxis,
  };
}

export function resolveParallelWebgpuHoverPairRange(
  axisCount: number,
  axisPosition: number,
  maxDistancePx: number,
  plotWidthPx: number,
): { count: number; start: number } {
  const pairCount = Math.max(0, axisCount - 1);
  if (pairCount === 0) return { count: 0, start: 0 };
  const base = Math.max(0, Math.min(pairCount - 1, Math.floor(axisPosition)));
  const axisSpacing = plotWidthPx / Math.max(1, axisCount - 1);
  const nearestAxis = Math.round(axisPosition);
  const nearAxis = nearestAxis > 0 && nearestAxis < axisCount - 1 &&
    Math.abs(axisPosition - nearestAxis) * axisSpacing <= maxDistancePx;
  return nearAxis
    ? { count: 2, start: nearestAxis - 1 }
    : { count: 1, start: base };
}

export function resolveParallelWebgpuInspectionGeometry(
  buffers: ParallelBuffers,
  sourceIndex: number,
  query: {
    axisPosition: number;
    normalizedValue: number;
    plotHeightPx: number;
    plotWidthPx: number;
  },
  viewports: ParallelAxisViewports,
  pairRange: { count: number; start: number },
): { distancePx: number; pair: number } | null {
  if (pairRange.count === 0 || buffers.axisCount < 2) return null;
  const axisSpan = Math.max(1, buffers.axisCount - 1);
  const pointerX = query.axisPosition / axisSpan * query.plotWidthPx;
  const pointerY = (
    1 - parallelRenderedNormalizedValueToDisplayValue(query.normalizedValue)
  ) * query.plotHeightPx;
  let best: { distancePx: number; pair: number } | null = null;
  for (let offset = 0; offset < pairRange.count; offset += 1) {
    const pair = pairRange.start + offset;
    if (pair < 0 || pair >= buffers.axisCount - 1) continue;
    const startValue = viewportNormalizedValue(
      buffers,
      buffers.axisOrder[pair]!,
      sourceIndex,
      viewports,
    );
    const endValue = viewportNormalizedValue(
      buffers,
      buffers.axisOrder[pair + 1]!,
      sourceIndex,
      viewports,
    );
    const startX = pair / axisSpan * query.plotWidthPx;
    const endX = (pair + 1) / axisSpan * query.plotWidthPx;
    const startY = (
      1 - parallelRenderedNormalizedValueToDisplayValue(startValue)
    ) * query.plotHeightPx;
    const endY = (
      1 - parallelRenderedNormalizedValueToDisplayValue(endValue)
    ) * query.plotHeightPx;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const denominator = Math.max(
      Number.EPSILON,
      deltaX * deltaX + deltaY * deltaY,
    );
    const projection = Math.max(0, Math.min(1,
      ((pointerX - startX) * deltaX + (pointerY - startY) * deltaY) /
        denominator,
    ));
    const distance = Math.hypot(
      pointerX - (startX + deltaX * projection),
      pointerY - (startY + deltaY * projection),
    );
    if (best === null || distance < best.distancePx) {
      best = { distancePx: distance, pair };
    }
  }
  return best;
}

function viewportNormalizedValue(
  buffers: ParallelBuffers,
  axis: string,
  sourceIndex: number,
  viewports: ParallelAxisViewports,
): number {
  const normalized = readParallelNormalizedValue(buffers, axis, sourceIndex);
  if (!Number.isFinite(normalized)) {
    return PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y;
  }
  const viewport = viewports[axis];
  const domain = buffers.domainsByAxis[axis];
  if (viewport === null || viewport === undefined || domain === undefined) {
    return projectParallelRenderedNormalizedValue(normalized);
  }
  const raw = buffers.rawValuesByAxis[axis]?.[sourceIndex] ?? Number.NaN;
  return projectParallelViewportNormalizedValue(
    (raw - viewport.min) / Math.max(Number.EPSILON, viewport.max - viewport.min),
  );
}
