import type {
  FastScatterPointColumns,
  FastScatterRange,
} from '../../m-scatter/core/index.js';
import type { FastScatterWebgpuPackedStyles } from './types.js';

export interface FastScatterWebgpuColumnEncoding {
  offset: number;
  scale: number;
}

export interface FastScatterWebgpuPackedStyle {
  color: number;
  meta: number;
  size: number;
}

/**
 * Expands a synchronous packed-style source for client-view base-style
 * composition. Values intentionally match the quantized style the GPU draws.
 */
export function unpackFastScatterWebgpuStyleColumns(
  packedStyles: Extract<FastScatterWebgpuPackedStyles, { readonly data: Uint32Array }>,
  pointCount: number,
): Pick<FastScatterPointColumns, 'color' | 'colorFormat' | 'opacity' | 'rotation' | 'shape' | 'size'> {
  const strideBytes = packedStyles.styleStrideBytes ?? (
    packedStyles.data.length === pointCount * 3 ? 12
      : packedStyles.data.length === pointCount * 2 ? 8 : 4
  );
  const wordsPerPoint = strideBytes / Uint32Array.BYTES_PER_ELEMENT;
  if (packedStyles.data.length !== pointCount * wordsPerPoint) {
    throw new TypeError(
      `Packed WebGPU styles contain ${packedStyles.data.length} words; expected ${pointCount * wordsPerPoint}.`,
    );
  }
  const color = new Uint32Array(pointCount);
  const opacity = new Float32Array(pointCount);
  const rotation = new Float32Array(pointCount);
  const shape = new Uint8Array(pointCount);
  const size = new Float32Array(pointCount);
  const legacyFloats = strideBytes === 12
    ? new Float32Array(
        packedStyles.data.buffer,
        packedStyles.data.byteOffset,
        packedStyles.data.byteLength / Float32Array.BYTES_PER_ELEMENT,
      )
    : null;
  for (let index = 0; index < pointCount; index += 1) {
    const offset = index * wordsPerPoint;
    if (strideBytes === 4) {
      const packed = packedStyles.data[offset] ?? 0;
      const red = Math.round(((packed & 0x1f) / 31) * 255);
      const green = Math.round((((packed >>> 5) & 0x3f) / 63) * 255);
      const blue = Math.round((((packed >>> 11) & 0x1f) / 31) * 255);
      color[index] = ((red << 24) | (green << 16) | (blue << 8) | 0xff) >>> 0;
      opacity[index] = ((packed >>> 16) & 0xf) / 15;
      shape[index] = (packed >>> 20) & 0x7;
      rotation[index] = (((packed >>> 23) & 0x3f) / 63) * Math.PI * 2 - Math.PI;
      size[index] = 1 + ((packed >>> 29) & 0x7);
      continue;
    }
    const packedColor = packedStyles.data[offset] ?? 0;
    color[index] = (
      ((packedColor & 0xff) << 24) |
      (((packedColor >>> 8) & 0xff) << 16) |
      (((packedColor >>> 16) & 0xff) << 8) |
      ((packedColor >>> 24) & 0xff)
    ) >>> 0;
    const meta = packedStyles.data[offset + 1] ?? 0;
    opacity[index] = (meta & 0xff) / 255;
    shape[index] = (meta >>> 8) & 0x7;
    if (strideBytes === 8) {
      rotation[index] = (((meta >>> 11) & 0x3ff) / 1023) * Math.PI * 2 - Math.PI;
      size[index] = ((meta >>> 21) & 0x7ff) / 4;
    } else {
      rotation[index] = (((meta >>> 16) & 0xffff) / 65535) * Math.PI * 2 - Math.PI;
      size[index] = Math.max(0, legacyFloats?.[offset + 2] ?? 0);
    }
  }
  return { color, colorFormat: 'rgba32', opacity, rotation, shape, size };
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
