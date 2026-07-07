import type {
  HistogramAggregationSet,
  HistogramBinDescriptor,
  HistogramColumns,
  HistogramParameterSpec,
  HistogramRange,
} from '../core/index.js';

export type HistogramColorRule =
  | {
      color: string;
      binDescriptors?: readonly HistogramBinDescriptor[];
      id: string;
      kind: 'fixed';
      parameterKey: string;
      range: HistogramRange;
    }
  | {
      endColor: string;
      binDescriptors?: readonly HistogramBinDescriptor[];
      id: string;
      kind: 'gradient';
      parameterKey: string;
      range: HistogramRange;
      startColor: string;
    };

const FALLBACK_HISTOGRAM_COLOR = { a: 255, b: 255, g: 99, r: 37 };

export function applyHistogramColorRules(
  columns: HistogramColumns | undefined,
  rules: readonly HistogramColorRule[],
): HistogramColumns | undefined {
  if (columns === undefined || rules.length === 0) {
    return columns;
  }

  const color = createHistogramRouteColorBuffer(columns);
  for (const rule of rules) {
    const values = columns.valuesByParameter[rule.parameterKey];
    if (values === undefined) {
      continue;
    }
    applyRuleToRows({
      color,
      getValue: (index) =>
        readHistogramComparableValue(values[index], columns.parameters, rule.parameterKey),
      rowCount: columns.ids.length,
      rule,
    });
  }

  return {
    ...columns,
    color,
    colorFormat: 'rgba8',
  };
}

export function applyHistogramAggregationColorRules(
  aggregation: HistogramAggregationSet | undefined,
  rules: readonly HistogramColorRule[],
): HistogramAggregationSet | undefined {
  if (aggregation === undefined || rules.length === 0) {
    return aggregation;
  }

  return {
    ...aggregation,
    subplots: aggregation.subplots.map((subplot) => ({
      ...subplot,
      bins: subplot.bins.map((bin) => {
        const rule = rules.find(
          (candidate) =>
            candidate.parameterKey === bin.descriptor.parameterKey &&
            aggregationRuleMatchesBin(candidate, bin.descriptor),
        );
        if (rule === undefined || bin.stack.length === 0) {
          return bin;
        }
        const value = bin.descriptor.center;
        const nextColor = resolveRuleColor(rule, value);
        return {
          ...bin,
          stack: bin.stack.map((segment) => ({
            ...segment,
            color: packRgba32(nextColor),
          })),
        };
      }),
    })),
  };
}

function aggregationRuleMatchesBin(
  rule: HistogramColorRule,
  bin: HistogramBinDescriptor,
): boolean {
  if (rule.binDescriptors !== undefined && rule.binDescriptors.length > 0) {
    const binKey = createHistogramBinDescriptorKey(bin);
    return rule.binDescriptors.some(
      (descriptor) => createHistogramBinDescriptorKey(descriptor) === binKey,
    );
  }
  return rangesOverlap(rule.range, {
    max: bin.max,
    min: bin.min,
  });
}

function createHistogramBinDescriptorKey(descriptor: HistogramBinDescriptor): string {
  return [
    descriptor.subplotId,
    descriptor.parameterKey,
    descriptor.index,
    descriptor.min,
    descriptor.max,
    descriptor.source ?? '',
    descriptor.table ?? '',
  ].join('\u0000');
}

function applyRuleToRows({
  color,
  getValue,
  rowCount,
  rule,
}: {
  color: Uint8Array;
  getValue: (index: number) => number | null;
  rowCount: number;
  rule: HistogramColorRule;
}): void {
  const rangeMin = Math.min(rule.range.min, rule.range.max);
  const rangeMax = Math.max(rule.range.min, rule.range.max);
  if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) {
    return;
  }

  for (let index = 0; index < rowCount; index += 1) {
    const value = getValue(index);
    if (value === null || value < rangeMin || value > rangeMax) {
      continue;
    }
    writeRgba8(color, index, resolveRuleColor(rule, value));
  }
}

function resolveRuleColor(
  rule: HistogramColorRule,
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

function createHistogramRouteColorBuffer(columns: HistogramColumns): Uint8Array {
  const rowCount = columns.ids.length;
  if (columns.color instanceof Uint8Array && columns.color.length >= rowCount * 4) {
    return new Uint8Array(columns.color);
  }

  const color = new Uint8Array(rowCount * 4);
  if (columns.color instanceof Uint32Array) {
    for (let index = 0; index < rowCount; index += 1) {
      writeRgba8(color, index, unpackRgba32(columns.color[index] ?? 0));
    }
    return color;
  }

  for (let index = 0; index < rowCount; index += 1) {
    writeRgba8(color, index, FALLBACK_HISTOGRAM_COLOR);
  }
  return color;
}

function readHistogramComparableValue(
  value: bigint | boolean | number | string | null | undefined,
  parameters: readonly HistogramParameterSpec[] | undefined,
  parameterKey: string,
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
  if (typeof value !== 'string') {
    return null;
  }

  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    return numericValue;
  }

  const parameter = parameters?.find((candidate) => candidate.key === parameterKey);
  const category = parameter?.categories?.find(
    (candidate) => candidate.value === value || candidate.label === value,
  );
  return category?.encoded ?? null;
}

function rangesOverlap(
  left: HistogramRange,
  right: HistogramRange,
): boolean {
  const leftMin = Math.min(left.min, left.max);
  const leftMax = Math.max(left.min, left.max);
  const rightMin = Math.min(right.min, right.max);
  const rightMax = Math.max(right.min, right.max);
  return leftMin <= rightMax && rightMin <= leftMax;
}

function parseHexColor(color: string): { a: number; b: number; g: number; r: number } {
  const normalized = color.trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return FALLBACK_HISTOGRAM_COLOR;
  }
  return {
    a: 255,
    b: Number.parseInt(hex.slice(4, 6), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    r: Number.parseInt(hex.slice(0, 2), 16),
  };
}

function packRgba32(rgba: { a: number; b: number; g: number; r: number }): number {
  return (
    ((rgba.r & 0xff) << 24) |
    ((rgba.g & 0xff) << 16) |
    ((rgba.b & 0xff) << 8) |
    (rgba.a & 0xff)
  ) >>> 0;
}

function unpackRgba32(value: number): { a: number; b: number; g: number; r: number } {
  return {
    a: value & 0xff,
    b: (value >>> 8) & 0xff,
    g: (value >>> 16) & 0xff,
    r: (value >>> 24) & 0xff,
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
