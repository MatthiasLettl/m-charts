import type { AxisRange } from '../state/viewSearchParams.ts';
import type { ScatterRecord, ScatterYAttribute } from './types.ts';

export const RENDERING_MODES = ['auto', 'points', 'density'] as const;

export type RenderingMode = (typeof RENDERING_MODES)[number];
export type EffectiveRenderingMode = Exclude<RenderingMode, 'auto'>;

export const DEFAULT_DENSITY_COLUMNS = 192;
export const DEFAULT_DENSITY_ROWS = 96;
export const DEFAULT_MAX_DENSITY_RECORDS = 250_000;
export const DEFAULT_DENSITY_VISIBLE_POINT_THRESHOLD = 750;
export const DEFAULT_DENSITY_POINTS_PER_PIXEL_THRESHOLD = 0.75;

export interface VisibleRecordIndexRange {
  count: number;
  end: number;
  start: number;
}

export interface DensityGridOptions {
  columns?: number;
  maxBinnedRecords?: number;
  rows?: number;
}

export interface DensityGrid {
  columns: number;
  maxBinCount: number;
  rows: number;
  sampledPointCount: number;
  stride: number;
  values: Float32Array;
  visiblePointCount: number;
}

export interface RenderingModeDecisionInput {
  plotWidthPx: number;
  pointsPerPixelThreshold?: number;
  requestedMode: RenderingMode;
  visiblePointCount: number;
  visiblePointThreshold?: number;
}

export function decideEffectiveRenderingMode({
  plotWidthPx,
  pointsPerPixelThreshold = DEFAULT_DENSITY_POINTS_PER_PIXEL_THRESHOLD,
  requestedMode,
  visiblePointCount,
  visiblePointThreshold = DEFAULT_DENSITY_VISIBLE_POINT_THRESHOLD,
}: RenderingModeDecisionInput): EffectiveRenderingMode {
  if (requestedMode === 'points' || requestedMode === 'density') {
    return requestedMode;
  }

  const pointsPerPixel = calculatePointsPerPixel(visiblePointCount, plotWidthPx);

  return visiblePointCount >= visiblePointThreshold ||
    pointsPerPixel >= pointsPerPixelThreshold
    ? 'density'
    : 'points';
}

export function calculatePointsPerPixel(
  visiblePointCount: number,
  plotWidthPx: number,
): number {
  return visiblePointCount / Math.max(1, plotWidthPx);
}

export function findVisibleRecordIndexRange(
  records: readonly ScatterRecord[],
  xRange: AxisRange,
): VisibleRecordIndexRange {
  const range = normalizeAxisRange(xRange);
  const start = lowerBoundX(records, range.min);
  const end = upperBoundX(records, range.max, start);

  return {
    count: Math.max(0, end - start),
    end,
    start,
  };
}

export function createDensityGrid(
  records: readonly ScatterRecord[],
  attribute: ScatterYAttribute,
  xRange: AxisRange,
  yRange: AxisRange,
  options: DensityGridOptions = {},
): DensityGrid {
  const columns = Math.max(1, Math.floor(options.columns ?? DEFAULT_DENSITY_COLUMNS));
  const rows = Math.max(1, Math.floor(options.rows ?? DEFAULT_DENSITY_ROWS));
  const maxBinnedRecords = Math.max(
    1,
    Math.floor(options.maxBinnedRecords ?? DEFAULT_MAX_DENSITY_RECORDS),
  );
  const values = new Float32Array(columns * rows);
  const visibleRange = findVisibleRecordIndexRange(records, xRange);
  const x = normalizeAxisRange(xRange);
  const y = normalizeAxisRange(yRange);
  const xSpan = x.max - x.min;
  const ySpan = y.max - y.min;

  if (visibleRange.count === 0 || xSpan <= 0 || ySpan <= 0) {
    return {
      columns,
      maxBinCount: 0,
      rows,
      sampledPointCount: 0,
      stride: 1,
      values,
      visiblePointCount: visibleRange.count,
    };
  }

  const stride = Math.max(1, Math.ceil(visibleRange.count / maxBinnedRecords));
  let maxBinCount = 0;
  let sampledPointCount = 0;

  for (
    let recordIndex = visibleRange.start;
    recordIndex < visibleRange.end;
    recordIndex += stride
  ) {
    const record = records[recordIndex];
    const yValue = record[attribute];

    if (yValue < y.min || yValue > y.max) {
      continue;
    }

    const xBin = clampBinIndex(((record.x - x.min) / xSpan) * columns, columns);
    const yBin = clampBinIndex(((yValue - y.min) / ySpan) * rows, rows);
    const valueIndex = xBin * rows + yBin;
    const weight = Math.min(stride, visibleRange.end - recordIndex);
    const nextBinCount = values[valueIndex] + weight;

    values[valueIndex] = nextBinCount;
    maxBinCount = Math.max(maxBinCount, nextBinCount);
    sampledPointCount += 1;
  }

  if (maxBinCount > 0) {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.log1p(values[index]);
    }
  }

  return {
    columns,
    maxBinCount,
    rows,
    sampledPointCount,
    stride,
    values,
    visiblePointCount: visibleRange.count,
  };
}

function lowerBoundX(records: readonly ScatterRecord[], target: number): number {
  let low = 0;
  let high = records.length;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);

    if (records[middle].x < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function upperBoundX(
  records: readonly ScatterRecord[],
  target: number,
  start = 0,
): number {
  let low = start;
  let high = records.length;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);

    if (records[middle].x <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function normalizeAxisRange(range: AxisRange): AxisRange {
  return range.min <= range.max
    ? range
    : {
        max: range.min,
        min: range.max,
      };
}

function clampBinIndex(value: number, binCount: number): number {
  return Math.max(0, Math.min(binCount - 1, Math.floor(value)));
}
