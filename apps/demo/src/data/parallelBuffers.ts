import type { NumericRange } from './selection.ts';
import {
  PARALLEL_PARAMETERS,
  type ParallelDataset,
  type ParallelParameter,
} from './types.ts';

export interface ParallelAxisDomain {
  max: number;
  min: number;
  span: number;
}

export type ParallelAxisDomains = Record<ParallelParameter, ParallelAxisDomain>;
export interface ParallelCompactNumericView {
  readonly __parallelCompactNumericView: true;
  readonly [index: number]: number;
  readonly length: number;
}
export type ParallelRawValuesByAxis = Record<
  ParallelParameter,
  | Float32Array
  | Float64Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | ParallelCompactNumericView
>;
export type ParallelNormalizedValuesByAxis = Record<ParallelParameter, Float32Array>;

export interface ParallelLineSeriesBuffers {
  gapCount: number;
  pointsPerRecord: number;
  sampleCount: number;
  x: Float32Array;
  y: Float32Array;
}

export interface ParallelSelectedLineSeriesBuffers extends ParallelLineSeriesBuffers {
  selectedRecordCount: number;
}

export interface ParallelWebglSegmentBuffers {
  positions: Float32Array;
  segmentCount: number;
  sourceIndices: Uint32Array;
  valuesPerVertex: 2;
  verticesPerSegment: 2;
}

export interface ParallelSelectedWebglSegmentBuffers extends ParallelWebglSegmentBuffers {
  selectedRecordCount: number;
}

export interface ParallelBuffers {
  axisCount: number;
  axisOrder: readonly ParallelParameter[];
  domainsByAxis: ParallelAxisDomains;
  ids: readonly string[];
  lineSeriesBuffers: ParallelLineSeriesBuffers;
  missingValueCountByAxis?: Readonly<Record<ParallelParameter, number>>;
  normalizedValuesDerivedFromRaw?: boolean;
  normalizedValuesByAxis: ParallelNormalizedValuesByAxis;
  preselectedCount: number;
  preselectedSourceIndices: Uint32Array;
  rawValuesByAxis: ParallelRawValuesByAxis;
  recordIdentityBySourceIndex?: readonly ParallelSelectedRecord[];
  recordCount: number;
  webglSegmentBuffers?: ParallelWebglSegmentBuffers;
}

export interface ParallelSelectedRecord {
  id: string;
  sourceIndex: number;
  table: string;
}

export interface CreateParallelBuffersOptions {
  includeWebglSegmentBuffers?: boolean;
}

export type ParallelBrushIntervalInput =
  | NumericRange
  | readonly NumericRange[]
  | null
  | undefined;

export type ParallelBrushIntervals = Partial<
  Record<ParallelParameter, ParallelBrushIntervalInput>
>;

export interface ParallelActiveBrushInterval extends NumericRange {
  axisRangeIndex: number;
  parameter: ParallelParameter;
}

export interface ParallelBrushSelectionResult {
  activeBrushes: readonly ParallelActiveBrushInterval[];
  selectedCount: number;
  sourceIndexCreationMs?: number;
  sourceIndices: Uint32Array;
}

export interface ParallelNearestRecordQuery {
  axisPosition: number;
  buffers: ParallelBuffers;
  maxDistancePx: number;
  normalizedValue: number;
  plotHeightPx: number;
  plotWidthPx: number;
}

export interface ParallelNearestRecordResult {
  activeAxis: ParallelParameter;
  activeAxisValue: number;
  distancePx: number;
  id: string;
  normalizedAxisValue: number;
  projectedAxisPosition: number;
  projectedNormalizedValue: number;
  recordIndex: number;
  segmentEndAxis: ParallelParameter;
  segmentStartAxis: ParallelParameter;
}

export function createParallelBuffers(
  dataset: ParallelDataset,
  options: CreateParallelBuffersOptions = {},
): ParallelBuffers {
  const axisOrder = [...dataset.metadata.attributes.parameters];
  const recordCount = dataset.records.length;
  const rawValuesByAxis = createAxisMap(
    axisOrder,
    () => new Float64Array(recordCount),
  ) as ParallelRawValuesByAxis;
  const domainsByAxis = createAxisMap(axisOrder, () => ({
    max: Number.NEGATIVE_INFINITY,
    min: Number.POSITIVE_INFINITY,
    span: 0,
  })) as ParallelAxisDomains;
  const ids = new Array<string>(recordCount);
  const missingValueCountByAxis = createAxisMap(axisOrder, () => 0) as Record<
    ParallelParameter,
    number
  >;
  const preselectedIndices: number[] = [];

  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    const record = dataset.records[recordIndex];
    ids[recordIndex] = record.id;
    if (record.selected === true) {
      preselectedIndices.push(recordIndex);
    }

    for (const parameter of axisOrder) {
      const value = Number(record[parameter]);
      (rawValuesByAxis[parameter] as Float64Array)[recordIndex] = value;

      if (!Number.isFinite(value)) {
        missingValueCountByAxis[parameter] += 1;
        continue;
      }

      const domain = domainsByAxis[parameter];
      if (value < domain.min) {
        domain.min = value;
      }
      if (value > domain.max) {
        domain.max = value;
      }
    }
  }

  for (const parameter of axisOrder) {
    const domain = domainsByAxis[parameter];

    if (recordCount === 0) {
      domain.min = 0;
      domain.max = 0;
    }

    domain.span = domain.max - domain.min;
  }

  const normalizedValuesByAxis = createNormalizedValuesByAxis(
    rawValuesByAxis,
    domainsByAxis,
    axisOrder,
    recordCount,
  );
  const lineSeriesBuffers = createParallelLineSeriesBuffers(
    normalizedValuesByAxis,
    axisOrder,
    recordCount,
  );

  return {
    axisCount: axisOrder.length,
    axisOrder,
    domainsByAxis,
    ids,
    lineSeriesBuffers,
    missingValueCountByAxis,
    normalizedValuesByAxis,
    preselectedCount: preselectedIndices.length,
    preselectedSourceIndices: Uint32Array.from(preselectedIndices),
    rawValuesByAxis,
    recordCount,
    ...(options.includeWebglSegmentBuffers
      ? {
          webglSegmentBuffers: createParallelWebglSegmentBuffers(
            normalizedValuesByAxis,
            axisOrder,
            recordCount,
          ),
        }
      : {}),
  };
}

export function selectParallelRecordIdsByBrushes(
  buffers: ParallelBuffers,
  brushIntervals: ParallelBrushIntervals,
): ParallelBrushSelectionResult {
  const activeBrushes = normalizeParallelBrushIntervals(
    brushIntervals,
    buffers.axisOrder,
  );
  const selectedIndices: number[] = [];
  const sourceIndexStartedAt = performance.now();

  for (let recordIndex = 0; recordIndex < buffers.recordCount; recordIndex += 1) {
    if (recordMatchesBrushes(buffers, recordIndex, activeBrushes)) {
      selectedIndices.push(recordIndex);
    }
  }

  const sourceIndices = Uint32Array.from(selectedIndices);
  const sourceIndexCreationMs = performance.now() - sourceIndexStartedAt;
  return {
    activeBrushes,
    selectedCount: sourceIndices.length,
    sourceIndexCreationMs,
    sourceIndices,
  };
}

export function materializeParallelSelectedIds(
  buffers: ParallelBuffers,
  sourceIndices: Uint32Array | readonly number[],
): string[] {
  const ids = new Array<string>(sourceIndices.length);
  let offset = 0;

  for (const sourceIndex of sourceIndices) {
    if (
      Number.isInteger(sourceIndex) &&
      sourceIndex >= 0 &&
      sourceIndex < buffers.recordCount
    ) {
      ids[offset] = buffers.ids[sourceIndex];
      offset += 1;
    }
  }

  return offset === ids.length ? ids : ids.slice(0, offset);
}

export function sampleParallelSelectedIdsFromSourceIndices(
  buffers: ParallelBuffers,
  sourceIndices: Uint32Array | readonly number[],
  limit: number,
): string[] {
  if (limit <= 0) {
    return [];
  }

  const sampleIds: string[] = [];

  for (const sourceIndex of sourceIndices) {
    if (
      Number.isInteger(sourceIndex) &&
      sourceIndex >= 0 &&
      sourceIndex < buffers.recordCount
    ) {
      sampleIds.push(buffers.ids[sourceIndex]);

      if (sampleIds.length >= limit) {
        break;
      }
    }
  }

  return sampleIds;
}

export function serializeParallelSelectedIdsForExport(
  buffers: ParallelBuffers,
  sourceIndices: Uint32Array | readonly number[],
): string {
  return materializeParallelSelectedIds(buffers, sourceIndices).join('\n');
}

export function materializeParallelSelectedRecords(
  buffers: Pick<ParallelBuffers, 'ids' | 'recordCount' | 'recordIdentityBySourceIndex'>,
  sourceIndices: Uint32Array | readonly number[],
): ParallelSelectedRecord[] {
  const records: ParallelSelectedRecord[] = [];

  for (const sourceIndex of sourceIndices) {
    if (
      Number.isInteger(sourceIndex) &&
      sourceIndex >= 0 &&
      sourceIndex < buffers.recordCount
    ) {
      records.push(
        buffers.recordIdentityBySourceIndex?.[sourceIndex] ?? {
          id: buffers.ids[sourceIndex],
          sourceIndex,
          table: 'benchmark-primary',
        },
      );
    }
  }

  return records;
}

export function serializeParallelSelectedRecordsForExport(
  buffers: Pick<ParallelBuffers, 'ids' | 'recordCount' | 'recordIdentityBySourceIndex'>,
  sourceIndices: Uint32Array | readonly number[],
): string {
  const rows = materializeParallelSelectedRecords(buffers, sourceIndices).map(
    (record) => `${record.table}\t${record.id}`,
  );

  return `table\tid\n${rows.join('\n')}${rows.length === 0 ? '' : '\n'}`;
}

export function createSelectedParallelLineSeriesBuffers(
  buffers: ParallelBuffers,
  sourceIndices: Uint32Array | readonly number[],
): ParallelSelectedLineSeriesBuffers {
  const pointsPerRecord = buffers.axisCount + 1;
  const selectedRecordCount = sourceIndices.length;
  const sampleCount = selectedRecordCount * pointsPerRecord;
  const x = new Float32Array(sampleCount);
  const y = new Float32Array(sampleCount);
  let offset = 0;

  for (const sourceIndex of sourceIndices) {
    if (
      !Number.isInteger(sourceIndex) ||
      sourceIndex < 0 ||
      sourceIndex >= buffers.recordCount
    ) {
      continue;
    }

    for (let axisIndex = 0; axisIndex < buffers.axisOrder.length; axisIndex += 1) {
      const parameter = buffers.axisOrder[axisIndex];
      x[offset] = axisIndex;
      y[offset] = buffers.normalizedValuesByAxis[parameter][sourceIndex];
      offset += 1;
    }

    x[offset] = Number.NaN;
    y[offset] = Number.NaN;
    offset += 1;
  }

  if (offset !== sampleCount) {
    const validRecordCount = offset / pointsPerRecord;

    return {
      gapCount: validRecordCount,
      pointsPerRecord,
      sampleCount: offset,
      selectedRecordCount: validRecordCount,
      x: x.slice(0, offset),
      y: y.slice(0, offset),
    };
  }

  return {
    gapCount: selectedRecordCount,
    pointsPerRecord,
    sampleCount,
    selectedRecordCount,
    x,
    y,
  };
}

export function createSelectedParallelWebglSegmentBuffers(
  buffers: ParallelBuffers,
  sourceIndices: Uint32Array | readonly number[],
): ParallelSelectedWebglSegmentBuffers {
  const segmentsPerRecord = Math.max(0, buffers.axisCount - 1);
  const segmentCount = sourceIndices.length * segmentsPerRecord;
  const positions = new Float32Array(segmentCount * 2 * 2);
  const selectedSegmentSourceIndices = new Uint32Array(segmentCount);
  let selectedRecordCount = 0;
  let segmentIndex = 0;
  let positionOffset = 0;

  for (const sourceIndex of sourceIndices) {
    if (
      !Number.isInteger(sourceIndex) ||
      sourceIndex < 0 ||
      sourceIndex >= buffers.recordCount
    ) {
      continue;
    }

    selectedRecordCount += 1;

    for (let axisIndex = 0; axisIndex < buffers.axisOrder.length - 1; axisIndex += 1) {
      const startParameter = buffers.axisOrder[axisIndex];
      const endParameter = buffers.axisOrder[axisIndex + 1];

      positions[positionOffset] = axisIndex;
      positions[positionOffset + 1] =
        buffers.normalizedValuesByAxis[startParameter][sourceIndex];
      positions[positionOffset + 2] = axisIndex + 1;
      positions[positionOffset + 3] =
        buffers.normalizedValuesByAxis[endParameter][sourceIndex];
      selectedSegmentSourceIndices[segmentIndex] = sourceIndex;

      segmentIndex += 1;
      positionOffset += 4;
    }
  }

  if (positionOffset !== positions.length || segmentIndex !== segmentCount) {
    return {
      positions: positions.slice(0, positionOffset),
      segmentCount: segmentIndex,
      selectedRecordCount,
      sourceIndices: selectedSegmentSourceIndices.slice(0, segmentIndex),
      valuesPerVertex: 2,
      verticesPerSegment: 2,
    };
  }

  return {
    positions,
    segmentCount,
    selectedRecordCount,
    sourceIndices: selectedSegmentSourceIndices,
    valuesPerVertex: 2,
    verticesPerSegment: 2,
  };
}

export function findNearestParallelRecordByPoint({
  axisPosition,
  buffers,
  maxDistancePx,
  normalizedValue,
  plotHeightPx,
  plotWidthPx,
}: ParallelNearestRecordQuery): ParallelNearestRecordResult | null {
  if (
    buffers.recordCount === 0 ||
    buffers.axisCount < 2 ||
    maxDistancePx < 0 ||
    plotWidthPx <= 0 ||
    plotHeightPx <= 0 ||
    !Number.isFinite(axisPosition) ||
    !Number.isFinite(normalizedValue)
  ) {
    return null;
  }

  const clampedAxisPosition = clampNumber(
    axisPosition,
    0,
    Math.max(0, buffers.axisCount - 1),
  );
  const clampedNormalizedValue = clampNumber(normalizedValue, 0, 1);
  const xScale = plotWidthPx / Math.max(1, buffers.axisCount - 1);
  const pointerX = clampedAxisPosition * xScale;
  const pointerY = (1 - clampedNormalizedValue) * plotHeightPx;
  let nearest: ParallelNearestRecordResult | null = null;
  let nearestDistanceSquared = maxDistancePx * maxDistancePx;

  for (let recordIndex = 0; recordIndex < buffers.recordCount; recordIndex += 1) {
    for (let axisIndex = 0; axisIndex < buffers.axisCount - 1; axisIndex += 1) {
      const startAxis = buffers.axisOrder[axisIndex];
      const endAxis = buffers.axisOrder[axisIndex + 1];
      const startNormalized = buffers.normalizedValuesByAxis[startAxis][recordIndex];
      const endNormalized = buffers.normalizedValuesByAxis[endAxis][recordIndex];
      const startX = axisIndex * xScale;
      const startY = (1 - startNormalized) * plotHeightPx;
      const endX = (axisIndex + 1) * xScale;
      const endY = (1 - endNormalized) * plotHeightPx;
      const deltaX = endX - startX;
      const deltaY = endY - startY;
      const segmentLengthSquared = deltaX * deltaX + deltaY * deltaY;
      const projection =
        segmentLengthSquared === 0
          ? 0
          : clampNumber(
              ((pointerX - startX) * deltaX + (pointerY - startY) * deltaY) /
                segmentLengthSquared,
              0,
              1,
            );
      const projectedX = startX + deltaX * projection;
      const projectedY = startY + deltaY * projection;
      const distanceX = pointerX - projectedX;
      const distanceY = pointerY - projectedY;
      const distanceSquared = distanceX * distanceX + distanceY * distanceY;

      if (distanceSquared > nearestDistanceSquared) {
        continue;
      }

      const activeAxisIndex = clampNumber(
        Math.round(clampedAxisPosition),
        0,
        buffers.axisCount - 1,
      );
      const activeAxis = buffers.axisOrder[activeAxisIndex];

      nearestDistanceSquared = distanceSquared;
      nearest = {
        activeAxis,
        activeAxisValue: buffers.rawValuesByAxis[activeAxis][recordIndex],
        distancePx: Math.sqrt(distanceSquared),
        id: buffers.ids[recordIndex],
        normalizedAxisValue: buffers.normalizedValuesByAxis[activeAxis][recordIndex],
        projectedAxisPosition: axisIndex + projection,
        projectedNormalizedValue:
          startNormalized + (endNormalized - startNormalized) * projection,
        recordIndex,
        segmentEndAxis: endAxis,
        segmentStartAxis: startAxis,
      };
    }
  }

  return nearest;
}

export function normalizeParallelBrushIntervals(
  brushIntervals: ParallelBrushIntervals,
  axisOrder: readonly ParallelParameter[] = PARALLEL_PARAMETERS,
): ParallelActiveBrushInterval[] {
  const activeBrushes: ParallelActiveBrushInterval[] = [];

  for (const parameter of axisOrder) {
    const intervals = normalizeBrushIntervalInput(brushIntervals[parameter]);

    for (let axisRangeIndex = 0; axisRangeIndex < intervals.length; axisRangeIndex += 1) {
      const interval = intervals[axisRangeIndex];

      if (!Number.isFinite(interval.min) || !Number.isFinite(interval.max)) {
        throw new Error(
          `Parallel brush interval for ${parameter} must use finite min and max values.`,
        );
      }

      activeBrushes.push({
        axisRangeIndex,
        parameter,
        max: Math.max(interval.min, interval.max),
        min: Math.min(interval.min, interval.max),
      });
    }
  }

  return activeBrushes;
}

function createNormalizedValuesByAxis(
  rawValuesByAxis: ParallelRawValuesByAxis,
  domainsByAxis: ParallelAxisDomains,
  axisOrder: readonly ParallelParameter[],
  recordCount: number,
): ParallelNormalizedValuesByAxis {
  const normalizedValuesByAxis = createAxisMap(
    axisOrder,
    () => new Float32Array(recordCount),
  ) as ParallelNormalizedValuesByAxis;

  for (const parameter of axisOrder) {
    const rawValues = rawValuesByAxis[parameter];
    const normalizedValues = normalizedValuesByAxis[parameter];
    const domain = domainsByAxis[parameter];

    for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
      normalizedValues[recordIndex] =
        domain.span === 0 ? 0.5 : (rawValues[recordIndex] - domain.min) / domain.span;
    }
  }

  return normalizedValuesByAxis;
}

function createParallelLineSeriesBuffers(
  normalizedValuesByAxis: ParallelNormalizedValuesByAxis,
  axisOrder: readonly ParallelParameter[],
  recordCount: number,
): ParallelLineSeriesBuffers {
  const pointsPerRecord = axisOrder.length + 1;
  const sampleCount = recordCount * pointsPerRecord;
  const x = new Float32Array(sampleCount);
  const y = new Float32Array(sampleCount);
  let offset = 0;

  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    for (let axisIndex = 0; axisIndex < axisOrder.length; axisIndex += 1) {
      const parameter = axisOrder[axisIndex];
      x[offset] = axisIndex;
      y[offset] = normalizedValuesByAxis[parameter][recordIndex];
      offset += 1;
    }

    x[offset] = Number.NaN;
    y[offset] = Number.NaN;
    offset += 1;
  }

  return {
    gapCount: recordCount,
    pointsPerRecord,
    sampleCount,
    x,
    y,
  };
}

function createParallelWebglSegmentBuffers(
  normalizedValuesByAxis: ParallelNormalizedValuesByAxis,
  axisOrder: readonly ParallelParameter[],
  recordCount: number,
): ParallelWebglSegmentBuffers {
  const segmentCount = Math.max(0, recordCount * (axisOrder.length - 1));
  const positions = new Float32Array(segmentCount * 2 * 2);
  const sourceIndices = new Uint32Array(segmentCount);
  let segmentIndex = 0;
  let positionOffset = 0;

  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    for (let axisIndex = 0; axisIndex < axisOrder.length - 1; axisIndex += 1) {
      const startParameter = axisOrder[axisIndex];
      const endParameter = axisOrder[axisIndex + 1];

      positions[positionOffset] = axisIndex;
      positions[positionOffset + 1] =
        normalizedValuesByAxis[startParameter][recordIndex];
      positions[positionOffset + 2] = axisIndex + 1;
      positions[positionOffset + 3] = normalizedValuesByAxis[endParameter][recordIndex];
      sourceIndices[segmentIndex] = recordIndex;

      segmentIndex += 1;
      positionOffset += 4;
    }
  }

  return {
    positions,
    segmentCount,
    sourceIndices,
    valuesPerVertex: 2,
    verticesPerSegment: 2,
  };
}

function recordMatchesBrushes(
  buffers: ParallelBuffers,
  recordIndex: number,
  activeBrushes: readonly ParallelActiveBrushInterval[],
): boolean {
  let currentParameter: ParallelParameter | null = null;
  let currentAxisMatched = false;

  for (const brush of activeBrushes) {
    if (brush.parameter !== currentParameter) {
      if (currentParameter !== null && !currentAxisMatched) {
        return false;
      }
      currentParameter = brush.parameter;
      currentAxisMatched = false;
    }
    if (currentAxisMatched) {
      continue;
    }

    const value = buffers.rawValuesByAxis[brush.parameter][recordIndex];

    if (!Number.isFinite(value) || value < brush.min || value > brush.max) {
      continue;
    }

    currentAxisMatched = true;
  }

  return currentParameter === null || currentAxisMatched;
}

function normalizeBrushIntervalInput(
  interval: ParallelBrushIntervalInput,
): readonly NumericRange[] {
  if (interval === null || interval === undefined) {
    return [];
  }

  return Array.isArray(interval)
    ? (interval as readonly NumericRange[])
    : [interval as NumericRange];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createAxisMap<T>(
  axisOrder: readonly ParallelParameter[],
  factory: (parameter: ParallelParameter, axisIndex: number) => T,
): Record<ParallelParameter, T> {
  return Object.fromEntries(
    axisOrder.map((parameter, axisIndex) => [
      parameter,
      factory(parameter, axisIndex),
    ]),
  ) as Record<ParallelParameter, T>;
}
