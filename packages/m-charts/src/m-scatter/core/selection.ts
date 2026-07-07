import {
  materializeFastScatterBubbleSourceIndices,
  materializeFastScatterHeatmapCellSourceIndices,
} from './aggregation.js';
import type {
  FastScatterBubbleSubplotAggregation,
  FastScatterHeatmapSubplotAggregation,
  FastScatterPointColumns,
  FastScatterSelectionKind,
} from './types.js';

export interface FastScatterSelectionBounds {
  readonly x: {
    readonly min: number;
    readonly max: number;
  };
  readonly y: {
    readonly min: number;
    readonly max: number;
  };
  readonly yKey: string;
}

export interface FastScatterSelectionPoint {
  readonly x: number;
  readonly y: number;
}

export interface FastScatterSelectionPolygon {
  readonly points: readonly FastScatterSelectionPoint[];
  readonly yKey: string;
}

export interface FastScatterPolygonSelectionDiagnostics {
  readonly bounds: FastScatterSelectionBounds | null;
  readonly candidateCount: number;
}

export interface FastScatterPolygonSelectionResult {
  readonly diagnostics: FastScatterPolygonSelectionDiagnostics;
  readonly sourceIndices: Uint32Array;
}

export interface FastScatterSelectionState {
  readonly sourceIndices: Uint32Array;
  readonly selectedCount: number;
  readonly sampleIds: readonly string[];
}

export interface FastScatterSelectedRecord {
  readonly id: string;
  readonly sourceIndex: number;
  readonly table: string;
}

export interface CreateFastScatterSelectionStateOptions {
  readonly sampleSize?: number;
}

export interface ResolveFastScatterAggregateSelectionOptions
  extends CreateFastScatterSelectionStateOptions {
  readonly currentSourceIndices?: Uint32Array;
  readonly preserveEmptyReplace?: boolean;
  readonly selectionKind?: FastScatterSelectionKind;
}

export interface FastScatterAggregateSelectionResult
  extends FastScatterSelectionState {
  readonly empty: boolean;
}

const DEFAULT_SELECTION_SAMPLE_SIZE = 5;

export function selectFastScatterSourceIndicesInBounds(
  columns: Pick<FastScatterPointColumns, 'sourceIndex' | 'x' | 'xOrder' | 'y'>,
  bounds: FastScatterSelectionBounds,
): Uint32Array {
  const y = columns.y[bounds.yKey];

  if (y === undefined) {
    return new Uint32Array(0);
  }

  const xRange = normalizeRange(bounds.x);
  const yRange = normalizeRange(bounds.y);
  const scanRange = getXScanRange(columns, xRange);
  const selectedSourceIndices: number[] = [];

  for (
    let sortedIndex = scanRange.startIndex;
    sortedIndex < scanRange.endIndex;
    sortedIndex += 1
  ) {
    const pointIndex = getPointIndexAtXOrder(columns, sortedIndex);
    const yValue = y[pointIndex];

    if (Number.isFinite(yValue) && yValue >= yRange.min && yValue <= yRange.max) {
      selectedSourceIndices.push(columns.sourceIndex?.[pointIndex] ?? pointIndex);
    }
  }

  selectedSourceIndices.sort((a, b) => a - b);

  return normalizeSelectionSourceIndices(selectedSourceIndices);
}

export function estimateFastScatterSelectionCandidateCount(
  columns: Pick<FastScatterPointColumns, 'x' | 'xOrder'>,
  bounds: Pick<FastScatterSelectionBounds, 'x'> | null,
): number {
  if (bounds === null) {
    return 0;
  }

  const xRange = normalizeRange(bounds.x);
  const { endIndex, startIndex } = getXScanRange(columns, xRange);

  return Math.max(0, endIndex - startIndex);
}

export function selectFastScatterSourceIndicesInPolygon(
  columns: Pick<FastScatterPointColumns, 'sourceIndex' | 'x' | 'xOrder' | 'y'>,
  polygon: FastScatterSelectionPolygon,
): FastScatterPolygonSelectionResult {
  const y = columns.y[polygon.yKey];
  const bounds = getFastScatterSelectionPolygonBounds(polygon);

  if (y === undefined || bounds === null) {
    return {
      diagnostics: {
        bounds,
        candidateCount: 0,
      },
      sourceIndices: new Uint32Array(0),
    };
  }

  const scanRange = getXScanRange(columns, bounds.x);
  const selectedSourceIndices: number[] = [];

  for (
    let sortedIndex = scanRange.startIndex;
    sortedIndex < scanRange.endIndex;
    sortedIndex += 1
  ) {
    const pointIndex = getPointIndexAtXOrder(columns, sortedIndex);
    const point = {
      x: columns.x[pointIndex],
      y: y[pointIndex],
    };

    if (
      Number.isFinite(point.y) &&
      point.y >= bounds.y.min &&
      point.y <= bounds.y.max &&
      isFastScatterPointInPolygon(point, polygon.points)
    ) {
      selectedSourceIndices.push(columns.sourceIndex?.[pointIndex] ?? pointIndex);
    }
  }

  selectedSourceIndices.sort((a, b) => a - b);

  return {
    diagnostics: {
      bounds,
      candidateCount: scanRange.endIndex - scanRange.startIndex,
    },
    sourceIndices: normalizeSelectionSourceIndices(selectedSourceIndices),
  };
}

export function getFastScatterSelectionPolygonBounds(
  polygon: FastScatterSelectionPolygon,
): FastScatterSelectionBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let validPointCount = 0;

  for (const point of polygon.points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }

    validPointCount += 1;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  if (validPointCount < 3) {
    return null;
  }

  return {
    x: { max: maxX, min: minX },
    y: { max: maxY, min: minY },
    yKey: polygon.yKey,
  };
}

export function isFastScatterPointInPolygon(
  point: FastScatterSelectionPoint,
  polygon: readonly FastScatterSelectionPoint[],
): boolean {
  if (
    polygon.length < 3 ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    return false;
  }

  let isInside = false;
  let previous = polygon[polygon.length - 1];

  for (const current of polygon) {
    if (
      !Number.isFinite(current.x) ||
      !Number.isFinite(current.y) ||
      !Number.isFinite(previous.x) ||
      !Number.isFinite(previous.y)
    ) {
      previous = current;
      continue;
    }

    if (isPointOnSegment(point, previous, current)) {
      return true;
    }

    const crossesRay =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;

    if (crossesRay) {
      isInside = !isInside;
    }

    previous = current;
  }

  return isInside;
}

export function createFastScatterSelectionState(
  columns: Pick<FastScatterPointColumns, 'ids'>,
  sourceIndices: Uint32Array | readonly number[] | undefined,
  options: CreateFastScatterSelectionStateOptions = {},
): FastScatterSelectionState {
  const normalizedSourceIndices = normalizeSelectionSourceIndices(sourceIndices);

  return {
    sourceIndices: normalizedSourceIndices,
    selectedCount: normalizedSourceIndices.length,
    sampleIds: materializeFastScatterSelectedIdSample(
      columns,
      normalizedSourceIndices,
      options.sampleSize,
    ),
  };
}

export function mergeFastScatterSelectionSourceIndices(
  currentSelection: Uint32Array,
  nextSelection: Uint32Array,
): Uint32Array {
  const normalizedCurrent = ensureSortedUniqueSelectionSourceIndices(currentSelection);
  const normalizedNext = ensureSortedUniqueSelectionSourceIndices(nextSelection);

  if (normalizedCurrent.length === 0) {
    return normalizedNext;
  }

  if (normalizedNext.length === 0) {
    return normalizedCurrent;
  }

  const merged: number[] = [];
  let currentIndex = 0;
  let nextIndex = 0;

  while (
    currentIndex < normalizedCurrent.length ||
    nextIndex < normalizedNext.length
  ) {
    const currentValue =
      currentIndex < normalizedCurrent.length
        ? normalizedCurrent[currentIndex]!
        : Number.POSITIVE_INFINITY;
    const nextValue =
      nextIndex < normalizedNext.length
        ? normalizedNext[nextIndex]!
        : Number.POSITIVE_INFINITY;

    if (currentValue === nextValue) {
      merged.push(currentValue);
      currentIndex += 1;
      nextIndex += 1;
      continue;
    }

    if (currentValue < nextValue) {
      merged.push(currentValue);
      currentIndex += 1;
      continue;
    }

    merged.push(nextValue);
    nextIndex += 1;
  }

  return Uint32Array.from(merged);
}

export function applyFastScatterAggregateSelection(
  aggregateSourceIndices: Uint32Array,
  options: ResolveFastScatterAggregateSelectionOptions = {},
): Uint32Array {
  const currentSourceIndices = options.currentSourceIndices ?? new Uint32Array(0);
  const selectionKind = options.selectionKind ?? 'replace';
  const preserveEmptyReplace = options.preserveEmptyReplace ?? true;
  const normalizedAggregate = ensureSortedUniqueSelectionSourceIndices(
    aggregateSourceIndices,
  );

  if (selectionKind === 'append') {
    return mergeFastScatterSelectionSourceIndices(
      currentSourceIndices,
      normalizedAggregate,
    );
  }

  if (preserveEmptyReplace && normalizedAggregate.length === 0) {
    return ensureSortedUniqueSelectionSourceIndices(currentSourceIndices);
  }

  return normalizedAggregate;
}

export function selectFastScatterBubbleAggregateSourceIndices(
  columns: Pick<FastScatterPointColumns, 'ids'>,
  aggregation: FastScatterBubbleSubplotAggregation,
  aggregateIndex: number,
  options: ResolveFastScatterAggregateSelectionOptions = {},
): FastScatterAggregateSelectionResult {
  const aggregateSourceIndices = materializeFastScatterBubbleSourceIndices(
    aggregation,
    aggregateIndex,
  );
  const sourceIndices = applyFastScatterAggregateSelection(
    aggregateSourceIndices,
    options,
  );

  return {
    ...createFastScatterSelectionState(columns, sourceIndices, options),
    empty: aggregateSourceIndices.length === 0,
  };
}

export function selectFastScatterHeatmapCellSourceIndices(
  columns: Pick<FastScatterPointColumns, 'ids'>,
  aggregation: FastScatterHeatmapSubplotAggregation,
  cellIndex: number,
  options: ResolveFastScatterAggregateSelectionOptions = {},
): FastScatterAggregateSelectionResult {
  const aggregateSourceIndices = materializeFastScatterHeatmapCellSourceIndices(
    aggregation,
    cellIndex,
  );
  const sourceIndices = applyFastScatterAggregateSelection(
    aggregateSourceIndices,
    options,
  );

  return {
    ...createFastScatterSelectionState(columns, sourceIndices, options),
    empty: aggregateSourceIndices.length === 0,
  };
}

export function normalizeSelectionSourceIndices(
  sourceIndices: Uint32Array | readonly number[] | undefined,
): Uint32Array {
  if (sourceIndices === undefined || sourceIndices.length === 0) {
    return new Uint32Array(0);
  }

  if (sourceIndices instanceof Uint32Array) {
    return sourceIndices;
  }

  const normalized = new Uint32Array(sourceIndices.length);

  for (let index = 0; index < sourceIndices.length; index += 1) {
    normalized[index] = normalizeSourceIndex(sourceIndices[index], index);
  }

  return normalized;
}

export function materializeFastScatterSelectedIdSample(
  columns: Pick<FastScatterPointColumns, 'ids'>,
  sourceIndices: Uint32Array,
  sampleSize = DEFAULT_SELECTION_SAMPLE_SIZE,
): string[] {
  const count = Math.min(
    normalizeSampleSize(sampleSize),
    sourceIndices.length,
    columns.ids.length,
  );
  const sampleIds = new Array<string>(count);

  for (let index = 0; index < count; index += 1) {
    sampleIds[index] = materializeIdAtSourceIndex(columns, sourceIndices[index]);
  }

  return sampleIds;
}

export function materializeFastScatterSelectedIds(
  columns: Pick<FastScatterPointColumns, 'ids'>,
  sourceIndices: Uint32Array,
): string[] {
  const selectedIds = new Array<string>(sourceIndices.length);

  for (let index = 0; index < sourceIndices.length; index += 1) {
    selectedIds[index] = materializeIdAtSourceIndex(columns, sourceIndices[index]);
  }

  return selectedIds;
}

export function serializeFastScatterSelectedIdsForExport(
  columns: Pick<FastScatterPointColumns, 'ids'>,
  sourceIndices: Uint32Array,
): string {
  return `${materializeFastScatterSelectedIds(columns, sourceIndices).join('\n')}\n`;
}

export function materializeFastScatterSelectedRecords(
  columns: Pick<FastScatterPointColumns, 'ids'> & {
    recordIdentityBySourceIndex?: readonly FastScatterSelectedRecord[];
    tableBySourceIndex?: readonly string[];
  },
  sourceIndices: Uint32Array | readonly number[],
): FastScatterSelectedRecord[] {
  const records: FastScatterSelectedRecord[] = [];

  for (const sourceIndex of sourceIndices) {
    const id = materializeIdAtSourceIndex(columns, sourceIndex);
    const identity = columns.recordIdentityBySourceIndex?.[sourceIndex];
    records.push(
      identity ?? {
        id,
        sourceIndex,
        table: columns.tableBySourceIndex?.[sourceIndex] ?? 'benchmark-primary',
      },
    );
  }

  return records;
}

export function serializeFastScatterSelectedRecordsForExport(
  columns: Pick<FastScatterPointColumns, 'ids'> & {
    recordIdentityBySourceIndex?: readonly FastScatterSelectedRecord[];
    tableBySourceIndex?: readonly string[];
  },
  sourceIndices: Uint32Array | readonly number[],
): string {
  const rows = materializeFastScatterSelectedRecords(columns, sourceIndices).map(
    (record) => `${record.table}\t${record.id}`,
  );

  return `table\tid\n${rows.join('\n')}${rows.length === 0 ? '' : '\n'}`;
}

function materializeIdAtSourceIndex(
  columns: Pick<FastScatterPointColumns, 'ids'>,
  sourceIndex: number,
): string {
  const id = columns.ids[sourceIndex];

  if (id === undefined) {
    throw new Error(
      `Scatter-fast selection source index ${sourceIndex} is outside the ${columns.ids.length} loaded IDs.`,
    );
  }

  return id;
}

function normalizeSampleSize(sampleSize: number): number {
  if (!Number.isFinite(sampleSize) || sampleSize <= 0) {
    return 0;
  }

  return Math.floor(sampleSize);
}

function normalizeRange(range: { readonly min: number; readonly max: number }): {
  max: number;
  min: number;
} {
  return range.min <= range.max
    ? { max: range.max, min: range.min }
    : { max: range.min, min: range.max };
}

function lowerBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (values[mid] < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function upperBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (values[mid] <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function getPointIndexAtXOrder(
  columns: Pick<FastScatterPointColumns, 'xOrder'>,
  sortedIndex: number,
): number {
  return columns.xOrder?.[sortedIndex] ?? sortedIndex;
}

function getXValueAtOrder(
  columns: Pick<FastScatterPointColumns, 'x' | 'xOrder'>,
  sortedIndex: number,
): number {
  return columns.x[getPointIndexAtXOrder(columns, sortedIndex)] ?? Number.NaN;
}

function getXScanRange(
  columns: Pick<FastScatterPointColumns, 'x' | 'xOrder'>,
  range: { readonly min: number; readonly max: number },
): { endIndex: number; startIndex: number } {
  return {
    endIndex: upperBoundByX(columns, range.max),
    startIndex: lowerBoundByX(columns, range.min),
  };
}

function lowerBoundByX(
  columns: Pick<FastScatterPointColumns, 'x' | 'xOrder'>,
  target: number,
): number {
  if (columns.xOrder === undefined) {
    return lowerBound(columns.x, target);
  }

  let low = 0;
  let high = columns.xOrder.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (getXValueAtOrder(columns, mid) < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function upperBoundByX(
  columns: Pick<FastScatterPointColumns, 'x' | 'xOrder'>,
  target: number,
): number {
  if (columns.xOrder === undefined) {
    return upperBound(columns.x, target);
  }

  let low = 0;
  let high = columns.xOrder.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (getXValueAtOrder(columns, mid) <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function isPointOnSegment(
  point: FastScatterSelectionPoint,
  start: FastScatterSelectionPoint,
  end: FastScatterSelectionPoint,
): boolean {
  const cross =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y);

  if (Math.abs(cross) > 1e-9) {
    return false;
  }

  return (
    point.x >= Math.min(start.x, end.x) - 1e-9 &&
    point.x <= Math.max(start.x, end.x) + 1e-9 &&
    point.y >= Math.min(start.y, end.y) - 1e-9 &&
    point.y <= Math.max(start.y, end.y) + 1e-9
  );
}

function normalizeSourceIndex(sourceIndex: number, selectionOffset: number): number {
  if (
    !Number.isSafeInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex > 0xffffffff
  ) {
    throw new Error(
      `Scatter-fast selection source index at offset ${selectionOffset} must fit in Uint32.`,
    );
  }

  return sourceIndex;
}

function ensureSortedUniqueSelectionSourceIndices(
  sourceIndices: Uint32Array | readonly number[],
): Uint32Array {
  if (sourceIndices.length === 0) {
    return new Uint32Array(0);
  }

  let isSorted = true;
  let isUnique = true;

  for (let index = 1; index < sourceIndices.length; index += 1) {
    if (sourceIndices[index - 1]! > sourceIndices[index]!) {
      isSorted = false;
      break;
    }

    if (sourceIndices[index - 1] === sourceIndices[index]) {
      isUnique = false;
    }
  }

  if (isSorted && isUnique && sourceIndices instanceof Uint32Array) {
    return sourceIndices;
  }

  const normalizedValues = Array.from(sourceIndices, (value, index) =>
    normalizeSourceIndex(value, index),
  );
  normalizedValues.sort((left, right) => left - right);

  const uniqueValues: number[] = [];

  for (const value of normalizedValues) {
    if (uniqueValues[uniqueValues.length - 1] !== value) {
      uniqueValues.push(value);
    }
  }

  return Uint32Array.from(uniqueValues);
}
