export interface RecordIdentityLookupPayload {
  iSample?: unknown;
  lookupValue?: unknown;
  sample?: {
    recordIndex?: unknown;
  };
}

export interface SingleTableRecordIdentity {
  id: string;
  sourceIndex: number;
  table: string;
  tableKey?: string;
}

export interface RecordIdentityResolveOptions {
  allowSampleIndexFallback?: boolean;
  recordCount: number;
}

export function createLazySingleValueArray<T>(
  length: number,
  value: T,
): readonly T[] {
  return createLazyIndexedArray(length, () => value);
}

export function createLazySingleTableRecordIdentityArray(
  ids: readonly string[],
  tableName: string,
): readonly SingleTableRecordIdentity[] {
  return createLazyIndexedArray(ids.length, (sourceIndex) => ({
    id: ids[sourceIndex] ?? String(sourceIndex),
    sourceIndex,
    table: tableName,
  }));
}

export function resolveRecordIndexFromLookupPayload(
  payload: RecordIdentityLookupPayload | null | undefined,
  options: RecordIdentityResolveOptions,
): number | null {
  if (!payload) {
    return null;
  }

  if (isUsableRecordIndex(payload.lookupValue, options.recordCount)) {
    return payload.lookupValue;
  }

  if (isUsableRecordIndex(payload.sample?.recordIndex, options.recordCount)) {
    return payload.sample.recordIndex;
  }

  if (
    options.allowSampleIndexFallback === true &&
    isUsableRecordIndex(payload.iSample, options.recordCount)
  ) {
    return payload.iSample;
  }

  return null;
}

export function isUsableRecordIndex(
  value: unknown,
  recordCount: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < recordCount
  );
}

function createLazyIndexedArray<T>(
  length: number,
  getValue: (index: number) => T,
): readonly T[] {
  const normalizedLength = Math.max(0, Math.floor(length));

  return new Proxy(new Array<T>(normalizedLength), {
    get(target, property, receiver) {
      if (typeof property === 'string' && isArrayIndex(property, normalizedLength)) {
        return getValue(Number(property));
      }

      return Reflect.get(target, property, receiver);
    },
    getOwnPropertyDescriptor(target, property) {
      if (typeof property === 'string' && isArrayIndex(property, normalizedLength)) {
        return {
          configurable: true,
          enumerable: true,
          value: getValue(Number(property)),
          writable: false,
        };
      }

      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    has(target, property) {
      return (
        (typeof property === 'string' && isArrayIndex(property, normalizedLength)) ||
        Reflect.has(target, property)
      );
    },
  });
}

function isArrayIndex(property: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/u.test(property)) {
    return false;
  }
  const index = Number(property);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}
