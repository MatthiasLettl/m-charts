import type { AxisRange } from '../state/viewSearchParams.ts';
import type { ScatterRecord, ScatterYAttribute } from './types.ts';

export const MAX_PINNED_HOVER_RECORDS = 3;

export interface AxisPoint {
  x: number;
  y: number;
}

export interface NearestRecordQuery {
  attribute: ScatterYAttribute;
  axisPoint: AxisPoint;
  maxDistancePx: number;
  plotHeightPx: number;
  plotWidthPx: number;
  records: readonly ScatterRecord[];
  xRange: AxisRange;
  yRange: AxisRange;
}

export interface NearestRecordResult {
  distancePx: number;
  record: ScatterRecord;
}

export interface PinnedHoverRecord {
  activeAttribute: ScatterYAttribute;
  record: ScatterRecord;
}

export function findNearestRecord({
  attribute,
  axisPoint,
  maxDistancePx,
  plotHeightPx,
  plotWidthPx,
  records,
  xRange,
  yRange,
}: NearestRecordQuery): NearestRecordResult | null {
  if (
    records.length === 0 ||
    maxDistancePx < 0 ||
    plotWidthPx <= 0 ||
    plotHeightPx <= 0 ||
    !isFiniteRange(xRange) ||
    !isFiniteRange(yRange) ||
    !Number.isFinite(axisPoint.x) ||
    !Number.isFinite(axisPoint.y)
  ) {
    return null;
  }

  const xSpan = xRange.max - xRange.min;
  const ySpan = yRange.max - yRange.min;
  const xTolerance = (maxDistancePx / plotWidthPx) * xSpan;
  const xMin = axisPoint.x - xTolerance;
  const xMax = axisPoint.x + xTolerance;
  const startIndex = lowerBoundByX(records, xMin);
  let nearest: NearestRecordResult | null = null;
  let nearestDistanceSquared = maxDistancePx * maxDistancePx;

  for (let index = startIndex; index < records.length; index += 1) {
    const record = records[index];
    const recordX = record.x;

    if (recordX > xMax) {
      break;
    }

    const recordY = record[attribute];

    if (!Number.isFinite(recordX) || !Number.isFinite(recordY)) {
      continue;
    }

    const distanceX = ((recordX - axisPoint.x) / xSpan) * plotWidthPx;
    const distanceY = ((recordY - axisPoint.y) / ySpan) * plotHeightPx;
    const distanceSquared = distanceX * distanceX + distanceY * distanceY;

    if (distanceSquared <= nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared;
      nearest = {
        distancePx: Math.sqrt(distanceSquared),
        record,
      };
    }
  }

  return nearest;
}

export function pinHoverRecord(
  currentPins: readonly PinnedHoverRecord[],
  nextPin: PinnedHoverRecord,
  maxPins = MAX_PINNED_HOVER_RECORDS,
): PinnedHoverRecord[] {
  if (maxPins <= 0) {
    return [];
  }

  const dedupedPins = currentPins.filter(
    (pin) => pin.record.id !== nextPin.record.id,
  );

  return [nextPin, ...dedupedPins].slice(0, maxPins);
}

function lowerBoundByX(records: readonly ScatterRecord[], target: number): number {
  let low = 0;
  let high = records.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);

    if (records[mid].x < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function isFiniteRange(range: AxisRange): boolean {
  return (
    Number.isFinite(range.min) &&
    Number.isFinite(range.max) &&
    range.max > range.min
  );
}
