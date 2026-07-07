import type {
  HistogramBinDescriptor,
  HistogramParameterSpec,
  HistogramRange,
} from './types.js';

export interface HistogramAxisTick {
  readonly label: string;
  readonly value: number;
}

const ONE_SECOND_MS = 1000;
const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

export function createHistogramAxisTicks(
  parameter: HistogramParameterSpec | undefined,
  range: HistogramRange,
  count = 5,
): readonly HistogramAxisTick[] {
  if (parameter === undefined || parameter.kind === 'numeric') {
    return createNumericTicks(parameter, range, count);
  }
  if (parameter.kind === 'datetime-ns') {
    return createDatetimeTicks(parameter, range, count);
  }
  return createCategoryTicks(parameter, range);
}

export function formatHistogramAxisValue(
  parameter: HistogramParameterSpec | undefined,
  value: number,
): string {
  if (parameter === undefined || parameter.kind === 'numeric') {
    return formatNumericValue(value, parameter?.unit);
  }
  if (parameter.kind === 'datetime-ns') {
    return formatDatetimeAxisValue(parameter, value);
  }
  return formatCategoryValue(parameter, value);
}

export function formatHistogramBinLabel(
  parameter: HistogramParameterSpec | undefined,
  descriptor: HistogramBinDescriptor,
): string {
  if (descriptor.category !== undefined) {
    return formatCategoryLabel(descriptor.category.value, descriptor.category.label);
  }
  return formatHistogramAxisValue(parameter, descriptor.center);
}

export function formatHistogramBinRange(
  parameter: HistogramParameterSpec | undefined,
  descriptor: HistogramBinDescriptor,
): string {
  if (descriptor.category !== undefined) {
    return formatCategoryLabel(descriptor.category.value, descriptor.category.label);
  }
  return `${formatHistogramAxisValue(parameter, descriptor.min)} to ${formatHistogramAxisValue(parameter, descriptor.max)}`;
}

function createNumericTicks(
  parameter: HistogramParameterSpec | undefined,
  range: HistogramRange,
  count: number,
): readonly HistogramAxisTick[] {
  const safeCount = Math.max(2, Math.floor(count));
  const span = Math.max(1e-9, range.max - range.min);
  return Array.from({ length: safeCount }, (_, index) => {
    const value = range.min + (span * index) / (safeCount - 1);
    return {
      label: formatNumericValue(value, parameter?.unit),
      value,
    };
  });
}

function createDatetimeTicks(
  parameter: HistogramParameterSpec,
  range: HistogramRange,
  count: number,
): readonly HistogramAxisTick[] {
  const safeCount = Math.max(2, Math.floor(count));
  const span = Math.max(1e-9, range.max - range.min);
  const precision = selectDatetimeTickPrecision(span);
  return Array.from({ length: safeCount }, (_, index) => {
    const value = range.min + (span * index) / (safeCount - 1);
    return {
      label: formatDatetimeTickValue(parameter, value, precision),
      value,
    };
  });
}

function createCategoryTicks(
  parameter: HistogramParameterSpec,
  range: HistogramRange,
): readonly HistogramAxisTick[] {
  return (parameter.categories ?? [])
    .filter((category) => category.encoded >= range.min && category.encoded <= range.max)
    .map((category) => ({
      label: formatCategoryLabel(category.value, category.label),
      value: category.encoded,
    }));
}

function formatCategoryValue(
  parameter: HistogramParameterSpec,
  encodedValue: number,
): string {
  const category = (parameter.categories ?? []).find(
    (candidate) => candidate.encoded === Math.round(encodedValue),
  );
  if (category === undefined) {
    return String(encodedValue);
  }
  return formatCategoryLabel(category.value, category.label);
}

function formatCategoryLabel(
  value: boolean | number | string,
  fallbackLabel: string | undefined,
): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return fallbackLabel ?? String(value);
}

function formatNumericValue(value: number, unit: string | undefined): string {
  const magnitude = Math.abs(value);
  const formatted =
    magnitude >= 1000
      ? value.toFixed(0)
      : magnitude >= 10
        ? value.toFixed(1)
        : value.toFixed(2);
  return unit === undefined || unit === '' ? formatted : `${formatted} ${unit}`;
}

function formatDatetimeAxisValue(
  parameter: HistogramParameterSpec,
  encodedMs: number,
): string {
  const origin = BigInt(parameter.datetimeOriginNs ?? '0');
  const epochNs = origin + BigInt(Math.round(encodedMs * 1_000_000));
  return formatDatetimeNsEpochValue(epochNs);
}

type DatetimeTickPrecision = 'date' | 'minute' | 'second' | 'fractional';

function selectDatetimeTickPrecision(spanMs: number): DatetimeTickPrecision {
  if (spanMs >= ONE_DAY_MS) {
    return 'date';
  }
  if (spanMs >= ONE_HOUR_MS) {
    return 'minute';
  }
  if (spanMs >= ONE_SECOND_MS) {
    return 'second';
  }
  return 'fractional';
}

function formatDatetimeTickValue(
  parameter: HistogramParameterSpec,
  encodedMs: number,
  precision: DatetimeTickPrecision,
): string {
  const origin = BigInt(parameter.datetimeOriginNs ?? '0');
  const epochNs = origin + BigInt(Math.round(encodedMs * 1_000_000));
  const parts = getUtcDateTimeParts(epochNs);
  if (precision === 'date') {
    return parts.date;
  }
  if (precision === 'minute') {
    return `${parts.hour}:${parts.minute}`;
  }
  if (precision === 'second') {
    return `${parts.hour}:${parts.minute}:${parts.second}`;
  }
  const fractional = parts.fractionalSecond.replace(/0+$/, '');
  return `${parts.hour}:${parts.minute}:${parts.second}${fractional === '' ? '' : `.${fractional}`}`;
}

function getUtcDateTimeParts(epochNs: bigint): {
  readonly date: string;
  readonly fractionalSecond: string;
  readonly hour: string;
  readonly minute: string;
  readonly second: string;
} {
  const epochMs = epochNs / 1_000_000n;
  const subMsNs = epochNs % 1_000_000n;
  const date = new Date(Number(epochMs));
  return {
    date: date.toISOString().slice(0, 10),
    fractionalSecond: `${date.getUTCMilliseconds().toString().padStart(3, '0')}${subMsNs.toString().padStart(6, '0')}`,
    hour: date.getUTCHours().toString().padStart(2, '0'),
    minute: date.getUTCMinutes().toString().padStart(2, '0'),
    second: date.getUTCSeconds().toString().padStart(2, '0'),
  };
}

function formatDatetimeNsEpochValue(epochNs: bigint): string {
  const epochMs = epochNs / 1_000_000n;
  const subMsNs = epochNs % 1_000_000n;
  const date = new Date(Number(epochMs));
  const fractionalSecond = `${date.getUTCMilliseconds().toString().padStart(3, '0')}${subMsNs.toString().padStart(6, '0')}`.replace(
    /0+$/u,
    '',
  );
  const iso = date.toISOString().slice(0, 19);
  return fractionalSecond === '' ? `${iso}Z` : `${iso}.${fractionalSecond}Z`;
}
