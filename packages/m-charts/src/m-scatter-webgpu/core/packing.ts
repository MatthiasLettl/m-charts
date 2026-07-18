import type {
  FastScatterPointColumns,
  FastScatterRange,
} from '../../m-scatter/core/index.js';

export interface FastScatterWebgpuColumnEncoding {
  offset: number;
  scale: number;
}

export interface FastScatterWebgpuPackedStyle {
  color: number;
  meta: number;
  size: number;
}

export function packFastScatterWebgpuStyle(
  columns: FastScatterPointColumns,
  index: number,
  fallback: readonly [number, number, number, number],
): FastScatterWebgpuPackedStyle {
  const opacity = clamp(columns.opacity?.[index] ?? 1, 0, 1);
  const shape = clampInteger(columns.shape?.[index] ?? 0, 0, 4);
  const rotation = normalizeRotation(columns.rotation?.[index] ?? 0);
  const encodedRotation = clampInteger(
    Math.round(((rotation + Math.PI) / (Math.PI * 2)) * 1023),
    0,
    1023,
  );
  const size = Math.max(0, columns.size?.[index] ?? 4);
  const encodedSize = clampInteger(Math.round(size * 4), 0, 2047);
  return {
    color: resolvePackedColor(columns, index, fallback),
    meta:
      (Math.round(opacity * 255) | (shape << 8) |
        (encodedRotation << 11) | (encodedSize << 21)) >>> 0,
    size,
  };
}

export function calculateFastScatterWebgpuColumnEncoding(
  values: ArrayLike<number>,
): FastScatterWebgpuColumnEncoding {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? Number.NaN;
    if (Number.isFinite(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  const offset = Number.isFinite(min) ? min : 0;
  return {
    offset,
    scale: Number.isFinite(max) && max > offset ? max - offset : 1,
  };
}

export function encodeFastScatterWebgpuValue(
  value: number,
  encoding: FastScatterWebgpuColumnEncoding,
): number {
  return Number.isFinite(value)
    ? (value - encoding.offset) / encoding.scale
    : Number.NaN;
}

export function encodeFastScatterWebgpuRange(
  range: FastScatterRange,
  encoding: FastScatterWebgpuColumnEncoding,
): FastScatterRange {
  return {
    min: (range.min - encoding.offset) / encoding.scale,
    max: (range.max - encoding.offset) / encoding.scale,
  };
}

function resolvePackedColor(
  columns: FastScatterPointColumns,
  index: number,
  fallback: readonly [number, number, number, number],
): number {
  const color = columns.color;
  if (color instanceof Uint8Array) {
    const offset = index * 4;
    return packRgba(
      color[offset] ?? fallback[0],
      color[offset + 1] ?? fallback[1],
      color[offset + 2] ?? fallback[2],
      color[offset + 3] ?? fallback[3],
    );
  }
  if (color instanceof Uint32Array) {
    const packed = color[index] ?? 0x000000ff;
    return packRgba(
      (packed >>> 24) & 0xff,
      (packed >>> 16) & 0xff,
      (packed >>> 8) & 0xff,
      packed & 0xff,
    );
  }
  return packRgba(...fallback);
}

function packRgba(r: number, g: number, b: number, a: number): number {
  return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}

function normalizeRotation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const turn = Math.PI * 2;
  return ((value + Math.PI) % turn + turn) % turn - Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.floor(clamp(value, min, max));
}
