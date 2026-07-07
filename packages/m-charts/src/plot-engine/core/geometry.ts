export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Range {
  min: number;
  max: number;
}

export interface Rect extends Point, Size {}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeRange(range: Range): Range {
  return range.min <= range.max ? range : { min: range.max, max: range.min };
}

export function rangeSpan(range: Range): number {
  return range.max - range.min;
}

export function rangeContains(range: Range, value: number): boolean {
  const normalized = normalizeRange(range);
  return value >= normalized.min && value <= normalized.max;
}

export function rangesIntersect(a: Range, b: Range): boolean {
  const left = normalizeRange(a);
  const right = normalizeRange(b);
  return left.min <= right.max && right.min <= left.max;
}

export function normalizeRect(rect: Rect): Rect {
  const x = rect.width >= 0 ? rect.x : rect.x + rect.width;
  const y = rect.height >= 0 ? rect.y : rect.y + rect.height;
  return {
    height: Math.abs(rect.height),
    width: Math.abs(rect.width),
    x,
    y,
  };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return normalizeRect({
    height: b.y - a.y,
    width: b.x - a.x,
    x: a.x,
    y: a.y,
  });
}

export function rectContainsPoint(rect: Rect, point: Point): boolean {
  const normalized = normalizeRect(rect);
  return (
    point.x >= normalized.x &&
    point.x <= normalized.x + normalized.width &&
    point.y >= normalized.y &&
    point.y <= normalized.y + normalized.height
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  const left = normalizeRect(a);
  const right = normalizeRect(b);
  return (
    left.x <= right.x + right.width &&
    right.x <= left.x + left.width &&
    left.y <= right.y + right.height &&
    right.y <= left.y + left.height
  );
}

export function clampPointToRect(point: Point, rect: Rect): Point {
  const normalized = normalizeRect(rect);
  return {
    x: clamp(point.x, normalized.x, normalized.x + normalized.width),
    y: clamp(point.y, normalized.y, normalized.y + normalized.height),
  };
}

