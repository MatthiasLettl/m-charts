import type { FastScatterDisplayColumns, FastScatterRange } from '../core/index.js';

export type ScatterColorRule =
  | {
      color: string;
      id: string;
      kind: 'fixed';
      parameterKey: string;
      range: FastScatterRange;
    }
  | {
      endColor: string;
      id: string;
      kind: 'gradient';
      parameterKey: string;
      range: FastScatterRange;
      startColor: string;
    };

const FALLBACK_POINT_COLOR = { a: 255, b: 191, g: 111, r: 31 };

export function applyScatterColorRules(
  columns: FastScatterDisplayColumns,
  rules: readonly ScatterColorRule[],
): FastScatterDisplayColumns {
  if (rules.length === 0) {
    return columns;
  }

  const color = createScatterRouteColorBuffer(columns);
  for (const rule of rules) {
    const values = getScatterColorRuleValues(columns, rule.parameterKey);
    if (values === null) {
      continue;
    }
    const rangeMin = Math.min(rule.range.min, rule.range.max);
    const rangeMax = Math.max(rule.range.min, rule.range.max);
    if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) {
      continue;
    }
    if (rule.kind === 'fixed') {
      const rgba = parseHexColor(rule.color);
      for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value === undefined || value < rangeMin || value > rangeMax) {
          continue;
        }
        writeRgba8(color, index, rgba);
      }
      continue;
    }

    const start = parseHexColor(rule.startColor);
    const end = parseHexColor(rule.endColor);
    const span = rangeMax - rangeMin;
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (value === undefined || value < rangeMin || value > rangeMax) {
        continue;
      }
      const t = span <= 0 ? 0 : Math.min(1, Math.max(0, (value - rangeMin) / span));
      writeRgba8(color, index, {
        a: Math.round(start.a + (end.a - start.a) * t),
        b: Math.round(start.b + (end.b - start.b) * t),
        g: Math.round(start.g + (end.g - start.g) * t),
        r: Math.round(start.r + (end.r - start.r) * t),
      });
    }
  }

  return {
    ...columns,
    color,
    colorFormat: 'rgba8',
  };
}

function createScatterRouteColorBuffer(columns: FastScatterDisplayColumns): Uint8Array {
  const pointCount = columns.x.length;
  if (columns.color instanceof Uint8Array && columns.color.length >= pointCount * 4) {
    return new Uint8Array(columns.color);
  }
  const color = new Uint8Array(pointCount * 4);
  for (let index = 0; index < pointCount; index += 1) {
    writeRgba8(color, index, FALLBACK_POINT_COLOR);
  }
  return color;
}

function getScatterColorRuleValues(
  columns: FastScatterDisplayColumns,
  parameterKey: string,
): Float32Array | Float64Array | null {
  if (columns.y[parameterKey] !== undefined) {
    return columns.y[parameterKey]!;
  }
  if (columns.xKey === parameterKey) {
    return columns.x;
  }
  return null;
}

function parseHexColor(color: string): { a: number; b: number; g: number; r: number } {
  const normalized = color.trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return FALLBACK_POINT_COLOR;
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
  const offset = index * 4;
  color[offset] = rgba.r;
  color[offset + 1] = rgba.g;
  color[offset + 2] = rgba.b;
  color[offset + 3] = rgba.a;
}
