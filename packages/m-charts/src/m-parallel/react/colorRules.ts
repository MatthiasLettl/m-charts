import type { ParallelBuffers } from '../core/index.js';

export type ParallelColorRule =
  | {
      axis: string;
      color: string;
      id: string;
      kind: 'fixed';
      range: { max: number; min: number };
    }
  | {
      axis: string;
      endColor: string;
      id: string;
      kind: 'gradient';
      range: { max: number; min: number };
      startColor: string;
    };

const BYTES_PER_RGBA_COLOR = 4;
const FALLBACK_PARALLEL_LINE_COLOR = { a: 255, b: 170, g: 95, r: 25 };

export function applyParallelColorRules(
  buffers: ParallelBuffers,
  rules: readonly ParallelColorRule[],
): ParallelBuffers {
  if (rules.length === 0) {
    return buffers;
  }

  const color = createParallelRouteColorBuffer(buffers);
  const opacity =
    buffers.styleBuffers?.opacity === undefined
      ? createUnitOpacityBuffer(buffers.recordCount)
      : new Float32Array(buffers.styleBuffers.opacity);

  for (const rule of rules) {
    const values = buffers.rawValuesByAxis[rule.axis];
    if (values === undefined) {
      continue;
    }
    const rangeMin = Math.min(rule.range.min, rule.range.max);
    const rangeMax = Math.max(rule.range.min, rule.range.max);
    if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) {
      continue;
    }
    for (let index = 0; index < buffers.recordCount; index += 1) {
      const value = readParallelComparableValue(values[index]);
      if (value === null || value < rangeMin || value > rangeMax) {
        continue;
      }
      const alpha = color[index * BYTES_PER_RGBA_COLOR + 3] ?? 255;
      writeRgba8(color, index, {
        ...resolveRuleColor(rule, value),
        a: alpha,
      });
    }
  }

  return {
    ...buffers,
    styleBuffers: {
      color,
      colorFormat: 'rgba8',
      opacity,
      styledRecordCount: buffers.recordCount,
    },
  };
}

function createParallelRouteColorBuffer(buffers: ParallelBuffers): Uint8Array {
  if (buffers.styleBuffers?.color !== undefined) {
    return new Uint8Array(buffers.styleBuffers.color);
  }

  const color = new Uint8Array(buffers.recordCount * BYTES_PER_RGBA_COLOR);
  for (let index = 0; index < buffers.recordCount; index += 1) {
    writeRgba8(color, index, FALLBACK_PARALLEL_LINE_COLOR);
  }
  return color;
}

function createUnitOpacityBuffer(recordCount: number): Float32Array {
  const opacity = new Float32Array(recordCount);
  opacity.fill(1);
  return opacity;
}

function readParallelComparableValue(
  value: bigint | boolean | number | string | null | undefined,
): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'string') {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }
  return null;
}

function resolveRuleColor(
  rule: ParallelColorRule,
  value: number,
): { a: number; b: number; g: number; r: number } {
  if (rule.kind === 'fixed') {
    return parseHexColor(rule.color);
  }

  const start = parseHexColor(rule.startColor);
  const end = parseHexColor(rule.endColor);
  const rangeMin = Math.min(rule.range.min, rule.range.max);
  const rangeMax = Math.max(rule.range.min, rule.range.max);
  const span = rangeMax - rangeMin;
  const t = span <= 0 ? 0 : Math.min(1, Math.max(0, (value - rangeMin) / span));

  return {
    a: Math.round(start.a + (end.a - start.a) * t),
    b: Math.round(start.b + (end.b - start.b) * t),
    g: Math.round(start.g + (end.g - start.g) * t),
    r: Math.round(start.r + (end.r - start.r) * t),
  };
}

function parseHexColor(color: string): { a: number; b: number; g: number; r: number } {
  const normalized = color.trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return FALLBACK_PARALLEL_LINE_COLOR;
  }
  return {
    a: 255,
    b: Number.parseInt(hex.slice(4, 6), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    r: Number.parseInt(hex.slice(0, 2), 16),
  };
}

function writeRgba8(
  color: Uint8Array,
  index: number,
  rgba: { a: number; b: number; g: number; r: number },
): void {
  const offset = index * BYTES_PER_RGBA_COLOR;
  color[offset] = rgba.r;
  color[offset + 1] = rgba.g;
  color[offset + 2] = rgba.b;
  color[offset + 3] = rgba.a;
}
