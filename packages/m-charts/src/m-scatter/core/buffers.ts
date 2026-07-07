import type {
  FastScatterPointColumns,
  FastScatterShapeCode,
  FastScatterTypedNumericArray,
} from './types.js';

export const FAST_SCATTER_SHAPE_CODES = {
  arrow: 4,
  circle: 0,
  pin: 3,
  rectangle: 1,
  triangle: 2,
} as const satisfies Record<string, FastScatterShapeCode>;

export type FastScatterShapeName = keyof typeof FAST_SCATTER_SHAPE_CODES;

export interface FastScatterBufferBuildRecord {
  color?: string;
  id: string;
  opacity?: number | null;
  rotation?: number | null;
  shape?: FastScatterShapeName | number | null;
  size?: number | null;
  x: number;
}

export interface FastScatterBufferStyleLimits {
  opacity?: {
    max: number;
    min: number;
  };
  rotationDegrees?: {
    max: number;
    min: number;
  };
  size?: {
    max: number;
    min: number;
  };
}

export interface FastScatterBufferBuildMetrics {
  buildMs: number;
  byteLength: number;
  recordCount: number;
  yKeyCount: number;
}

export interface FastScatterBufferBuildResult extends FastScatterPointColumns {
  metrics: FastScatterBufferBuildMetrics;
  recordCount: number;
  sourceIndex: Uint32Array;
  y: Readonly<Record<string, Float64Array>>;
  color: Uint8Array;
  colorFormat: 'rgba8';
  opacity: Float32Array;
  size: Float32Array;
  rotation: Float32Array;
  rotationDegrees: Float32Array;
  rotationRadians: Float32Array;
  shape: Uint8Array;
  x: Float64Array;
}

export interface CreateFastScatterBuffersOptions<
  TRecord extends FastScatterBufferBuildRecord,
> {
  styleLimits?: FastScatterBufferStyleLimits;
  validateSortedX?: boolean;
  yAccessors: Readonly<Record<string, (record: TRecord) => number>>;
}

const DEFAULT_OPACITY = 1;
const DEFAULT_POINT_SIZE = 4;
const DEFAULT_ROTATION_DEGREES = 0;
const DEFAULT_SHAPE_CODE = FAST_SCATTER_SHAPE_CODES.circle;
const BYTES_PER_RGBA_COLOR = 4;
const DEGREES_TO_RADIANS = Math.PI / 180;

export function createFastScatterBuffers<
  TRecord extends FastScatterBufferBuildRecord,
>(
  records: readonly TRecord[],
  options: CreateFastScatterBuffersOptions<TRecord>,
): FastScatterBufferBuildResult {
  const buildStartedAt = performance.now();
  const recordCount = records.length;
  const yKeys = Object.keys(options.yAccessors);
  const ids = new Array<string>(recordCount);
  const x = new Float64Array(recordCount);
  const y = createYColumns(yKeys, recordCount);
  const color = new Uint8Array(recordCount * BYTES_PER_RGBA_COLOR);
  const opacity = new Float32Array(recordCount);
  const size = new Float32Array(recordCount);
  const rotationDegrees = new Float32Array(recordCount);
  const rotationRadians = new Float32Array(recordCount);
  const shape = new Uint8Array(recordCount);
  const sourceIndex = new Uint32Array(recordCount);

  let previousX = Number.NEGATIVE_INFINITY;

  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    const record = records[recordIndex];
    const xValue = record.x;

    assertFiniteNumber(xValue, `Scatter x at source index ${recordIndex}`);
    if (options.validateSortedX !== false && xValue < previousX) {
      throw new Error(
        `Scatter records must be sorted by nondecreasing x; source index ${recordIndex} has x ${xValue} after ${previousX}.`,
      );
    }
    previousX = xValue;

    ids[recordIndex] = record.id;
    x[recordIndex] = xValue;
    sourceIndex[recordIndex] = recordIndex;

    for (const yKey of yKeys) {
      const yValue = options.yAccessors[yKey](record);
      assertFiniteNumber(
        yValue,
        `Scatter y "${yKey}" at source index ${recordIndex}`,
      );
      y[yKey][recordIndex] = yValue;
    }

    packRgba8Color(color, recordIndex, record.color);
    opacity[recordIndex] = clampStyleValue(
      record.opacity,
      DEFAULT_OPACITY,
      options.styleLimits?.opacity,
      `Scatter opacity at source index ${recordIndex}`,
    );
    size[recordIndex] = clampStyleValue(
      record.size,
      DEFAULT_POINT_SIZE,
      options.styleLimits?.size,
      `Scatter size at source index ${recordIndex}`,
    );

    const degrees = clampStyleValue(
      record.rotation,
      DEFAULT_ROTATION_DEGREES,
      options.styleLimits?.rotationDegrees,
      `Scatter rotation at source index ${recordIndex}`,
    );
    rotationDegrees[recordIndex] = normalizeRotationDegrees(degrees);
    rotationRadians[recordIndex] = normalizeRotationRadians(degrees * DEGREES_TO_RADIANS);
    shape[recordIndex] = normalizeShapeCode(record.shape, recordIndex);
  }

  const buildMs = performance.now() - buildStartedAt;
  const byteLength =
    x.byteLength +
    sumColumnByteLengths(y) +
    color.byteLength +
    opacity.byteLength +
    size.byteLength +
    rotationDegrees.byteLength +
    rotationRadians.byteLength +
    shape.byteLength +
    sourceIndex.byteLength;

  return {
    ids,
    x,
    y,
    color,
    colorFormat: 'rgba8',
    opacity,
    size,
    rotation: rotationRadians,
    rotationDegrees,
    rotationRadians,
    shape,
    sourceIndex,
    metrics: {
      buildMs,
      byteLength,
      recordCount,
      yKeyCount: yKeys.length,
    },
    recordCount,
  };
}

function createYColumns(
  yKeys: readonly string[],
  recordCount: number,
): Record<string, Float64Array> {
  const y: Record<string, Float64Array> = {};

  for (const yKey of yKeys) {
    y[yKey] = new Float64Array(recordCount);
  }

  return y;
}

export function packRgba8Color(
  rgba: Uint8Array,
  recordIndex: number,
  color: string | undefined,
): void {
  const offset = recordIndex * BYTES_PER_RGBA_COLOR;
  const parsed = parseHexRgb(color);
  rgba[offset] = parsed.r;
  rgba[offset + 1] = parsed.g;
  rgba[offset + 2] = parsed.b;
  rgba[offset + 3] = 255;
}

export function normalizeRotationDegrees(degrees: number): number {
  assertFiniteNumber(degrees, 'Scatter rotation');
  const normalized = degrees % 360;

  return normalized < 0 ? normalized + 360 : normalized;
}

export function normalizeRotationRadians(radians: number): number {
  assertFiniteNumber(radians, 'Scatter rotation');
  const fullTurn = Math.PI * 2;
  const normalized = radians % fullTurn;

  return normalized < 0 ? normalized + fullTurn : normalized;
}

function parseHexRgb(color: string | undefined): {
  b: number;
  g: number;
  r: number;
} {
  if (color === undefined) {
    return { b: 255, g: 255, r: 255 };
  }

  const match = /^#(?<r>[0-9a-f]{2})(?<g>[0-9a-f]{2})(?<b>[0-9a-f]{2})$/iu.exec(
    color,
  );

  if (match?.groups === undefined) {
    throw new Error(`Scatter color must use #RRGGBB format; received "${color}".`);
  }

  return {
    b: Number.parseInt(match.groups.b, 16),
    g: Number.parseInt(match.groups.g, 16),
    r: Number.parseInt(match.groups.r, 16),
  };
}

function clampStyleValue(
  value: number | null | undefined,
  fallback: number,
  limits: { max: number; min: number } | undefined,
  label: string,
): number {
  const normalized = value ?? fallback;
  assertFiniteNumber(normalized, label);

  if (limits === undefined) {
    return normalized;
  }

  return Math.min(limits.max, Math.max(limits.min, normalized));
}

function normalizeShapeCode(
  shape: FastScatterShapeName | number | null | undefined,
  recordIndex: number,
): FastScatterShapeCode {
  if (shape === null || shape === undefined) {
    return DEFAULT_SHAPE_CODE;
  }

  if (typeof shape === 'number') {
    if (Number.isInteger(shape) && shape >= 0 && shape <= 4) {
      return shape as FastScatterShapeCode;
    }

    throw new Error(
      `Scatter shape code at source index ${recordIndex} must be 0, 1, 2, 3, or 4.`,
    );
  }

  const code = FAST_SCATTER_SHAPE_CODES[shape];

  if (code === undefined) {
    throw new Error(
      `Scatter shape at source index ${recordIndex} must be circle, rectangle, triangle, pin, or arrow.`,
    );
  }

  return code;
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
}

function sumColumnByteLengths(
  columns: Readonly<Record<string, FastScatterTypedNumericArray>>,
): number {
  let byteLength = 0;

  for (const column of Object.values(columns)) {
    byteLength += column.byteLength;
  }

  return byteLength;
}
