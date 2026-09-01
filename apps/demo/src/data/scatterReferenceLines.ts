import type {
  FastScatterEncodedAxis,
  FastScatterReferenceLine,
} from 'm-charts/m-scatter';

const NS_PER_MS = 1_000_000;
const DATETIME_REFERENCE_SPACE_ID = 'demo-time';

export type ScatterReferenceLineXMode = 'index' | 'value';

export interface ScatterReferenceLineAxisContext {
  axis: FastScatterEncodedAxis | undefined;
  xKey: string | null;
  xMode: ScatterReferenceLineXMode;
}

export type ScatterReferenceLineCoordinate =
  | {
      epochNs: string;
      kind: 'datetime-ns';
      referenceSpaceId: string;
    }
  | {
      kind: 'encoded';
      referenceSpaceId: string;
      value: number;
    };

export interface ScatterReferenceLineRecord
  extends Omit<FastScatterReferenceLine, 'value'> {
  coordinate: ScatterReferenceLineCoordinate;
}

export function createScatterReferenceLineCoordinate(
  value: number,
  context: ScatterReferenceLineAxisContext,
): ScatterReferenceLineCoordinate {
  if (context.xMode === 'value' && context.axis?.kind === 'datetime-ns') {
    return {
      epochNs: encodedDatetimeToEpochNs(value, context.axis),
      kind: 'datetime-ns',
      referenceSpaceId: DATETIME_REFERENCE_SPACE_ID,
    };
  }

  return {
    kind: 'encoded',
    referenceSpaceId: getScatterReferenceSpaceId(context),
    value,
  };
}

export function projectScatterReferenceLine(
  record: ScatterReferenceLineRecord,
  context: ScatterReferenceLineAxisContext,
): FastScatterReferenceLine | null {
  if (record.coordinate.referenceSpaceId !== getScatterReferenceSpaceId(context)) {
    return null;
  }

  const value = record.coordinate.kind === 'datetime-ns'
    ? context.axis?.kind === 'datetime-ns'
      ? epochNsToEncodedDatetime(record.coordinate.epochNs, context.axis)
      : Number.NaN
    : record.coordinate.value;
  if (!Number.isFinite(value)) return null;

  const { coordinate: _coordinate, ...line } = record;
  void _coordinate;
  return { ...line, value };
}

export function updateScatterReferenceLineCoordinate(
  coordinate: ScatterReferenceLineCoordinate,
  value: number,
  context: ScatterReferenceLineAxisContext,
): ScatterReferenceLineCoordinate {
  if (
    !Number.isFinite(value) ||
    coordinate.referenceSpaceId !== getScatterReferenceSpaceId(context)
  ) {
    return coordinate;
  }

  if (coordinate.kind === 'datetime-ns') {
    return context.axis?.kind === 'datetime-ns'
      ? {
          ...coordinate,
          epochNs: encodedDatetimeToEpochNs(value, context.axis),
        }
      : coordinate;
  }

  return { ...coordinate, value };
}

export function getScatterReferenceSpaceId(
  context: ScatterReferenceLineAxisContext,
): string {
  return context.xMode === 'value' && context.axis?.kind === 'datetime-ns'
    ? DATETIME_REFERENCE_SPACE_ID
    : `encoded:${context.xMode}:${context.xKey ?? 'unknown'}:${context.axis?.kind ?? 'unknown'}`;
}

export function parseScatterReferenceLineRecords(
  serialized: string | null,
): readonly ScatterReferenceLineRecord[] {
  if (serialized === null) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    return Array.isArray(parsed)
      ? parsed.flatMap((value) => {
          const record = parseScatterReferenceLineRecord(value);
          return record === null ? [] : [record];
        })
      : [];
  } catch {
    return [];
  }
}

function parseScatterReferenceLineRecord(value: unknown): ScatterReferenceLineRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const input = value as Record<string, unknown>;
  if (input.axis !== 'x' || typeof input.id !== 'string' || input.id.trim().length === 0) {
    return null;
  }
  const coordinate = parseScatterReferenceLineCoordinate(input.coordinate);
  if (coordinate === null) return null;

  return {
    axis: 'x',
    coordinate,
    ...(typeof input.draggable === 'boolean' ? { draggable: input.draggable } : {}),
    id: input.id,
    ...(typeof input.label === 'string' ? { label: input.label } : {}),
    ...(Array.isArray(input.plotIds) && input.plotIds.every((item) => typeof item === 'string')
      ? { plotIds: input.plotIds }
      : {}),
    ...(isScatterReferenceLineStyle(input.style) ? { style: input.style } : {}),
  };
}

function parseScatterReferenceLineCoordinate(
  value: unknown,
): ScatterReferenceLineCoordinate | null {
  if (typeof value !== 'object' || value === null) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.referenceSpaceId !== 'string' ||
    input.referenceSpaceId.length === 0
  ) {
    return null;
  }
  if (
    input.kind === 'datetime-ns' &&
    typeof input.epochNs === 'string' &&
    /^-?\d+$/u.test(input.epochNs)
  ) {
    return {
      epochNs: input.epochNs,
      kind: 'datetime-ns',
      referenceSpaceId: input.referenceSpaceId,
    };
  }
  if (input.kind === 'encoded' && typeof input.value === 'number' && Number.isFinite(input.value)) {
    return {
      kind: 'encoded',
      referenceSpaceId: input.referenceSpaceId,
      value: input.value,
    };
  }
  return null;
}

function isScatterReferenceLineStyle(
  value: unknown,
): value is NonNullable<FastScatterReferenceLine['style']> {
  if (typeof value !== 'object' || value === null) return false;
  const style = value as Record<string, unknown>;
  return (
    (style.color === undefined || typeof style.color === 'string') &&
    (style.dash === undefined ||
      (Array.isArray(style.dash) && style.dash.every(
        (item) => typeof item === 'number' && Number.isFinite(item),
      ))) &&
    (style.opacity === undefined ||
      (typeof style.opacity === 'number' && Number.isFinite(style.opacity))) &&
    (style.widthCssPx === undefined ||
      (typeof style.widthCssPx === 'number' && Number.isFinite(style.widthCssPx)))
  );
}

function encodedDatetimeToEpochNs(
  value: number,
  axis: Extract<FastScatterEncodedAxis, { kind: 'datetime-ns' }>,
): string {
  const scaleMs = axis.encodedScaleMs ?? 1;
  const offsetNs = BigInt(Math.round(value * scaleMs * NS_PER_MS));
  return (axis.datetimeOriginNsBigInt + offsetNs).toString();
}

function epochNsToEncodedDatetime(
  epochNs: string,
  axis: Extract<FastScatterEncodedAxis, { kind: 'datetime-ns' }>,
): number {
  const scaleMs = axis.encodedScaleMs ?? 1;
  return Number(BigInt(epochNs) - axis.datetimeOriginNsBigInt) / (scaleMs * NS_PER_MS);
}
