import {
  createFastScatterBuffers,
  type FastScatterBufferBuildRecord,
  type FastScatterBufferBuildResult,
} from '../core/buffers.js';
import type { FastScatterDisplayColumns } from '../core/axisDisplay.js';
import {
  encodeFastScatterSchemaRows,
  type FastScatterEncodedSchemaColumns,
  type FastScatterSchemaColumn,
} from '../core/axisSchema.js';
import type { FastScatterPlotSpec } from '../core/types.js';

export type FastScatterDatasetYKey = 'a' | 'b' | 'c';

export interface FastScatterDatasetStyleLimits {
  max: number;
  min: number;
}

export interface FastScatterDatasetStyleMetadata {
  color?: Readonly<Record<string, unknown>>;
  opacity?: FastScatterDatasetStyleLimits & Readonly<Record<string, unknown>>;
  rotation?: FastScatterDatasetStyleLimits & Readonly<Record<string, unknown>>;
  shape?: Readonly<Record<string, unknown>>;
  size?: FastScatterDatasetStyleLimits & Readonly<Record<string, unknown>>;
}

export interface FastScatterDatasetRecord extends FastScatterBufferBuildRecord {
  a: number;
  b: number;
  c: number;
  category: string;
  styleGroup: string;
  x: number;
}

export interface FastScatterDatasetLike {
  metadata: {
    attributes: {
      category: string;
      color: string;
      id: string;
      opacity: string;
      rotation: string;
      shape: string;
      size: string;
      styleGroup: string;
      x: string;
      y: readonly FastScatterDatasetYKey[];
    };
    categories: readonly string[];
    count: number;
    createdAt: string;
    seed: number;
    styleGroups: readonly string[];
    styles?: FastScatterDatasetStyleMetadata & Readonly<Record<string, unknown>>;
  };
  records: readonly FastScatterDatasetRecord[];
}

export type FastScatterTableAxisKind =
  | 'numeric'
  | 'categorical'
  | 'boolean'
  | 'datetime-ns';

export interface FastScatterTableCategory {
  label: string;
  order?: number;
  value: string | number | boolean;
}

export interface FastScatterTableAxisMetadata {
  categories?: readonly FastScatterTableCategory[];
  key: string;
  kind: FastScatterTableAxisKind;
  label: string;
  role: 'x' | 'y' | 'dimension';
  source?: FastScatterSchemaColumn['source'];
  unit?: string;
}

export interface FastScatterTableFixture {
  metadata: {
    axes: readonly FastScatterTableAxisMetadata[];
  };
  tables: readonly FastScatterTableLike[];
}

export interface FastScatterDatasetAdapterMetadata {
  attributes: {
    category: string;
    color: string;
    id: string;
    opacity: string;
    rotation: string;
    shape: string;
    size: string;
    styleGroup: string;
    x: string;
    y: readonly FastScatterDatasetYKey[];
  };
  categories: readonly string[];
  count: number;
  createdAt: string;
  seed: number;
  styleGroups: readonly string[];
  styles: FastScatterDatasetLike['metadata']['styles'];
}

export interface FastScatterDatasetAdapterResult {
  columns: FastScatterBufferBuildResult;
  metadata: FastScatterDatasetAdapterMetadata;
  spec: FastScatterPlotSpec;
}

export interface FastScatterTableLike {
  axes?: readonly FastScatterTableAxisMetadata[];
  name: string;
  records: readonly object[];
}

export type FastPlotTableInput = FastScatterTableLike;

export interface FastPlotRecordIdentity {
  id: string;
  sourceIndex: number;
  table: string;
}

export interface FastScatterTableAdapterResult {
  columns: FastScatterEncodedSchemaColumns & {
    recordIdentityBySourceIndex: readonly FastPlotRecordIdentity[];
    tableBySourceIndex: readonly string[];
  };
  metadata: {
    recordIdentityBySourceIndex: readonly FastPlotRecordIdentity[];
    recordCount: number;
    tableBySourceIndex: readonly string[];
    tableNames: readonly string[];
    tableRecordCounts: Readonly<Record<string, number>>;
  };
  spec: FastScatterPlotSpec;
}

const SCATTER_PLOT_LABELS = {
  a: 'Metric A',
  b: 'Metric B',
  c: 'Metric C',
} as const satisfies Record<FastScatterDatasetYKey, string>;

const SCATTER_Y_ACCESSORS = {
  a: (record: FastScatterDatasetRecord) => record.a,
  b: (record: FastScatterDatasetRecord) => record.b,
  c: (record: FastScatterDatasetRecord) => record.c,
} as const satisfies Record<
  FastScatterDatasetYKey,
  (record: FastScatterDatasetRecord) => number
>;

export function adaptScatterDatasetForFastScatter(
  dataset: FastScatterDatasetLike,
): FastScatterDatasetAdapterResult {
  return {
    columns: createFastScatterBuffersFromDataset(dataset),
    metadata: mapScatterDatasetMetadata(dataset),
    spec: createFastScatterPlotSpec(dataset),
  };
}

export function adaptMixedTablesForFastScatter(
  input: FastScatterTableFixture | readonly FastScatterTableLike[],
): FastScatterTableAdapterResult {
  const tables = normalizeFastScatterTables(input);
  const axes = createScatterAxisUnion(tables);
  const xAxis = axes.find((axis) => axis.role === 'x') ?? axes[0];
  const yAxes = axes.filter((axis) => axis.key !== xAxis?.key);

  if (xAxis === undefined || yAxes.length === 0) {
    throw new Error('Scatter-fast table input requires one x axis and at least one y axis.');
  }

  const rows: Readonly<Record<string, unknown>>[] = [];
  const recordIdentityBySourceIndex: FastPlotRecordIdentity[] = [];
  const tableBySourceIndex: string[] = [];
  const tableRecordCounts: Record<string, number> = {};

  for (const table of tables) {
    tableRecordCounts[table.name] = table.records.length;
    for (const record of table.records) {
      const row = record as Readonly<Record<string, unknown>>;
      rows.push(row);
      recordIdentityBySourceIndex.push({
        id: readTableRecordId(row, rows.length - 1),
        sourceIndex: rows.length - 1,
        table: table.name,
      });
      tableBySourceIndex.push(table.name);
    }
  }

  const encoded = encodeFastScatterSchemaRows(rows, {
    columns: [
      { key: 'id', role: 'id' },
      ...axes.map((axis) => ({
        axisType: axis.kind,
        categories: axis.categories,
        key: axis.key,
        role: axis.key === xAxis.key ? ('x' as const) : ('y' as const),
        source: axis.source ?? { fieldKey: axis.key },
        title: axis.label,
        unit: axis.unit,
      })),
      { key: 'color', role: 'style' },
      { key: 'opacity', role: 'style' },
      { key: 'size', role: 'style' },
      { key: 'rotation', role: 'style' },
      { key: 'shape', role: 'style' },
    ],
    plots: yAxes.map((axis) => ({
      id: axis.key,
      label: axis.label,
      y: { column: axis.key, title: axis.label },
    })),
    version: 1,
    x: { column: xAxis.key, title: xAxis.label },
  });
  const xOrder = createFastScatterXOrder(encoded.columns.x);

  return {
    columns: {
      ...encoded.columns,
      recordIdentityBySourceIndex,
      tableBySourceIndex,
      xOrder,
    },
    metadata: {
      recordIdentityBySourceIndex,
      recordCount: rows.length,
      tableBySourceIndex,
      tableNames: tables.map((table) => table.name),
      tableRecordCounts,
    },
    spec: encoded.spec,
  };
}

export const adaptTablesForFastScatter = adaptMixedTablesForFastScatter;

export function createFastScatterBuffersFromDataset(
  dataset: FastScatterDatasetLike,
): FastScatterBufferBuildResult & FastScatterDisplayColumns {
  const buffers = createFastScatterBuffers<FastScatterDatasetRecord>(dataset.records, {
    styleLimits: createScatterStyleLimits(dataset.metadata.styles),
    yAccessors: createScatterYAccessors(dataset),
  });

  return {
    ...buffers,
    axisByColumn: {
      x: {
        columnKey: 'x',
        domain: resolveNumericDomain(buffers.x),
        kind: 'numeric',
        parameterName: dataset.metadata.attributes.x,
        source: { fieldKey: dataset.metadata.attributes.x },
        title: dataset.metadata.attributes.x,
      },
      ...Object.fromEntries(
        dataset.metadata.attributes.y.map((yKey) => [
          yKey,
          {
            columnKey: yKey,
            domain: resolveNumericDomain(buffers.y[yKey]),
            kind: 'numeric',
            parameterName: SCATTER_PLOT_LABELS[yKey],
            source: { fieldKey: yKey },
            title: SCATTER_PLOT_LABELS[yKey],
          },
        ]),
      ),
    },
    xKey: 'x',
  } satisfies FastScatterBufferBuildResult & FastScatterDisplayColumns;
}

function createFastScatterPlotSpec(dataset: FastScatterDatasetLike): FastScatterPlotSpec {
  return {
    xLabel: dataset.metadata.attributes.x,
    plots: dataset.metadata.attributes.y.map((yKey) => ({
      id: yKey,
      label: SCATTER_PLOT_LABELS[yKey],
      yKey,
    })),
  };
}

function createScatterYAccessors(
  dataset: FastScatterDatasetLike,
): Record<FastScatterDatasetYKey, (record: FastScatterDatasetRecord) => number> {
  const yAccessors = {} as Record<
    FastScatterDatasetYKey,
    (record: FastScatterDatasetRecord) => number
  >;

  for (const yKey of dataset.metadata.attributes.y) {
    yAccessors[yKey] = SCATTER_Y_ACCESSORS[yKey];
  }

  return yAccessors;
}

function resolveNumericDomain(values: ArrayLike<number> | undefined): {
  max: number;
  min: number;
} {
  if (values === undefined || values.length === 0) {
    return { max: 1, min: 0 };
  }

  let max = Number.NEGATIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) {
      continue;
    }

    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  return Number.isFinite(min) && Number.isFinite(max)
    ? { max, min }
    : { max: 1, min: 0 };
}

function normalizeFastScatterTables(
  input: FastScatterTableFixture | readonly FastScatterTableLike[],
): readonly FastScatterTableLike[] {
  if (!isMixedTableFixture(input)) {
    return input;
  }

  return input.tables.map((table) => ({
    axes: input.metadata.axes,
    name: table.name,
    records: table.records,
  }));
}

function isMixedTableFixture(
  input: FastScatterTableFixture | readonly FastScatterTableLike[],
): input is FastScatterTableFixture {
  return !Array.isArray(input);
}

function createScatterAxisUnion(
  tables: readonly FastScatterTableLike[],
): FastScatterTableAxisMetadata[] {
  const axisByKey = new Map<string, FastScatterTableAxisMetadata>();

  for (const table of tables) {
    for (const axis of table.axes ?? []) {
      if (!axisByKey.has(axis.key) && tableHasAxisValue(table, axis.key)) {
        axisByKey.set(axis.key, axis);
      }
    }
  }

  return [...axisByKey.values()];
}

function tableHasAxisValue(table: FastScatterTableLike, axisKey: string): boolean {
  return table.records.length === 0
    ? true
    : table.records.some(
        (record) => (record as Readonly<Record<string, unknown>>)[axisKey] !== undefined,
      );
}

function readTableRecordId(record: Readonly<Record<string, unknown>>, index: number): string {
  return record.id === null || record.id === undefined ? String(index) : String(record.id);
}

function createFastScatterXOrder(values: Float64Array): Uint32Array | undefined {
  if (values.length < 2 || isFiniteNondecreasing(values)) {
    return undefined;
  }

  const pointIndices = Array.from({ length: values.length }, (_, index) => index);
  pointIndices.sort((leftIndex, rightIndex) => {
    const leftValue = sortableXValue(values[leftIndex]);
    const rightValue = sortableXValue(values[rightIndex]);

    if (leftValue === rightValue) {
      return leftIndex - rightIndex;
    }

    return leftValue - rightValue;
  });

  return Uint32Array.from(pointIndices);
}

function isFiniteNondecreasing(values: Float64Array): boolean {
  let previous = sortableXValue(values[0]);
  if (!Number.isFinite(previous)) {
    return false;
  }

  for (let index = 1; index < values.length; index += 1) {
    const next = sortableXValue(values[index]);
    if (!Number.isFinite(next)) {
      return false;
    }

    if (next < previous) {
      return false;
    }

    previous = next;
  }

  return true;
}

function sortableXValue(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value)
    ? Number.POSITIVE_INFINITY
    : value;
}

function mapScatterDatasetMetadata(
  dataset: FastScatterDatasetLike,
): FastScatterDatasetAdapterMetadata {
  return {
    attributes: {
      ...dataset.metadata.attributes,
      y: [...dataset.metadata.attributes.y],
    },
    categories: [...dataset.metadata.categories],
    count: dataset.metadata.count,
    createdAt: dataset.metadata.createdAt,
    seed: dataset.metadata.seed,
    styleGroups: [...dataset.metadata.styleGroups],
    styles: dataset.metadata.styles,
  };
}

function createScatterStyleLimits(
  styles: FastScatterDatasetLike['metadata']['styles'],
): {
  opacity?: FastScatterDatasetStyleLimits;
  rotationDegrees?: FastScatterDatasetStyleLimits;
  size?: FastScatterDatasetStyleLimits;
} {
  return {
    opacity: toScatterStyleLimits(styles?.opacity),
    rotationDegrees: toScatterStyleLimits(styles?.rotation),
    size: toScatterStyleLimits(styles?.size),
  };
}

function toScatterStyleLimits(
  value: FastScatterDatasetStyleLimits | undefined,
): FastScatterDatasetStyleLimits | undefined {
  if (
    value === undefined ||
    !Number.isFinite(value.min) ||
    !Number.isFinite(value.max)
  ) {
    return undefined;
  }

  return {
    max: value.max,
    min: value.min,
  };
}
