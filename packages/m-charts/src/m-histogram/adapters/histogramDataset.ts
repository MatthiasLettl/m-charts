import type {
  HistogramBarBinInput,
  HistogramBarSeries,
  HistogramColumns,
  HistogramParameterKind,
  HistogramParameterSpec,
  HistogramPlotSpec,
  HistogramTableKey,
  HistogramValueColumn,
} from '../core/index.js';
import { normalizeHistogramBarSeries } from '../core/index.js';
import {
  adaptMixedTablesForFastScatter,
  type FastPlotRecordIdentity,
  type FastScatterTableAdapterResult,
  type FastScatterTableFixture,
  type FastScatterTableLike,
} from '../../m-scatter/adapters/scatterDataset.js';
import type {
  FastScatterEncodedAxis,
  FastScatterEncodedSchemaColumns,
  FastScatterPlotSpec,
} from '../../m-scatter/core/index.js';

export interface LoadedScatterFastBenchmarkSource {
  readonly columns: FastScatterEncodedSchemaColumns & {
    readonly recordIdentityBySourceIndex?: readonly FastPlotRecordIdentity[];
    readonly tableBySourceIndex?: readonly HistogramTableKey[];
  };
  readonly spec: FastScatterPlotSpec;
  readonly tableName?: HistogramTableKey;
}

export interface HistogramDatasetAdapterMetadata {
  readonly recordCount: number;
  readonly tableNames: readonly HistogramTableKey[];
  readonly tableRecordCounts: Readonly<Record<HistogramTableKey, number>>;
}

export interface HistogramDatasetAdapterResult {
  readonly columns: HistogramColumns;
  readonly metadata: HistogramDatasetAdapterMetadata;
  readonly spec: HistogramPlotSpec;
}

export interface HistogramBarDemoPayload {
  readonly parameters: readonly HistogramBarDemoParameter[];
  readonly source?: string;
}

export interface HistogramBarDemoParameter {
  readonly bins: readonly HistogramBarDemoBin[];
  readonly key: string;
  readonly label?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly source?: string;
  readonly table?: HistogramTableKey;
  readonly unit?: string;
}

export interface HistogramBarDemoBin {
  readonly colorCounts?: Readonly<Record<string, number>>;
  readonly count?: number;
  readonly max?: number;
  readonly min?: number;
  readonly sourceIndices?: readonly number[] | Uint32Array;
}

export interface HistogramBarPayloadAdapterResult {
  readonly aggregation: ReturnType<typeof normalizeHistogramBarSeries>;
  readonly series: readonly HistogramBarSeries[];
  readonly spec: HistogramPlotSpec;
}

type HistogramEligibleEncodedAxis = Extract<
  FastScatterEncodedAxis,
  { kind: HistogramParameterKind }
>;

export function adaptScatterFastBenchmarkSourceForHistogram(
  source: Pick<LoadedScatterFastBenchmarkSource, 'columns' | 'spec' | 'tableName'>,
): HistogramDatasetAdapterResult {
  return adaptScatterEncodedColumnsForHistogram(source.columns, {
    scatterSpec: source.spec,
    tableName: source.tableName,
  });
}

export function adaptMixedTablesForHistogram(
  input: FastScatterTableFixture | readonly FastScatterTableLike[],
): HistogramDatasetAdapterResult {
  const scatter = adaptMixedTablesForFastScatter(input);
  return adaptScatterTableColumnsForHistogram(scatter);
}

export function adaptScatterTableColumnsForHistogram(
  scatter: FastScatterTableAdapterResult,
): HistogramDatasetAdapterResult {
  return adaptScatterEncodedColumnsForHistogram(scatter.columns, {
    scatterSpec: scatter.spec,
    tableRecordCounts: scatter.metadata.tableRecordCounts,
    tableNames: scatter.metadata.tableNames,
  });
}

export function adaptScatterEncodedColumnsForHistogram(
  columns: FastScatterEncodedSchemaColumns & {
    readonly recordIdentityBySourceIndex?: readonly FastPlotRecordIdentity[];
    readonly tableBySourceIndex?: readonly HistogramTableKey[];
  },
  options: {
    readonly scatterSpec?: FastScatterPlotSpec;
    readonly tableName?: HistogramTableKey;
    readonly tableNames?: readonly HistogramTableKey[];
    readonly tableRecordCounts?: Readonly<Record<HistogramTableKey, number>>;
  } = {},
): HistogramDatasetAdapterResult {
  const axes = getHistogramEligibleAxes(columns, options.scatterSpec);
  const parameters = axes.map(({ axis, key }) =>
    createHistogramParameterSpec(axis, key, columns.tableBySourceIndex),
  );

  return {
    columns: {
      color: columns.color,
      colorFormat: columns.colorFormat,
      ids: columns.ids,
      parameters,
      recordIdentityBySourceIndex: columns.recordIdentityBySourceIndex,
      sourceIndex: columns.sourceIndex,
      tableBySourceIndex: columns.tableBySourceIndex,
      valuesByParameter: Object.fromEntries(
        axes.map(({ key, values }) => [key, values]),
      ),
    },
    metadata: {
      recordCount: columns.ids.length,
      tableNames: resolveTableNames(columns.tableBySourceIndex, options.tableName, options.tableNames),
      tableRecordCounts: resolveTableRecordCounts(
        columns.ids.length,
        columns.tableBySourceIndex,
        options.tableName,
        options.tableRecordCounts,
      ),
    },
    spec: {
      mode: 'histogram',
      parameters,
      subplots: parameters.map((parameter) => ({
        id: parameter.key,
        label: parameter.label,
        parameterKey: parameter.key,
      })),
    },
  };
}

export function adaptHistogramBarDemoPayload(
  payload: HistogramBarDemoPayload,
): HistogramBarPayloadAdapterResult {
  const series: HistogramBarSeries[] = payload.parameters.map((parameter) => ({
    bins: parameter.bins.map((bin) => createHistogramBarBinInput(bin)),
    label: parameter.label,
    metadata: parameter.metadata,
    parameter: {
      key: parameter.key,
      kind: 'numeric',
      label: parameter.label ?? parameter.key,
      unit: parameter.unit,
    },
    parameterKey: parameter.key,
    parameterName: parameter.label ?? parameter.key,
    source: parameter.source ?? payload.source,
    subplotId: parameter.key,
    table: parameter.table,
  }));
  const spec: HistogramPlotSpec = {
    mode: 'bar',
    parameters: payload.parameters.map((parameter) => ({
      key: parameter.key,
      kind: 'numeric',
      label: parameter.label ?? parameter.key,
      unit: parameter.unit,
    })),
    subplots: series.map((subplotSeries) => ({
      id: subplotSeries.subplotId,
      label: subplotSeries.parameterName ?? subplotSeries.parameterKey,
      parameterKey: subplotSeries.parameterKey,
    })),
  };

  return {
    aggregation: normalizeHistogramBarSeries(series),
    series,
    spec,
  };
}

function getHistogramEligibleAxes(
  columns: FastScatterEncodedSchemaColumns,
  scatterSpec: FastScatterPlotSpec | undefined,
): {
  readonly axis: HistogramEligibleEncodedAxis;
  readonly key: string;
  readonly values: HistogramValueColumn;
}[] {
  const keys = createAxisOrder(columns, scatterSpec);
  const axes: {
    readonly axis: HistogramEligibleEncodedAxis;
    readonly key: string;
    readonly values: HistogramValueColumn;
  }[] = [];

  for (const key of keys) {
    const axis = columns.axisByColumn[key];
    const values = key === columns.xKey ? columns.x : columns.y[key];
    if (axis === undefined || values === undefined || !isHistogramEligibleAxis(axis)) {
      continue;
    }

    axes.push({ axis, key, values });
  }

  return mergeHistogramAxesByParameterIdentity(axes);
}

function createAxisOrder(
  columns: FastScatterEncodedSchemaColumns,
  scatterSpec: FastScatterPlotSpec | undefined,
): string[] {
  const ordered = new Set<string>();

  if (columns.xKey !== undefined) {
    ordered.add(columns.xKey);
  }

  for (const plot of scatterSpec?.plots ?? []) {
    ordered.add(plot.yKey);
  }

  for (const key of Object.keys(columns.y)) {
    ordered.add(key);
  }

  for (const key of Object.keys(columns.axisByColumn)) {
    ordered.add(key);
  }

  return [...ordered];
}

function isHistogramEligibleAxis(
  axis: FastScatterEncodedAxis,
): axis is HistogramEligibleEncodedAxis {
  return (
    axis.kind === 'numeric' ||
    axis.kind === 'datetime-ns' ||
    axis.kind === 'categorical' ||
    axis.kind === 'boolean'
  );
}

function mergeHistogramAxesByParameterIdentity(
  axes: {
    readonly axis: HistogramEligibleEncodedAxis;
    readonly key: string;
    readonly values: HistogramValueColumn;
  }[],
): {
  readonly axis: HistogramEligibleEncodedAxis;
  readonly key: string;
  readonly values: HistogramValueColumn;
}[] {
  const merged: typeof axes = [];
  const indexByIdentity = new Map<string, number>();

  for (const entry of axes) {
    const identity = createParameterIdentity(entry.axis, entry.key);
    const existingIndex = indexByIdentity.get(identity);

    if (existingIndex === undefined) {
      indexByIdentity.set(identity, merged.length);
      merged.push(entry);
      continue;
    }

    const existing = merged[existingIndex];
    if (existing === undefined) {
      continue;
    }

    merged[existingIndex] = {
      axis: mergeHistogramAxisMetadata(existing.axis, entry.axis),
      key: existing.key,
      values: mergeHistogramValueColumns(existing.values, entry.values),
    };
  }

  return merged;
}

function createParameterIdentity(axis: HistogramEligibleEncodedAxis, key: string): string {
  const name = axis.parameterName.trim() || axis.columnKey.trim() || key;
  return normalizeParameterIdentity(name);
}

function normalizeParameterIdentity(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/gu, ' ');
}

function mergeHistogramAxisMetadata(
  left: HistogramEligibleEncodedAxis,
  right: HistogramEligibleEncodedAxis,
): HistogramEligibleEncodedAxis {
  if (left.kind !== right.kind) {
    return left;
  }

  const domain = {
    max: Math.max(left.domain.max, right.domain.max),
    min: Math.min(left.domain.min, right.domain.min),
  };

  if (left.kind === 'categorical' || left.kind === 'boolean') {
    return {
      ...left,
      domain,
    };
  }

  return {
    ...left,
    domain,
  };
}

function mergeHistogramValueColumns(
  left: HistogramValueColumn,
  right: HistogramValueColumn,
): HistogramValueColumn {
  const rowCount = Math.max(left.length, right.length);
  const merged = new Array<bigint | boolean | number | string | null | undefined>(rowCount);

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const leftValue = left[rowIndex];
    merged[rowIndex] =
      leftValue === null || leftValue === undefined || isMissingNumber(leftValue)
        ? right[rowIndex]
        : leftValue;
  }

  return merged;
}

function isMissingNumber(value: bigint | boolean | number | string): boolean {
  return typeof value === 'number' && Number.isNaN(value);
}

function createHistogramParameterSpec(
  axis: HistogramEligibleEncodedAxis,
  key: string,
  tableBySourceIndex: readonly HistogramTableKey[] | undefined,
): HistogramParameterSpec {
  const sourceTables = tableBySourceIndex === undefined ? undefined : uniqueValues(tableBySourceIndex);
  const singleTableKey =
    sourceTables !== undefined && sourceTables.length === 1 ? sourceTables[0] : undefined;
  return {
    categories:
      axis.kind === 'categorical' || axis.kind === 'boolean'
        ? axis.categories.map((category, index) => ({
            encoded: category.encoded,
            label: category.label,
            order: index,
            value:
              axis.kind === 'boolean'
                ? normalizeBooleanCategoryValue(category.value)
                : category.value,
          }))
        : undefined,
    datetimeOriginNs: axis.kind === 'datetime-ns' ? axis.datetimeOriginNs : undefined,
    domain: axis.domain,
    key,
    kind: axis.kind,
    label: axis.title,
    source:
      axis.source ??
      (singleTableKey === undefined
        ? { fieldKey: key }
        : { tableKey: singleTableKey, fieldKey: key }),
    sourceTables,
    unit: axis.unit,
  };
}

function normalizeBooleanCategoryValue(value: string | number | boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  return value.toLowerCase() === 'true';
}

function resolveTableNames(
  tableBySourceIndex: readonly HistogramTableKey[] | undefined,
  tableName: HistogramTableKey | undefined,
  tableNames: readonly HistogramTableKey[] | undefined,
): readonly HistogramTableKey[] {
  if (tableNames !== undefined) {
    return [...tableNames];
  }

  if (tableBySourceIndex !== undefined) {
    return uniqueValues(tableBySourceIndex);
  }

  return tableName === undefined ? [] : [tableName];
}

function resolveTableRecordCounts(
  recordCount: number,
  tableBySourceIndex: readonly HistogramTableKey[] | undefined,
  tableName: HistogramTableKey | undefined,
  tableRecordCounts: Readonly<Record<HistogramTableKey, number>> | undefined,
): Readonly<Record<HistogramTableKey, number>> {
  if (tableRecordCounts !== undefined) {
    return { ...tableRecordCounts };
  }

  if (tableBySourceIndex !== undefined) {
    const counts: Record<HistogramTableKey, number> = {};
    for (const table of tableBySourceIndex) {
      counts[table] = (counts[table] ?? 0) + 1;
    }
    return counts;
  }

  return tableName === undefined ? {} : { [tableName]: recordCount };
}

function uniqueValues<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function createHistogramBarBinInput(bin: HistogramBarDemoBin): HistogramBarBinInput {
  return {
    colorStack:
      bin.colorCounts === undefined
        ? undefined
        : Object.entries(bin.colorCounts).map(([color, count]) => ({
            color: parsePackedColor(color),
            count,
          })),
    count: bin.count,
    max: bin.max,
    min: bin.min,
    sourceIndices: bin.sourceIndices,
  };
}

function parsePackedColor(value: string): number {
  if (/^#[0-9a-f]{6}$/iu.test(value)) {
    return Number.parseInt(`${value.slice(1)}ff`, 16) >>> 0;
  }

  if (/^0x[0-9a-f]+$/iu.test(value)) {
    return Number.parseInt(value.slice(2), 16) >>> 0;
  }

  return Number.parseInt(value, 10) >>> 0;
}
