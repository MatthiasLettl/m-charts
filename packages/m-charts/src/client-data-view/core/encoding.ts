import type { ClientDataField, ClientDataFieldKind, ClientDataValue } from './types.js';
import { datetimeBigInt, finiteNumeric } from './expressions.js';

export interface ClientAxisEncoding {
  kind: ClientDataFieldKind;
  categories?: readonly { encoded: number; label: string; value: string | number | boolean }[];
  datetimeOriginNs?: string;
  epochNsValues?: readonly (string | undefined)[];
  encodedScaleMs?: number;
  encodedScale?: number;
  encodedOffset?: number;
  domain?: { min: number; max: number };
}
const sources = new WeakMap<object, ArrayLike<number>>();

/** Decode display coordinates once; retain the original column for a no-op projection. */
export function decodeClientField(values: ArrayLike<ClientDataValue>, encoding?: ClientAxisEncoding): ClientDataField {
  const kind = encoding?.kind ?? 'numeric';
  if (kind === 'numeric' && encoding?.encodedScale === undefined && encoding?.encodedOffset === undefined) return { kind, values };
  const categories = new Map(encoding?.categories?.map((c) => [c.encoded, c.value]));
  const origin = encoding?.datetimeOriginNs === undefined ? null : BigInt(encoding.datetimeOriginNs);
  const decoded = Array.from({ length: values.length }, (_, row): ClientDataValue => {
    const value = values[row];
    if (value == null || typeof value === 'number' && !Number.isFinite(value)) return null;
    if (kind === 'boolean') return value === true || value === 1 ? true : value === false || value === 0 ? false : null;
    if (kind === 'categorical') {
      return typeof value === 'number' && encoding?.categories !== undefined ? categories.get(value) ?? null : value;
    }
    if (kind === 'datetime-ns') {
      if (encoding?.epochNsValues !== undefined) return datetimeBigInt(encoding.epochNsValues[row]);
      if (typeof value === 'number' && origin !== null) return origin + BigInt(Math.round(value * (encoding?.encodedScaleMs ?? 1) * 1_000_000));
      return datetimeBigInt(value);
    }
    const numeric = finiteNumeric(value);
    return numeric === null ? null : numeric * (encoding?.encodedScale ?? 1) + (encoding?.encodedOffset ?? 0);
  });
  // Encoded chart columns use numbers; semantic raw string arrays have no
  // reusable numeric representation and must be encoded on projection.
  if (ArrayBuffer.isView(values) || Array.from({ length: Math.min(values.length, 1) }, (_, i) => values[i]).every((v) => typeof v === 'number')) {
    sources.set(decoded, values as ArrayLike<number>);
  }
  return { kind, values: decoded };
}
export function originalClientValues(field: ClientDataField): ArrayLike<number> | undefined {
  return sources.get(field.values);
}

export function projectClientField(field: ClientDataField, source: ArrayLike<ClientDataValue>, encoding?: ClientAxisEncoding): {
  values: ArrayLike<number>;
  encoding: ClientAxisEncoding;
  changed: boolean;
} {
  if (field.values === source || originalClientValues(field) === source) {
    return { values: source as ArrayLike<number>, encoding: encoding ?? { kind: field.kind }, changed: false };
  }
  const categories = field.kind === 'boolean'
    ? [{ encoded: 0, label: 'False', value: false }, { encoded: 1, label: 'True', value: true }]
    : field.kind === 'categorical' ? [...(encoding?.kind === 'categorical' ? encoding.categories ?? [] : [])] : undefined;
  const categoryCodes = new Map(categories?.map((c) => [`${typeof c.value}:${c.value}`, c.encoded]));
  let nextCode = categories?.reduce((max, c) => Math.max(max, c.encoded + 1), 0) ?? 0;
  const values = new Float64Array(field.values.length);
  let min = Infinity; let max = -Infinity;
  let origin: bigint | null = encoding?.kind === 'datetime-ns' && encoding.datetimeOriginNs !== undefined ? BigInt(encoding.datetimeOriginNs) : null;
  if (field.kind === 'datetime-ns' && origin === null) for (let row = 0; row < values.length; row++) {
    origin = datetimeBigInt(field.values[row]); if (origin !== null) break;
  }
  const epochs: string[] | undefined = field.kind === 'datetime-ns' ? [] : undefined;
  for (let row = 0; row < values.length; row++) {
    const value = field.values[row];
    let numeric = finiteNumeric(value) ?? NaN;
    if (field.kind === 'categorical' && value != null) {
      const key = `${typeof value}:${value}`;
      let code = categoryCodes.get(key);
      if (code === undefined) { code = nextCode++; categoryCodes.set(key, code); categories!.push({ encoded: code, label: String(value), value: value as string | number | boolean }); }
      numeric = code;
    }
    if (field.kind === 'boolean') numeric = value === true || value === 1 ? 1 : value === false || value === 0 ? 0 : NaN;
    if (field.kind === 'datetime-ns') {
      const epoch = datetimeBigInt(value); epochs!.push(epoch?.toString() ?? '');
      numeric = epoch === null ? NaN : Number(epoch - (origin ?? 0n)) / 1_000_000;
    }
    values[row] = numeric;
    if (Number.isFinite(numeric)) { min = Math.min(min, numeric); max = Math.max(max, numeric); }
  }
  return { changed: true, values, encoding: {
    kind: field.kind, domain: { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 1 },
    ...(categories === undefined ? {} : { categories }),
    ...(epochs === undefined ? {} : { datetimeOriginNs: String(origin ?? 0n), epochNsValues: epochs }),
  } };
}
