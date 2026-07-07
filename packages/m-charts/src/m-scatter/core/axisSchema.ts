import type {
  FastScatterPointColumns,
  FastScatterRange,
  FastScatterSelectionSource,
  FastScatterShapeCode,
  FastScatterTypedNumericArray,
} from './types.js';
import {
  FAST_SCATTER_SHAPE_CODES,
  normalizeRotationDegrees,
  normalizeRotationRadians,
  packRgba8Color,
  type FastScatterShapeName,
} from './buffers.js';

export type FastScatterSchemaAxisType =
  | 'numeric'
  | 'categorical'
  | 'boolean'
  | 'datetime-ns';

export interface FastScatterSchemaCategory {
  value: string | number | boolean;
  label?: string;
  order?: number;
}

export interface FastScatterSchemaColumn {
  key: string;
  role?: 'id' | 'x' | 'y' | 'style' | 'metadata';
  axisType?: FastScatterSchemaAxisType;
  parameterName?: string;
  title?: string;
  unit?: string;
  categories?: readonly FastScatterSchemaCategory[];
  source?: FastScatterSelectionSource;
}

export interface FastScatterDatasetSchema {
  version: 1;
  columns: readonly FastScatterSchemaColumn[];
  x: {
    column: string;
    title?: string;
  };
  plots: readonly {
    id: string;
    label?: string;
    y: {
      column: string;
      title?: string;
    };
  }[];
}

export type FastScatterEncodedAxisKind =
  | 'numeric'
  | 'categorical'
  | 'boolean'
  | 'datetime-ns';

export interface FastScatterEncodedAxisBase {
  columnKey: string;
  domain: FastScatterRange;
  kind: FastScatterEncodedAxisKind;
  parameterName: string;
  source?: FastScatterSelectionSource;
  title: string;
  unit?: string;
}

export interface FastScatterNumericAxis extends FastScatterEncodedAxisBase {
  indexDisplay?: {
    sourceAxis?: FastScatterEncodedAxis;
    sourceValues: FastScatterTypedNumericArray;
  };
  kind: 'numeric';
}

export interface FastScatterCategoricalAxis extends FastScatterEncodedAxisBase {
  categories: readonly {
    encoded: number;
    label: string;
    value: string;
  }[];
  kind: 'categorical' | 'boolean';
}

export interface FastScatterDatetimeNsAxis extends FastScatterEncodedAxisBase {
  datetimeOriginNs: string;
  datetimeOriginNsBigInt: bigint;
  epochNsValues: readonly string[];
  kind: 'datetime-ns';
}

export type FastScatterEncodedAxis =
  | FastScatterNumericAxis
  | FastScatterCategoricalAxis
  | FastScatterDatetimeNsAxis;

export interface FastScatterEncodedSchemaColumns extends FastScatterPointColumns {
  axisByColumn: Readonly<Record<string, FastScatterEncodedAxis>>;
  color?: Uint8Array;
  colorFormat?: 'rgba8';
  opacity?: Float32Array;
  rotation?: Float32Array;
  rotationDegrees?: Float32Array;
  rotationRadians?: Float32Array;
  shape?: Uint8Array;
  size?: Float32Array;
  sourceIndex: Uint32Array;
  tableBySourceIndex?: readonly string[];
  x: Float64Array;
  xKey: string;
  y: Readonly<Record<string, Float64Array>>;
}

export interface FastScatterEncodeSchemaResult {
  columns: FastScatterEncodedSchemaColumns;
  spec: {
    xLabel: string;
    plots: readonly {
      id: string;
      label: string;
      yKey: string;
    }[];
  };
}

type RawRecord = Readonly<Record<string, unknown>>;
type FastScatterEncodedStyleColumns = Pick<
  FastScatterEncodedSchemaColumns,
  | 'color'
  | 'colorFormat'
  | 'opacity'
  | 'rotation'
  | 'rotationDegrees'
  | 'rotationRadians'
  | 'shape'
  | 'size'
>;
type FastScatterSchemaAxisDescriptor =
  | {
      axisType: 'numeric';
      column: FastScatterSchemaColumn;
      max: number;
      min: number;
      values: Float64Array;
    }
  | {
      axisType: 'categorical' | 'boolean';
      booleanAxis: boolean;
      column: FastScatterSchemaColumn;
      dictionary: ReturnType<typeof createCategoryDictionary>;
      values: Float64Array;
    }
  | {
      axisType: 'datetime-ns';
      column: FastScatterSchemaColumn;
      epochNsValues: string[];
      max: number;
      min: number;
      origin: bigint | null;
      values: Float64Array;
    };

const NS_PER_MS = 1_000_000n;
const BYTES_PER_RGBA_COLOR = 4;
const DEGREES_TO_RADIANS = Math.PI / 180;
const DEFAULT_OPACITY = 1;
const DEFAULT_POINT_SIZE = 4;
const DEFAULT_ROTATION_DEGREES = 0;
const DEFAULT_SHAPE_CODE = FAST_SCATTER_SHAPE_CODES.circle;

export function encodeFastScatterSchemaRows(
  rows: readonly RawRecord[],
  schema: FastScatterDatasetSchema,
): FastScatterEncodeSchemaResult {
  const columnByKey = createSchemaColumnMap(schema.columns);
  const xColumn = requireSchemaColumn(columnByKey, schema.x.column);
  const yColumns = schema.plots.map((plot) => requireSchemaColumn(columnByKey, plot.y.column));
  const recordCount = rows.length;
  const idColumn = [...columnByKey.values()].find((column) => column.role === 'id');
  const ids = new Array<string>(recordCount);
  const sourceIndex = new Uint32Array(recordCount);
  const axisDescriptors = createSchemaAxisDescriptors(
    [xColumn, ...yColumns],
    recordCount,
  );
  const axisDescriptorByKey = new Map(
    axisDescriptors.map((descriptor) => [descriptor.column.key, descriptor]),
  );
  const styleColumns = createSchemaStyleColumnBuffers(recordCount, schema.columns);
  const y: Record<string, Float64Array> = {};
  const axisByColumn: Record<string, FastScatterEncodedAxis> = {};

  for (let index = 0; index < recordCount; index += 1) {
    const row = rows[index];
    ids[index] = readSchemaId(row, idColumn, index);
    sourceIndex[index] = index;

    for (const descriptor of axisDescriptors) {
      encodeSchemaAxisDescriptorValue(descriptor, row, index);
    }

    encodeSchemaStyleColumnValue(styleColumns, row, index);
  }

  for (const descriptor of axisDescriptors) {
    axisByColumn[descriptor.column.key] = finalizeSchemaAxisDescriptor(descriptor);
  }

  for (let plotIndex = 0; plotIndex < schema.plots.length; plotIndex += 1) {
    const plot = schema.plots[plotIndex]!;
    const yColumn = yColumns[plotIndex]!;
    const descriptor = axisDescriptorByKey.get(yColumn.key);
    if (descriptor === undefined) {
      throw new Error(`Schema y column "${plot.y.column}" was not encoded.`);
    }
    y[plot.y.column] = descriptor.values;
  }

  const xDescriptor = axisDescriptorByKey.get(xColumn.key);
  if (xDescriptor === undefined) {
    throw new Error(`Schema x column "${xColumn.key}" was not encoded.`);
  }

  return {
    columns: {
      axisByColumn,
      ids,
      ...styleColumns,
      sourceIndex,
      x: xDescriptor.values,
      xKey: xColumn.key,
      y,
    },
    spec: {
      xLabel: createAxisTitle(xColumn, schema.x.title),
      plots: schema.plots.map((plot) => ({
        id: plot.id,
        label: plot.label ?? createAxisTitle(requireSchemaColumn(columnByKey, plot.y.column), plot.y.title),
        yKey: plot.y.column,
      })),
    },
  };
}

function createSchemaStyleColumnBuffers(
  recordCount: number,
  columns: readonly FastScatterSchemaColumn[],
): FastScatterEncodedStyleColumns {
  const styleColumns = new Set(
    columns.filter((column) => column.role === 'style').map((column) => column.key),
  );
  const result: FastScatterEncodedStyleColumns = {};

  if (styleColumns.has('color')) {
    result.color = new Uint8Array(recordCount * BYTES_PER_RGBA_COLOR);
    result.colorFormat = 'rgba8';
  }

  if (styleColumns.has('opacity')) {
    result.opacity = new Float32Array(recordCount);
  }

  if (styleColumns.has('size')) {
    result.size = new Float32Array(recordCount);
  }

  if (styleColumns.has('rotation')) {
    const rotationDegrees = new Float32Array(recordCount);
    const rotationRadians = new Float32Array(recordCount);
    result.rotation = rotationRadians;
    result.rotationDegrees = rotationDegrees;
    result.rotationRadians = rotationRadians;
  }

  if (styleColumns.has('shape')) {
    result.shape = new Uint8Array(recordCount);
  }

  return result;
}

function encodeSchemaStyleColumnValue(
  columns: FastScatterEncodedStyleColumns,
  row: RawRecord | undefined,
  rowIndex: number,
): void {
  if (columns.color !== undefined) {
    packRgba8Color(columns.color, rowIndex, readOptionalStyleString(row, 'color', rowIndex));
  }

  if (columns.opacity !== undefined) {
    columns.opacity[rowIndex] = readOptionalStyleNumber(
      row,
      'opacity',
      rowIndex,
      DEFAULT_OPACITY,
    );
  }

  if (columns.size !== undefined) {
    columns.size[rowIndex] = readOptionalStyleNumber(
      row,
      'size',
      rowIndex,
      DEFAULT_POINT_SIZE,
    );
  }

  if (columns.rotationDegrees !== undefined && columns.rotationRadians !== undefined) {
    const degrees = readOptionalStyleNumber(
      row,
      'rotation',
      rowIndex,
      DEFAULT_ROTATION_DEGREES,
    );
    columns.rotationDegrees[rowIndex] = normalizeRotationDegrees(degrees);
    columns.rotationRadians[rowIndex] = normalizeRotationRadians(
      degrees * DEGREES_TO_RADIANS,
    );
  }

  if (columns.shape !== undefined) {
    columns.shape[rowIndex] = readOptionalShapeCode(row, rowIndex);
  }
}

function readOptionalStyleString(
  row: RawRecord | undefined,
  key: string,
  rowIndex: number,
): string | undefined {
  const value = row?.[key];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Style column "${key}" at row ${rowIndex} must be a string.`);
  }

  return value;
}

function readOptionalStyleNumber(
  row: RawRecord | undefined,
  key: string,
  rowIndex: number,
  fallback: number,
): number {
  const value = row?.[key];
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Style column "${key}" at row ${rowIndex} must be a finite number.`);
  }

  return value;
}

function readOptionalShapeCode(
  row: RawRecord | undefined,
  rowIndex: number,
): FastScatterShapeCode {
  const value = row?.shape;
  if (value === null || value === undefined) {
    return DEFAULT_SHAPE_CODE;
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0 && value <= 4) {
      return value as FastScatterShapeCode;
    }
    throw new Error(`Style column "shape" at row ${rowIndex} must be 0, 1, 2, 3, or 4.`);
  }
  if (typeof value !== 'string') {
    throw new Error(`Style column "shape" at row ${rowIndex} must be a string or code.`);
  }

  const code = FAST_SCATTER_SHAPE_CODES[value as FastScatterShapeName];
  if (code === undefined) {
    throw new Error(
      `Style column "shape" at row ${rowIndex} must be circle, rectangle, triangle, pin, or arrow.`,
    );
  }

  return code;
}

function createSchemaAxisDescriptors(
  columns: readonly FastScatterSchemaColumn[],
  recordCount: number,
): FastScatterSchemaAxisDescriptor[] {
  const descriptors: FastScatterSchemaAxisDescriptor[] = [];
  const seen = new Set<string>();

  for (const column of columns) {
    if (seen.has(column.key)) {
      continue;
    }
    seen.add(column.key);
    descriptors.push(createSchemaAxisDescriptor(column, recordCount));
  }

  return descriptors;
}

function createSchemaAxisDescriptor(
  column: FastScatterSchemaColumn,
  recordCount: number,
): FastScatterSchemaAxisDescriptor {
  const axisType = column.axisType ?? 'numeric';

  switch (axisType) {
    case 'boolean': {
      return {
        axisType: 'boolean',
        booleanAxis: true,
        column,
        dictionary: createCategoryDictionary(column, true),
        values: new Float64Array(recordCount),
      };
    }
    case 'categorical': {
      return {
        axisType: 'categorical',
        booleanAxis: false,
        column,
        dictionary: createCategoryDictionary(column, false),
        values: new Float64Array(recordCount),
      };
    }
    case 'datetime-ns':
      return {
        axisType: 'datetime-ns',
        column,
        epochNsValues: new Array<string>(recordCount),
        max: Number.NEGATIVE_INFINITY,
        min: Number.POSITIVE_INFINITY,
        origin: null,
        values: new Float64Array(recordCount),
      };
    case 'numeric':
      return {
        axisType: 'numeric',
        column,
        max: Number.NEGATIVE_INFINITY,
        min: Number.POSITIVE_INFINITY,
        values: new Float64Array(recordCount),
      };
  }
}

function encodeSchemaAxisDescriptorValue(
  descriptor: FastScatterSchemaAxisDescriptor,
  row: RawRecord | undefined,
  rowIndex: number,
): void {
  switch (descriptor.axisType) {
    case 'boolean':
    case 'categorical': {
      encodeCategoricalDescriptorValue(descriptor, row, rowIndex);
      return;
    }
    case 'datetime-ns': {
      encodeDatetimeNsDescriptorValue(descriptor, row, rowIndex);
      return;
    }
    case 'numeric': {
      encodeNumericDescriptorValue(descriptor, row, rowIndex);
      return;
    }
  }
}

function encodeNumericDescriptorValue(
  descriptor: Extract<FastScatterSchemaAxisDescriptor, { axisType: 'numeric' }>,
  row: RawRecord | undefined,
  rowIndex: number,
): void {
  const value = row?.[descriptor.column.key];
  if (value === null || value === undefined) {
    descriptor.values[rowIndex] = Number.NaN;
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Column "${descriptor.column.key}" at row ${rowIndex} must be a finite number.`);
  }

  descriptor.values[rowIndex] = value;
  updateDescriptorDomain(descriptor, value);
}

function encodeCategoricalDescriptorValue(
  descriptor: Extract<
    FastScatterSchemaAxisDescriptor,
    { axisType: 'categorical' | 'boolean' }
  >,
  row: RawRecord | undefined,
  rowIndex: number,
): void {
  const rawValue = row?.[descriptor.column.key];
  if (rawValue === null || rawValue === undefined) {
    descriptor.values[rowIndex] = Number.NaN;
    return;
  }
  const key = normalizeCategoryValue(
    rawValue,
    descriptor.column.key,
    rowIndex,
    descriptor.booleanAxis,
  );
  let encoded = descriptor.dictionary.valueToEncoded.get(key);

  if (encoded === undefined) {
    encoded = descriptor.dictionary.categories.length;
    descriptor.dictionary.valueToEncoded.set(key, encoded);
    descriptor.dictionary.categories.push({
      encoded,
      label: String(rawValue),
      value: key,
    });
  }

  descriptor.values[rowIndex] = encoded;
}

function encodeDatetimeNsDescriptorValue(
  descriptor: Extract<FastScatterSchemaAxisDescriptor, { axisType: 'datetime-ns' }>,
  row: RawRecord | undefined,
  rowIndex: number,
): void {
  const rawValue = row?.[descriptor.column.key];
  if (rawValue === null || rawValue === undefined) {
    descriptor.values[rowIndex] = Number.NaN;
    descriptor.epochNsValues[rowIndex] = '';
    return;
  }
  const nsValue = parseDatetimeNsValue(
    rawValue,
    descriptor.column.key,
    rowIndex,
  );
  const origin = descriptor.origin ?? nsValue;
  descriptor.origin = origin;
  const encoded = Number(nsValue - origin) / Number(NS_PER_MS);

  descriptor.values[rowIndex] = encoded;
  descriptor.epochNsValues[rowIndex] = nsValue.toString();
  updateDescriptorDomain(descriptor, encoded);
}

function finalizeSchemaAxisDescriptor(
  descriptor: FastScatterSchemaAxisDescriptor,
): FastScatterEncodedAxis {
  switch (descriptor.axisType) {
    case 'boolean':
    case 'categorical':
      return {
        categories: descriptor.dictionary.categories,
        columnKey: descriptor.column.key,
        domain: calculateCategoryDomain(descriptor.dictionary.categories.length),
        kind: descriptor.axisType,
        parameterName: descriptor.column.parameterName ?? descriptor.column.key,
        ...(descriptor.column.source === undefined
          ? {}
          : { source: descriptor.column.source }),
        title: createAxisTitle(descriptor.column),
        unit: descriptor.column.unit,
      };
    case 'datetime-ns': {
      const origin = descriptor.origin ?? 0n;
      return {
        columnKey: descriptor.column.key,
        datetimeOriginNs: origin.toString(),
        datetimeOriginNsBigInt: origin,
        domain: finalizeDescriptorDomain(descriptor),
        epochNsValues: descriptor.epochNsValues,
        kind: 'datetime-ns',
        parameterName: descriptor.column.parameterName ?? descriptor.column.key,
        ...(descriptor.column.source === undefined
          ? {}
          : { source: descriptor.column.source }),
        title: createAxisTitle(descriptor.column),
        unit: descriptor.column.unit,
      };
    }
    case 'numeric':
      return {
        columnKey: descriptor.column.key,
        domain: finalizeDescriptorDomain(descriptor),
        kind: 'numeric',
        parameterName: descriptor.column.parameterName ?? descriptor.column.key,
        ...(descriptor.column.source === undefined
          ? {}
          : { source: descriptor.column.source }),
        title: createAxisTitle(descriptor.column),
        unit: descriptor.column.unit,
      };
  }
}

function updateDescriptorDomain(
  descriptor: Extract<
    FastScatterSchemaAxisDescriptor,
    { axisType: 'datetime-ns' | 'numeric' }
  >,
  value: number,
): void {
  if (value < descriptor.min) {
    descriptor.min = value;
  }
  if (value > descriptor.max) {
    descriptor.max = value;
  }
}

function finalizeDescriptorDomain(
  descriptor: Extract<
    FastScatterSchemaAxisDescriptor,
    { axisType: 'datetime-ns' | 'numeric' }
  >,
): FastScatterRange {
  if (
    descriptor.min === Number.POSITIVE_INFINITY ||
    descriptor.max === Number.NEGATIVE_INFINITY
  ) {
    return { max: 1, min: 0 };
  }

  return descriptor.min === descriptor.max
    ? { max: descriptor.max + 1, min: descriptor.min - 1 }
    : { max: descriptor.max, min: descriptor.min };
}

function readSchemaId(
  row: RawRecord | undefined,
  idColumn: FastScatterSchemaColumn | undefined,
  rowIndex: number,
): string {
  const rawId = idColumn === undefined ? undefined : row?.[idColumn.key];

  return rawId === undefined || rawId === null ? String(rowIndex) : String(rawId);
}

function createSchemaColumnMap(
  columns: readonly FastScatterSchemaColumn[],
): Map<string, FastScatterSchemaColumn> {
  const columnByKey = new Map<string, FastScatterSchemaColumn>();

  for (const column of columns) {
    if (columnByKey.has(column.key)) {
      throw new Error(`Duplicate schema column "${column.key}".`);
    }
    columnByKey.set(column.key, column);
  }

  return columnByKey;
}

function requireSchemaColumn(
  columnByKey: ReadonlyMap<string, FastScatterSchemaColumn>,
  key: string,
): FastScatterSchemaColumn {
  const column = columnByKey.get(key);
  if (column === undefined) {
    throw new Error(`Schema references unknown column "${key}".`);
  }

  return column;
}

export function createAxisTitle(
  column: FastScatterSchemaColumn,
  overrideTitle?: string,
): string {
  const baseTitle = overrideTitle ?? column.title ?? column.parameterName ?? column.key;

  return column.unit === undefined || column.unit === ''
    ? baseTitle
    : `${baseTitle} (${column.unit})`;
}

function createCategoryDictionary(
  column: FastScatterSchemaColumn,
  booleanAxis: boolean,
): {
  categories: {
    encoded: number;
    label: string;
    value: string;
  }[];
  valueToEncoded: Map<string, number>;
} {
  const schemaCategories =
    column.categories ?? (booleanAxis ? [{ value: false }, { value: true }] : []);
  const categories = [...schemaCategories]
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((category, index) => ({
      encoded: index,
      label: category.label ?? String(category.value),
      value: String(category.value),
    }));
  const valueToEncoded = new Map<string, number>();

  for (const category of categories) {
    valueToEncoded.set(category.value, category.encoded);
  }

  return { categories, valueToEncoded };
}

function normalizeCategoryValue(
  rawValue: unknown,
  columnKey: string,
  rowIndex: number,
  booleanAxis: boolean,
): string {
  if (booleanAxis && typeof rawValue !== 'boolean') {
    throw new Error(`Column "${columnKey}" at row ${rowIndex} must be boolean.`);
  }

  if (
    rawValue === null ||
    rawValue === undefined ||
    (typeof rawValue !== 'string' &&
      typeof rawValue !== 'number' &&
      typeof rawValue !== 'boolean')
  ) {
    throw new Error(`Column "${columnKey}" at row ${rowIndex} must be categorical.`);
  }

  return String(rawValue);
}

function parseDatetimeNsValue(rawValue: unknown, columnKey: string, rowIndex: number): bigint {
  if (typeof rawValue === 'string' && /^-?\d+$/.test(rawValue)) {
    return BigInt(rawValue);
  }

  if (typeof rawValue === 'number' && Number.isSafeInteger(rawValue)) {
    return BigInt(rawValue);
  }

  throw new Error(
    `Column "${columnKey}" at row ${rowIndex} must be a nanosecond timestamp string or safe integer.`,
  );
}

function calculateCategoryDomain(categoryCount: number): FastScatterRange {
  return {
    max: Math.max(1, categoryCount - 1),
    min: 0,
  };
}
