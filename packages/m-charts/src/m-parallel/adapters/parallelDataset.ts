import {
  createParallelBuffers,
  createParallelFastBuffers,
  type CreateParallelBuffersOptions,
  type ParallelBuffers,
} from '../core/index.js';
import type {
  ParallelFastAxisSpec,
  ParallelFastColumns,
} from '../core/types.js';

export interface ParallelFastDatasetLike {
  metadata: {
    attributes: {
      parameters: readonly string[];
    };
  };
  records: readonly (Record<string, unknown> & {
    id: string;
    selected?: boolean;
  })[];
}

export function createParallelFastBuffersFromDataset(
  dataset: ParallelFastDatasetLike,
  options: CreateParallelBuffersOptions = {},
): ParallelBuffers {
  return createParallelBuffers(dataset, options);
}

export type ParallelFastTableAxisOption = 'auto' | 'always' | 'never';

export type ParallelFastTableAxisKind =
  | 'numeric'
  | 'categorical'
  | 'boolean'
  | 'datetime-ns';

export interface ParallelFastTableCategory {
  label: string;
  order?: number;
  value: string | number | boolean;
}

export interface ParallelFastTableAxisMetadata {
  categories?: readonly ParallelFastTableCategory[];
  key: string;
  kind: ParallelFastTableAxisKind;
  label: string;
  role: 'x' | 'y' | 'dimension';
  source?: ParallelFastAxisSpec['source'];
  unit?: string;
}

export interface ParallelFastTableLike {
  axes?: readonly ParallelFastTableAxisMetadata[];
  name: string;
  records: readonly object[];
}

export interface ParallelFastTableFixture {
  metadata: {
    axes: readonly ParallelFastTableAxisMetadata[];
  };
  tables: readonly ParallelFastTableLike[];
}

export type FastPlotTableInput = ParallelFastTableLike;

export interface FastPlotRecordIdentity {
  id: string;
  sourceIndex: number;
  table: string;
}

export interface ParallelFastTableAdapterOptions
  extends CreateParallelBuffersOptions {
  tableAxis?: ParallelFastTableAxisOption;
}

export interface ParallelFastTableAdapterResult {
  buffers: ParallelBuffers;
  columns: ParallelFastColumns;
  metadata: {
    recordIdentityBySourceIndex: readonly FastPlotRecordIdentity[];
    recordCount: number;
    tableNames: readonly string[];
    tableRecordCounts: Readonly<Record<string, number>>;
    tableBySourceIndex: readonly string[];
  };
}

const PARALLEL_STYLE_COLOR_KEY = 'color';
const PARALLEL_STYLE_OPACITY_KEY = 'opacity';
const PARALLEL_TABLE_AXIS_KEY = 'table';

export function adaptMixedTablesForParallelFast(
  input: ParallelFastTableFixture | readonly ParallelFastTableLike[],
  options: ParallelFastTableAdapterOptions = {},
): ParallelFastTableAdapterResult {
  const tables = normalizeParallelFastTables(input);
  const axisSpecs = createParallelAxisSpecs(tables, options.tableAxis ?? 'auto');
  const axisOrder = axisSpecs.map((axis) => axis.key);
  const recordCount = tables.reduce((sum, table) => sum + table.records.length, 0);
  const valuesByAxis = Object.fromEntries(
    axisOrder.map((axis) => [
      axis,
      new Array<string | number | bigint | boolean | null | undefined>(recordCount),
    ]),
  ) as Record<string, (string | number | bigint | boolean | null | undefined)[]>;
  const ids = new Array<string>(recordCount);
  const color = new Array<string | null | undefined>(recordCount);
  const opacity = new Array<number | null | undefined>(recordCount);
  const recordIdentityBySourceIndex = new Array<FastPlotRecordIdentity>(recordCount);
  const tableBySourceIndex = new Array<string>(recordCount);
  const tableRecordCounts: Record<string, number> = {};
  const preselectedSourceIndices: number[] = [];
  let offset = 0;

  for (const table of tables) {
    tableRecordCounts[table.name] = table.records.length;

    for (const record of table.records) {
      const row = record as Readonly<Record<string, unknown>>;
      ids[offset] = readRecordId(row, offset);
      recordIdentityBySourceIndex[offset] = {
        id: ids[offset],
        sourceIndex: offset,
        table: table.name,
      };
      tableBySourceIndex[offset] = table.name;

      if (row.selected === true) {
        preselectedSourceIndices.push(offset);
      }

      for (const axis of axisOrder) {
        valuesByAxis[axis]![offset] =
          axis === PARALLEL_TABLE_AXIS_KEY
            ? table.name
            : readParallelValue(row[axis]);
      }

      color[offset] = readOptionalString(row[PARALLEL_STYLE_COLOR_KEY]);
      opacity[offset] = readOptionalNumber(row[PARALLEL_STYLE_OPACITY_KEY]);
      offset += 1;
    }
  }

  const columns: ParallelFastColumns = {
    axes: axisSpecs,
    axisOrder,
    color,
    ids,
    opacity,
    preselectedSourceIndices: Uint32Array.from(preselectedSourceIndices),
    recordIdentityBySourceIndex,
    valuesByAxis,
  };

  return {
    buffers: createParallelFastBuffers(columns, options),
    columns,
    metadata: {
      recordIdentityBySourceIndex,
      recordCount,
      tableBySourceIndex,
      tableNames: tables.map((table) => table.name),
      tableRecordCounts,
    },
  };
}

export const adaptTablesForParallelFast = adaptMixedTablesForParallelFast;

function normalizeParallelFastTables(
  input: ParallelFastTableFixture | readonly ParallelFastTableLike[],
): readonly ParallelFastTableLike[] {
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
  input: ParallelFastTableFixture | readonly ParallelFastTableLike[],
): input is ParallelFastTableFixture {
  return !Array.isArray(input);
}

function createParallelAxisSpecs(
  tables: readonly ParallelFastTableLike[],
  tableAxis: ParallelFastTableAxisOption,
): ParallelFastAxisSpec[] {
  const axisByKey = new Map<string, ParallelFastAxisSpec>();

  for (const table of tables) {
    for (const axis of table.axes ?? inferAxesFromRecords(table.records)) {
      if (axisByKey.has(axis.key)) {
        continue;
      }
      if (!tableHasAxisValue(table, axis.key)) {
        continue;
      }
      axisByKey.set(axis.key, {
        categories: axis.categories,
        key: axis.key,
        kind: axis.kind,
        label: axis.label,
        source: axis.source ?? { fieldKey: axis.key },
        unit: axis.unit,
      });
    }
  }

  const axisSpecs = [...axisByKey.values()];
  if (tableAxis === 'always' || (tableAxis === 'auto' && tables.length > 1)) {
    axisSpecs.push({
      categories: tables.map((table, order) => ({
        label: table.name,
        order,
        value: table.name,
      })),
      key: PARALLEL_TABLE_AXIS_KEY,
      kind: 'categorical',
      label: 'Table',
      source: { fieldKey: PARALLEL_TABLE_AXIS_KEY },
    });
  }

  return axisSpecs;
}

function tableHasAxisValue(table: ParallelFastTableLike, axisKey: string): boolean {
  return table.records.length === 0
    ? true
    : table.records.some(
        (record) => (record as Readonly<Record<string, unknown>>)[axisKey] !== undefined,
      );
}

function inferAxesFromRecords(
  records: readonly object[],
): ParallelFastTableAxisMetadata[] {
  const first = records[0] as Readonly<Record<string, unknown>> | undefined;
  if (first === undefined) {
    return [];
  }

  return Object.keys(first)
    .filter(
      (key) =>
        key !== 'id' &&
        key !== PARALLEL_TABLE_AXIS_KEY &&
        key !== PARALLEL_STYLE_COLOR_KEY &&
        key !== PARALLEL_STYLE_OPACITY_KEY &&
        key !== 'size' &&
        key !== 'rotation' &&
        key !== 'shape',
    )
    .map((key) => ({
      key,
      kind: typeof first[key] === 'boolean' ? 'boolean' : 'numeric',
      label: key,
      role: 'dimension',
    }));
}

function readRecordId(record: Readonly<Record<string, unknown>>, index: number): string {
  return typeof record.id === 'string' ? record.id : `record-${index}`;
}

function readOptionalString(value: unknown): string | null | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readOptionalNumber(value: unknown): number | null | undefined {
  return typeof value === 'number' ? value : undefined;
}

function readParallelValue(
  value: unknown,
): string | number | bigint | boolean | null | undefined {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  return undefined;
}
