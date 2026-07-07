import type {
  FastScatterCategoricalAxis,
  FastScatterDatetimeNsAxis,
  FastScatterEncodedAxis,
  FastScatterNumericAxis,
} from './axisSchema.js';
import type { FastScatterRange } from './types.js';

export interface FastScatterAxisTick {
  label: string;
  value: number;
}

export interface FastScatterAxisTickOptions {
  count?: number;
  range: FastScatterRange;
}

export interface FastScatterDatetimeTickContext {
  sharedDateLabel?: string;
}

export function createFastScatterAxisTicks(
  axis: FastScatterEncodedAxis | undefined,
  options: FastScatterAxisTickOptions,
): FastScatterAxisTick[] {
  if (axis === undefined || axis.kind === 'numeric') {
    return createNumericTicks(axis, options);
  }

  if (axis.kind === 'datetime-ns') {
    return createDatetimeNsTicks(axis, options);
  }

  return createCategoricalTicks(axis, options.range);
}

export function formatFastScatterAxisValue(
  axis: FastScatterEncodedAxis | undefined,
  encodedValue: number,
): string {
  if (axis === undefined || axis.kind === 'numeric') {
    return formatNumericValue(encodedValue, axis?.unit);
  }

  if (axis.kind === 'datetime-ns') {
    return formatDatetimeNsValue(axis, encodedValue);
  }

  const category = axis.categories.find(
    (candidate) => candidate.encoded === Math.round(encodedValue),
  );

  if (axis.kind === 'boolean') {
    return formatBooleanCategoryLabel(category?.value, encodedValue);
  }

  return category?.label ?? String(encodedValue);
}

export function formatFastScatterDatetimeNsEpochValue(epochNsValue: string): string {
  const epochNs = BigInt(epochNsValue);

  return formatDatetimeNsEpochValue(epochNs);
}

export function createFastScatterDatetimeTickContext(
  axis: FastScatterEncodedAxis | undefined,
  { count = 5, range }: FastScatterAxisTickOptions,
): FastScatterDatetimeTickContext {
  if (axis?.kind !== 'datetime-ns') {
    return {};
  }

  const ticks = createDatetimeNsTicks(axis, { count, range });
  const sharedDateLabel = getSharedUtcDateLabel(axis, ticks);

  return sharedDateLabel === undefined ? {} : { sharedDateLabel };
}

function createNumericTicks(
  axis: FastScatterNumericAxis | undefined,
  { count = 5, range }: FastScatterAxisTickOptions,
): FastScatterAxisTick[] {
  const safeCount = Math.max(2, Math.floor(count));
  const span = Math.max(1e-9, range.max - range.min);

  return Array.from({ length: safeCount }, (_, index) => {
    const value = range.min + (span * index) / (safeCount - 1);

    return {
      label: formatNumericValue(value, axis?.unit),
      value,
    };
  });
}

function createCategoricalTicks(
  axis: FastScatterCategoricalAxis,
  range: FastScatterRange,
): FastScatterAxisTick[] {
  return axis.categories
    .filter((category) => category.encoded >= range.min && category.encoded <= range.max)
    .map((category) => ({
      label:
        axis.kind === 'boolean'
          ? formatBooleanCategoryLabel(category.value, category.encoded)
          : category.label,
      value: category.encoded,
    }));
}

function formatBooleanCategoryLabel(
  categoryValue: string | undefined,
  encodedValue: number,
): string {
  if (categoryValue === 'false' || categoryValue === 'true') {
    return categoryValue;
  }

  return Math.round(encodedValue) === 0 ? 'false' : 'true';
}

function createDatetimeNsTicks(
  axis: FastScatterDatetimeNsAxis,
  { count = 5, range }: FastScatterAxisTickOptions,
): FastScatterAxisTick[] {
  const safeCount = Math.max(2, Math.floor(count));
  const span = Math.max(1e-9, range.max - range.min);
  const precision = selectDatetimeTickPrecision(span);

  return Array.from({ length: safeCount }, (_, index) => {
    const value = range.min + (span * index) / (safeCount - 1);

    return {
      label: formatDatetimeNsTickValue(axis, value, precision),
      value,
    };
  });
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

function formatDatetimeNsValue(
  axis: FastScatterDatetimeNsAxis,
  encodedMs: number,
): string {
  const offsetNs = BigInt(Math.round(encodedMs * 1_000_000));
  const epochNs = axis.datetimeOriginNsBigInt + offsetNs;

  return formatDatetimeNsEpochValue(epochNs);
}

type DatetimeTickPrecision = 'date' | 'minute' | 'second' | 'fractional';

const ONE_SECOND_MS = 1000;
const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

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

function formatDatetimeNsTickValue(
  axis: FastScatterDatetimeNsAxis,
  encodedMs: number,
  precision: DatetimeTickPrecision,
): string {
  const epochNs = axis.datetimeOriginNsBigInt + BigInt(Math.round(encodedMs * 1_000_000));
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

function getSharedUtcDateLabel(
  axis: FastScatterDatetimeNsAxis,
  ticks: readonly FastScatterAxisTick[],
): string | undefined {
  if (ticks.length === 0) {
    return undefined;
  }

  const dates = new Set(
    ticks.map((tick) =>
      getUtcDateTimeParts(
        axis.datetimeOriginNsBigInt + BigInt(Math.round(tick.value * 1_000_000)),
      ).date,
    ),
  );

  if (dates.size !== 1) {
    return undefined;
  }

  const [date] = dates;

  return date === undefined ? undefined : `${date} UTC`;
}

function getUtcDateTimeParts(epochNs: bigint): {
  date: string;
  fractionalSecond: string;
  hour: string;
  minute: string;
  second: string;
} {
  const epochMs = epochNs / 1_000_000n;
  const subMsNs = epochNs % 1_000_000n;
  const iso = new Date(Number(epochMs)).toISOString();

  return {
    date: iso.slice(0, 10),
    fractionalSecond: `${iso.slice(20, 23)}${subMsNs.toString().padStart(6, '0')}`,
    hour: iso.slice(11, 13),
    minute: iso.slice(14, 16),
    second: iso.slice(17, 19),
  };
}

function formatDatetimeNsEpochValue(epochNs: bigint): string {
  const epochMs = epochNs / 1_000_000n;
  const subMsNs = epochNs % 1_000_000n;
  const date = new Date(Number(epochMs));
  const iso = date.toISOString();

  if (subMsNs === 0n) {
    return iso.replace('T', ' ').replace('Z', ' UTC');
  }

  const nsRemainder = subMsNs.toString().padStart(6, '0');

  return `${iso.replace('Z', '')}${nsRemainder} UTC`;
}
