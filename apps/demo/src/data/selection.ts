import type { ScatterRecord, ScatterYAttribute } from './types.ts';

export interface NumericRange {
  max: number;
  min: number;
}

export interface SelectionBounds {
  attribute: ScatterYAttribute;
  x: NumericRange;
  y: NumericRange;
}

export interface SelectionPoint {
  x: number;
  y: number;
}

export interface SelectionPolygon {
  attribute: ScatterYAttribute;
  points: readonly SelectionPoint[];
}

export interface SelectionResult {
  attribute: ScatterYAttribute;
  bounds: SelectionBounds;
  ids: string[];
}

export function selectRecordIdsInBounds(
  records: readonly ScatterRecord[],
  bounds: SelectionBounds,
): SelectionResult {
  const normalizedBounds = normalizeSelectionBounds(bounds);
  const ids: string[] = [];

  for (const record of records) {
    if (
      isWithinInclusive(record.x, normalizedBounds.x) &&
      isWithinInclusive(record[normalizedBounds.attribute], normalizedBounds.y)
    ) {
      ids.push(record.id);
    }
  }

  return {
    attribute: normalizedBounds.attribute,
    bounds: normalizedBounds,
    ids,
  };
}

export function selectRecordIdsInPolygon(
  records: readonly ScatterRecord[],
  polygon: SelectionPolygon,
): SelectionResult {
  const bounds = getSelectionPolygonBounds(polygon);

  if (bounds === null) {
    return {
      attribute: polygon.attribute,
      bounds: {
        attribute: polygon.attribute,
        x: { min: 0, max: 0 },
        y: { min: 0, max: 0 },
      },
      ids: [],
    };
  }

  const ids: string[] = [];

  for (const record of records) {
    const point = { x: record.x, y: record[polygon.attribute] };

    if (
      isWithinInclusive(point.x, bounds.x) &&
      isWithinInclusive(point.y, bounds.y) &&
      isPointInPolygon(point, polygon.points)
    ) {
      ids.push(record.id);
    }
  }

  return {
    attribute: polygon.attribute,
    bounds,
    ids,
  };
}

export function normalizeSelectionBounds(bounds: SelectionBounds): SelectionBounds {
  return {
    attribute: bounds.attribute,
    x: normalizeRange(bounds.x),
    y: normalizeRange(bounds.y),
  };
}

export function getSelectionPolygonBounds(
  polygon: SelectionPolygon,
): SelectionBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let validPointCount = 0;

  for (const point of polygon.points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }

    validPointCount += 1;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  if (validPointCount < 3) {
    return null;
  }

  return {
    attribute: polygon.attribute,
    x: { min: minX, max: maxX },
    y: { min: minY, max: maxY },
  };
}

export function isPointInPolygon(
  point: SelectionPoint,
  polygon: readonly SelectionPoint[],
): boolean {
  if (
    polygon.length < 3 ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    return false;
  }

  let isInside = false;
  let previous = polygon[polygon.length - 1];

  for (const current of polygon) {
    if (
      !Number.isFinite(current.x) ||
      !Number.isFinite(current.y) ||
      !Number.isFinite(previous.x) ||
      !Number.isFinite(previous.y)
    ) {
      previous = current;
      continue;
    }

    if (isPointOnSegment(point, previous, current)) {
      return true;
    }

    const crossesRay =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;

    if (crossesRay) {
      isInside = !isInside;
    }

    previous = current;
  }

  return isInside;
}

export function sampleRecordIds(
  ids: Iterable<string>,
  limit: number,
): string[] {
  if (limit <= 0) {
    return [];
  }

  const sample: string[] = [];

  for (const id of ids) {
    sample.push(id);

    if (sample.length >= limit) {
      break;
    }
  }

  return sample;
}

export function serializeRecordIdsForExport(ids: Iterable<string>): string {
  return Array.from(ids).join('\n');
}

function normalizeRange(range: NumericRange): NumericRange {
  return range.min <= range.max
    ? { min: range.min, max: range.max }
    : { min: range.max, max: range.min };
}

function isWithinInclusive(value: number, range: NumericRange): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

function isPointOnSegment(
  point: SelectionPoint,
  start: SelectionPoint,
  end: SelectionPoint,
): boolean {
  const cross =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y);

  if (Math.abs(cross) > 1e-9) {
    return false;
  }

  return (
    point.x >= Math.min(start.x, end.x) - 1e-9 &&
    point.x <= Math.max(start.x, end.x) + 1e-9 &&
    point.y >= Math.min(start.y, end.y) - 1e-9 &&
    point.y <= Math.max(start.y, end.y) + 1e-9
  );
}
