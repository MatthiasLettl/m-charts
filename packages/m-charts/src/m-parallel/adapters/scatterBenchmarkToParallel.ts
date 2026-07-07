import {
  createParallelFastBuffers,
  type CreateParallelBuffersOptions,
  type ParallelBuffers,
  type ParallelFastAxisSpec,
  type ParallelFastColumns,
} from '../core/index.js';
import type {
  FastScatterEncodedAxis,
  FastScatterEncodedSchemaColumns,
  FastScatterPlotSpec,
} from '../../m-scatter/core/index.js';

const DEFAULT_SCATTER_BENCHMARK_TABLE_NAME = 'benchmark-primary';

export interface ScatterBenchmarkParallelAdapterResult {
  buffers: ParallelBuffers;
  columns: ParallelFastColumns;
  metadata: {
    recordCount: number;
    tableBySourceIndex: readonly string[];
    tableNames: readonly string[];
    tableRecordCounts: Readonly<Record<string, number>>;
  };
}

export function adaptScatterBenchmarkForParallelFast(
  input: {
    columns: FastScatterEncodedSchemaColumns & {
      recordIdentityBySourceIndex?: readonly {
        id: string;
        sourceIndex: number;
        table: string;
      }[];
      tableBySourceIndex?: readonly string[];
    };
    spec: FastScatterPlotSpec;
    tableName?: string;
  },
  options: CreateParallelBuffersOptions = {},
): ScatterBenchmarkParallelAdapterResult {
  const tableName = input.tableName ?? DEFAULT_SCATTER_BENCHMARK_TABLE_NAME;
  const axisOrder = [
    input.columns.xKey,
    ...input.spec.plots.map((plot) => plot.yKey),
  ];
  const axes = axisOrder.map((axisKey) =>
    createParallelAxisSpec(input.columns.axisByColumn[axisKey], axisKey),
  );
  const tableBySourceIndex =
    input.columns.tableBySourceIndex ??
    createLazySingleValueArray(input.columns.ids.length, tableName);
  const recordIdentityBySourceIndex =
    input.columns.recordIdentityBySourceIndex ??
    createLazySingleTableRecordIdentityArray(input.columns.ids, tableName);
  const columns: ParallelFastColumns = {
    axes,
    axisOrder,
    color: input.columns.color,
    colorFormat: input.columns.colorFormat ?? 'rgba8',
    ids: input.columns.ids,
    opacity: input.columns.opacity,
    recordIdentityBySourceIndex,
    tableBySourceIndex,
    valuesByAxis: Object.fromEntries(
      axisOrder.map((axisKey) => {
        const axis = input.columns.axisByColumn[axisKey];
        const values =
          axisKey === input.columns.xKey ? input.columns.x : input.columns.y[axisKey]!;

        return [axisKey, materializeParallelAxisValues(axis, values)];
      }),
    ),
  };

  return {
    buffers: createParallelFastBuffers(columns, options),
    columns,
    metadata: {
      recordCount: input.columns.ids.length,
      tableBySourceIndex,
      tableNames: [tableName],
      tableRecordCounts: {
        [tableName]: input.columns.ids.length,
      },
    },
  };
}

function materializeParallelAxisValues(
  axis: FastScatterEncodedAxis | undefined,
  values: Float64Array,
): Float64Array | readonly (boolean | number | string | undefined)[] {
  if (axis === undefined || axis.kind === 'numeric') {
    return values;
  }

  if (axis.kind === 'datetime-ns') {
    return axis.epochNsValues;
  }

  return new Proxy(
    { length: values.length },
    {
      get(target, property) {
        if (property === 'length') {
          return target.length;
        }
        if (typeof property === 'string' && /^\d+$/u.test(property)) {
          const index = Number(property);
          if (index >= target.length) {
            return undefined;
          }
          const encoded = values[index];
          if (!Number.isFinite(encoded)) {
            return undefined;
          }
          const category = axis.categories.find((candidate) => candidate.encoded === encoded);
          if (category === undefined) {
            return undefined;
          }

          return axis.kind === 'boolean' ? category.value === 'true' : category.value;
        }

        return undefined;
      },
    },
  ) as unknown as readonly (boolean | number | string | undefined)[];
}

function createParallelAxisSpec(
  axis: FastScatterEncodedAxis | undefined,
  axisKey: string,
): ParallelFastAxisSpec {
  if (axis === undefined) {
    throw new Error(`Scatter-fast benchmark axis "${axisKey}" is missing.`);
  }

  if (axis.kind === 'categorical' || axis.kind === 'boolean') {
    return {
      categories: axis.categories.map((category) => ({
        label: category.label,
        order: category.encoded,
        value: category.value,
      })),
      key: axis.columnKey,
      kind: axis.kind,
      label: axis.title,
      ...(axis.source === undefined ? {} : { source: axis.source }),
      unit: axis.unit,
    };
  }

  return {
    key: axis.columnKey,
    kind: axis.kind,
    label: axis.title,
    ...(axis.source === undefined ? {} : { source: axis.source }),
    unit: axis.unit,
  };
}

function createLazySingleValueArray<T>(
  length: number,
  value: T,
): readonly T[] {
  return createLazyIndexedArray(length, () => value);
}

function createLazySingleTableRecordIdentityArray(
  ids: readonly string[],
  tableName: string,
): ParallelFastColumns['recordIdentityBySourceIndex'] {
  return createLazyIndexedArray(ids.length, (sourceIndex) => ({
    id: ids[sourceIndex] ?? String(sourceIndex),
    sourceIndex,
    table: tableName,
  }));
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
