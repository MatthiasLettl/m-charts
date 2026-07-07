import type { NumericRange } from './selection.js';
import type {
  ParallelFastAxisKey,
  ParallelFastAxisMetadata,
  ParallelFastAxisSpec,
  ParallelFastCategorySpec,
  ParallelFastColumns,
  ParallelFastColorArray,
  ParallelFastOpacityArray,
  ParallelFastValueArray,
} from './types.js';

export type ParallelParameter = ParallelFastAxisKey;

export interface ParallelDataset {
  metadata: {
    attributes: {
      parameters: readonly ParallelParameter[];
    };
  };
  records: readonly (Record<ParallelParameter, unknown> & {
    id: string;
    selected?: boolean;
  })[];
}

const PARALLEL_PARAMETERS: readonly ParallelParameter[] = [];

export interface ParallelAxisDomain {
  max: number;
  min: number;
  span: number;
}

export type ParallelAxisDomains = Record<ParallelParameter, ParallelAxisDomain>;
export type ParallelRawValuesByAxis = Record<ParallelParameter, Float64Array>;
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
  sourceIndicesByVertex?: Uint32Array;
  valuesPerVertex: 2;
  verticesPerSegment: 2;
}

export interface ParallelSelectedWebglSegmentBuffers extends ParallelWebglSegmentBuffers {
  selectedRecordCount: number;
}

export interface ParallelBuffers {
  axisCount: number;
  axisMetadataByAxis?: Readonly<Record<ParallelParameter, ParallelFastAxisMetadata>>;
  axisOrder: readonly ParallelParameter[];
  domainsByAxis: ParallelAxisDomains;
  ids: readonly string[];
  lineSeriesBuffers: ParallelLineSeriesBuffers;
  normalizedValuesByAxis: ParallelNormalizedValuesByAxis;
  preselectedCount: number;
  preselectedSourceIndices: Uint32Array;
  rawValuesByAxis: ParallelRawValuesByAxis;
  recordIdentityBySourceIndex?: readonly ParallelSelectedRecord[];
  recordCount: number;
  styleBuffers?: ParallelStyleBuffers;
  webglSegmentBuffers?: ParallelWebglSegmentBuffers;
}

export interface ParallelSelectedRecord {
  id: string;
  sourceIndex: number;
  table: string;
}

export interface ParallelStyleBuffers {
  color: Uint8Array;
  colorFormat: 'rgba8';
  opacity: Float32Array;
  styledRecordCount: number;
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
  record?: ParallelSelectedRecord;
  recordIndex: number;
  segmentEndAxis: ParallelParameter;
  segmentStartAxis: ParallelParameter;
}

export interface ParallelRoutedSegment {
  endAxis: ParallelParameter;
  endAxisIndex: number;
  endNormalizedValue: number;
  startAxis: ParallelParameter;
  startAxisIndex: number;
  startNormalizedValue: number;
}

type ParallelAxisEncoder =
  | {
      kind: 'numeric';
      metadata: ParallelFastAxisMetadata;
    }
  | {
      dictionary: Map<string, number>;
      categories: { encoded: number; label: string; value: string }[];
      kind: 'categorical' | 'boolean';
      metadata: ParallelFastAxisMetadata;
    }
  | {
      epochNsValues: (string | undefined)[];
      kind: 'datetime-ns';
      metadata: ParallelFastAxisMetadata;
      origin: bigint | null;
    };

const NS_PER_MS = 1_000_000n;
const BYTES_PER_RGBA_COLOR = 4;
export const PARALLEL_FAST_SMALL_DISCRETE_TICK_LIMIT = 12;
export const PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y = -0.0625;
export const PARALLEL_MISSING_AXIS_DISPLAY_VALUE = 0.04;
export const PARALLEL_AXIS_MIN_DISPLAY_VALUE = 0.08;

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
  const preselectedIndices: number[] = [];

  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    const record = dataset.records[recordIndex];
    ids[recordIndex] = record.id;
    if (record.selected === true) {
      preselectedIndices.push(recordIndex);
    }

    for (const parameter of axisOrder) {
      const value = Number(record[parameter]);
      rawValuesByAxis[parameter][recordIndex] = value;

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
    axisMetadataByAxis: createDefaultAxisMetadataByAxis(axisOrder, domainsByAxis),
    axisOrder,
    domainsByAxis,
    ids,
    lineSeriesBuffers,
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

export function createParallelFastBuffers(
  columns: ParallelFastColumns,
  options: CreateParallelBuffersOptions = {},
): ParallelBuffers {
  const axisOrder = [...columns.axisOrder];
  const recordCount = columns.ids.length;
  const axisSpecByKey = new Map((columns.axes ?? []).map((axis) => [axis.key, axis]));
  const rawValuesByAxis = createAxisMap(axisOrder, () => new Float64Array(recordCount));
  const domainsByAxis = createAxisMap(axisOrder, () => ({
    max: Number.NEGATIVE_INFINITY,
    min: Number.POSITIVE_INFINITY,
    span: 0,
  })) as ParallelAxisDomains;
  const axisMetadataByAxis: Record<ParallelParameter, ParallelFastAxisMetadata> = {};

  for (const parameter of axisOrder) {
    const sourceValues = columns.valuesByAxis[parameter];
    const rawValues = rawValuesByAxis[parameter];
    const domain = domainsByAxis[parameter];
    const encoder = createParallelAxisEncoder(parameter, axisSpecByKey.get(parameter));

    if (sourceValues === undefined) {
      throw new Error(`Parallel-fast axis "${parameter}" is missing typed values.`);
    }
    if (sourceValues.length !== recordCount) {
      throw new Error(
        `Parallel-fast axis "${parameter}" has ${sourceValues.length} values for ${recordCount} IDs.`,
      );
    }

    for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
      const value = encodeParallelAxisValue(
        encoder,
        sourceValues,
        parameter,
        recordIndex,
      );
      rawValues[recordIndex] = value;

      if (!Number.isFinite(value)) {
        continue;
      }
      if (value < domain.min) {
        domain.min = value;
      }
      if (value > domain.max) {
        domain.max = value;
      }
    }

    if (encoder.kind === 'categorical' || encoder.kind === 'boolean') {
      domain.min = encoder.categories.length === 0 ? 0 : -0.5;
      domain.max =
        encoder.categories.length === 0 ? 0 : encoder.categories.length - 0.5;
    } else if (
      recordCount === 0 ||
      domain.min === Number.POSITIVE_INFINITY ||
      domain.max === Number.NEGATIVE_INFINITY
    ) {
      domain.min = 0;
      domain.max = 0;
    }
    domain.span = domain.max - domain.min;
    axisMetadataByAxis[parameter] = finalizeParallelAxisMetadata(
      encoder,
      domain,
    );
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
  const preselectedSourceIndices = columns.preselectedSourceIndices ?? new Uint32Array(0);
  const styleBuffers = createParallelStyleBuffers(columns, recordCount);

  return {
    axisCount: axisOrder.length,
    axisMetadataByAxis,
    axisOrder,
    domainsByAxis,
    ids: columns.ids,
    lineSeriesBuffers,
    normalizedValuesByAxis,
    preselectedCount: preselectedSourceIndices.length,
    preselectedSourceIndices,
    rawValuesByAxis,
    recordIdentityBySourceIndex: columns.recordIdentityBySourceIndex,
    recordCount,
    ...(styleBuffers ? { styleBuffers } : {}),
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
      !Number.isInteger(sourceIndex) ||
      sourceIndex < 0 ||
      sourceIndex >= buffers.recordCount
    ) {
      continue;
    }
    records.push(
      buffers.recordIdentityBySourceIndex?.[sourceIndex] ?? {
        id: buffers.ids[sourceIndex],
        sourceIndex,
        table: 'benchmark-primary',
      },
    );
  }

  return records;
}

export function resolveParallelRecordIdentity(
  buffers: Pick<ParallelBuffers, 'recordIdentityBySourceIndex'>,
  sourceIndex: number,
): ParallelSelectedRecord | undefined {
  return buffers.recordIdentityBySourceIndex?.[sourceIndex];
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

    forEachParallelRoutedSegment(
      buffers.normalizedValuesByAxis,
      buffers.axisOrder,
      sourceIndex,
      (segment) => {
        positions[positionOffset] = segment.startAxisIndex;
        positions[positionOffset + 1] = segment.startNormalizedValue;
        positions[positionOffset + 2] = segment.endAxisIndex;
        positions[positionOffset + 3] = segment.endNormalizedValue;
        selectedSegmentSourceIndices[segmentIndex] = sourceIndex;

        segmentIndex += 1;
        positionOffset += 4;
      },
    );
  }

  if (positionOffset !== positions.length || segmentIndex !== segmentCount) {
    return {
      positions: positions.slice(0, positionOffset),
      segmentCount: segmentIndex,
      selectedRecordCount,
      sourceIndices: selectedSegmentSourceIndices.slice(0, segmentIndex),
      sourceIndicesByVertex: expandSegmentSourceIndicesByVertex(
        selectedSegmentSourceIndices.slice(0, segmentIndex),
      ),
      valuesPerVertex: 2,
      verticesPerSegment: 2,
    };
  }

  return {
    positions,
    segmentCount: segmentIndex,
    selectedRecordCount,
    sourceIndices:
      segmentIndex === selectedSegmentSourceIndices.length
        ? selectedSegmentSourceIndices
        : selectedSegmentSourceIndices.slice(0, segmentIndex),
    sourceIndicesByVertex: expandSegmentSourceIndicesByVertex(
      segmentIndex === selectedSegmentSourceIndices.length
        ? selectedSegmentSourceIndices
        : selectedSegmentSourceIndices.slice(0, segmentIndex),
    ),
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
  const clampedNormalizedValue = projectParallelRenderedNormalizedValue(normalizedValue);
  const xScale = plotWidthPx / Math.max(1, buffers.axisCount - 1);
  const pointerX = clampedAxisPosition * xScale;
  const pointerY =
    (1 - parallelRenderedNormalizedValueToDisplayValue(clampedNormalizedValue)) *
    plotHeightPx;
  let nearest: ParallelNearestRecordResult | null = null;
  let nearestDistanceSquared = maxDistancePx * maxDistancePx;

  for (let recordIndex = 0; recordIndex < buffers.recordCount; recordIndex += 1) {
    forEachParallelRoutedSegment(
      buffers.normalizedValuesByAxis,
      buffers.axisOrder,
      recordIndex,
      (segment) => {
        const startNormalized = projectParallelRenderedNormalizedValue(
          segment.startNormalizedValue,
        );
        const endNormalized = projectParallelRenderedNormalizedValue(
          segment.endNormalizedValue,
        );
        const startX = segment.startAxisIndex * xScale;
        const startY =
          (1 - parallelRenderedNormalizedValueToDisplayValue(startNormalized)) *
          plotHeightPx;
        const endX = segment.endAxisIndex * xScale;
        const endY =
          (1 - parallelRenderedNormalizedValueToDisplayValue(endNormalized)) *
          plotHeightPx;
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
          return;
        }

        const activeAxisIndex = clampNumber(
          Math.round(clampedAxisPosition),
          0,
          buffers.axisCount - 1,
        );
        const activeAxis = buffers.axisOrder[activeAxisIndex];

        nearestDistanceSquared = distanceSquared;
        const record = resolveParallelRecordIdentity(buffers, recordIndex);
        nearest = {
          activeAxis,
          activeAxisValue: buffers.rawValuesByAxis[activeAxis][recordIndex],
          distancePx: Math.sqrt(distanceSquared),
          id: buffers.ids[recordIndex],
          normalizedAxisValue: buffers.normalizedValuesByAxis[activeAxis][recordIndex],
          projectedAxisPosition:
            segment.startAxisIndex +
            (segment.endAxisIndex - segment.startAxisIndex) * projection,
          projectedNormalizedValue:
            startNormalized + (endNormalized - startNormalized) * projection,
          ...(record === undefined ? {} : { record }),
          recordIndex,
          segmentEndAxis: segment.endAxis,
          segmentStartAxis: segment.startAxis,
        };
      },
    );
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
        !Number.isFinite(rawValues[recordIndex])
          ? Number.NaN
          : domain.span === 0
            ? 0.5
            : (rawValues[recordIndex] - domain.min) / domain.span;
    }
  }

  return normalizedValuesByAxis;
}

export function createParallelLineSeriesBuffers(
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

export function createParallelWebglSegmentBuffers(
  normalizedValuesByAxis: ParallelNormalizedValuesByAxis,
  axisOrder: readonly ParallelParameter[],
  recordCount: number,
): ParallelWebglSegmentBuffers {
  const maxSegmentCount = Math.max(0, recordCount * (axisOrder.length - 1));
  const positions = new Float32Array(maxSegmentCount * 2 * 2);
  const sourceIndices = new Uint32Array(maxSegmentCount);
  let segmentIndex = 0;
  let positionOffset = 0;

  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    forEachParallelRoutedSegment(
      normalizedValuesByAxis,
      axisOrder,
      recordIndex,
      (segment) => {
        positions[positionOffset] = segment.startAxisIndex;
        positions[positionOffset + 1] = segment.startNormalizedValue;
        positions[positionOffset + 2] = segment.endAxisIndex;
        positions[positionOffset + 3] = segment.endNormalizedValue;
        sourceIndices[segmentIndex] = recordIndex;

        segmentIndex += 1;
        positionOffset += 4;
      },
    );
  }

  const compactSourceIndices =
    segmentIndex === sourceIndices.length
      ? sourceIndices
      : sourceIndices.slice(0, segmentIndex);

  return {
    positions:
      positionOffset === positions.length ? positions : positions.slice(0, positionOffset),
    segmentCount: segmentIndex,
    sourceIndices: compactSourceIndices,
    sourceIndicesByVertex: expandSegmentSourceIndicesByVertex(compactSourceIndices),
    valuesPerVertex: 2,
    verticesPerSegment: 2,
  };
}

export function forEachParallelRoutedSegment(
  normalizedValuesByAxis: ParallelNormalizedValuesByAxis,
  axisOrder: readonly ParallelParameter[],
  recordIndex: number,
  callback: (segment: ParallelRoutedSegment) => void,
): void {
  let axisIndex = 0;

  while (axisIndex < axisOrder.length - 1) {
    const startAxis = axisOrder[axisIndex];
    const startNormalizedValue = normalizedValuesByAxis[startAxis][recordIndex];

    if (!Number.isFinite(startNormalizedValue)) {
      axisIndex += 1;
      continue;
    }

    const nextAxisIndex = axisIndex + 1;
    const nextAxis = axisOrder[nextAxisIndex];
    const nextNormalizedValue = normalizedValuesByAxis[nextAxis][recordIndex];

    if (Number.isFinite(nextNormalizedValue)) {
      callback({
        endAxis: nextAxis,
        endAxisIndex: nextAxisIndex,
        endNormalizedValue: nextNormalizedValue,
        startAxis,
        startAxisIndex: axisIndex,
        startNormalizedValue,
      });
      axisIndex += 1;
      continue;
    }

    let reconnectAxisIndex = nextAxisIndex + 1;
    while (reconnectAxisIndex < axisOrder.length) {
      const reconnectAxis = axisOrder[reconnectAxisIndex];
      if (Number.isFinite(normalizedValuesByAxis[reconnectAxis][recordIndex])) {
        break;
      }
      reconnectAxisIndex += 1;
    }

    if (reconnectAxisIndex >= axisOrder.length) {
      break;
    }

    for (
      let routedAxisIndex = axisIndex;
      routedAxisIndex < reconnectAxisIndex;
      routedAxisIndex += 1
    ) {
      const routedStartAxis = axisOrder[routedAxisIndex];
      const routedEndAxis = axisOrder[routedAxisIndex + 1];
      callback({
        endAxis: routedEndAxis,
        endAxisIndex: routedAxisIndex + 1,
        endNormalizedValue:
          routedAxisIndex + 1 === reconnectAxisIndex
            ? normalizedValuesByAxis[routedEndAxis][recordIndex]
            : PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
        startAxis: routedStartAxis,
        startAxisIndex: routedAxisIndex,
        startNormalizedValue:
          routedAxisIndex === axisIndex
            ? startNormalizedValue
            : PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
      });
    }

    axisIndex = reconnectAxisIndex;
  }
}

export function projectParallelRenderedNormalizedValue(value: number): number {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }

  return clampNumber(value, PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y, 1);
}

export function parallelRenderedNormalizedValueToDisplayValue(value: number): number {
  const projected = projectParallelRenderedNormalizedValue(value);
  if (!Number.isFinite(projected)) {
    return Number.NaN;
  }

  if (projected <= 0) {
    return (
      PARALLEL_MISSING_AXIS_DISPLAY_VALUE +
      ((projected - PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y) /
        (0 - PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y)) *
        (PARALLEL_AXIS_MIN_DISPLAY_VALUE - PARALLEL_MISSING_AXIS_DISPLAY_VALUE)
    );
  }

  return (
    PARALLEL_AXIS_MIN_DISPLAY_VALUE +
    projected * (1 - PARALLEL_AXIS_MIN_DISPLAY_VALUE)
  );
}

export function parallelDisplayValueToRenderedNormalizedValue(value: number): number {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }

  const clampedValue = clampNumber(value, PARALLEL_MISSING_AXIS_DISPLAY_VALUE, 1);
  if (clampedValue <= PARALLEL_AXIS_MIN_DISPLAY_VALUE) {
    return (
      PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y +
      ((clampedValue - PARALLEL_MISSING_AXIS_DISPLAY_VALUE) /
        (PARALLEL_AXIS_MIN_DISPLAY_VALUE - PARALLEL_MISSING_AXIS_DISPLAY_VALUE)) *
        (0 - PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y)
    );
  }

  return (clampedValue - PARALLEL_AXIS_MIN_DISPLAY_VALUE) /
    (1 - PARALLEL_AXIS_MIN_DISPLAY_VALUE);
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

export interface ParallelFastAxisTick {
  fullLabel?: string;
  label: string;
  value: number;
}

export function createParallelFastAxisTicks(
  axis: ParallelFastAxisMetadata | undefined,
  { count, range }: { count?: number; range: { max: number; min: number } },
): ParallelFastAxisTick[] {
  if (axis?.kind === 'categorical' || axis?.kind === 'boolean') {
    return createParallelCategoricalTicks(
      axis,
      range,
      count ?? PARALLEL_FAST_SMALL_DISCRETE_TICK_LIMIT,
    );
  }

  if (axis?.kind === 'datetime-ns') {
    return createParallelDatetimeNsTicks(axis, { count, range });
  }

  return createParallelNumericTicks(axis, { count, range });
}

function createParallelNumericTicks(
  axis: ParallelFastAxisMetadata | undefined,
  { count = 5, range }: { count?: number; range: { max: number; min: number } },
): ParallelFastAxisTick[] {
  const safeCount = Math.max(2, Math.floor(count));
  const span = Math.max(1e-9, range.max - range.min);

  return Array.from({ length: safeCount }, (_, index) => {
    const value = range.min + (span * index) / (safeCount - 1);

    return {
      label: formatParallelFastAxisValue(axis, value),
      value,
    };
  });
}

function createParallelCategoricalTicks(
  axis: Extract<ParallelFastAxisMetadata, { kind: 'categorical' | 'boolean' }>,
  range: { max: number; min: number },
  count: number,
): ParallelFastAxisTick[] {
  const safeCount = Math.max(2, Math.floor(count));
  const visibleCategories = axis.categories.filter(
    (category) => category.encoded >= range.min && category.encoded <= range.max,
  );

  return sampleParallelTickValues(visibleCategories, safeCount).map((category) => ({
    label:
      axis.kind === 'boolean'
        ? formatBooleanCategoryLabel(category.value, category.encoded)
        : category.label,
    value: category.encoded,
  }));
}

function createParallelDatetimeNsTicks(
  axis: Extract<ParallelFastAxisMetadata, { kind: 'datetime-ns' }>,
  { count = 5, range }: { count?: number; range: { max: number; min: number } },
): ParallelFastAxisTick[] {
  const safeCount = Math.max(2, Math.floor(count));
  const span = Math.max(1e-9, range.max - range.min);
  const precision = selectParallelDatetimeTickPrecision(span);

  return Array.from({ length: safeCount }, (_, index) => {
    const value = range.min + (span * index) / (safeCount - 1);
    const epochNs = axis.datetimeOriginNsBigInt + BigInt(Math.round(value * Number(NS_PER_MS)));

    return {
      fullLabel: formatDatetimeNsEpochValue(epochNs),
      label: formatParallelDatetimeNsTickValue(epochNs, precision),
      value,
    };
  });
}

function sampleParallelTickValues<T>(
  values: readonly T[],
  count: number,
): readonly T[] {
  if (values.length <= count) {
    return values;
  }

  const maxIndex = values.length - 1;
  const sampled: T[] = [];
  let previousIndex = -1;

  for (let step = 0; step < count; step += 1) {
    const remainingSlots = count - step - 1;
    const targetIndex =
      step === count - 1
        ? maxIndex
        : Math.round((step * maxIndex) / Math.max(count - 1, 1));
    const nextIndex = Math.max(
      previousIndex + 1,
      Math.min(targetIndex, maxIndex - remainingSlots),
    );
    sampled.push(values[nextIndex]!);
    previousIndex = nextIndex;
  }

  return sampled;
}

export function formatParallelFastAxisValue(
  axis: ParallelFastAxisMetadata | undefined,
  value: number,
  sourceIndex?: number,
): string {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  if (axis?.kind === 'categorical' || axis?.kind === 'boolean') {
    const category = axis.categories.find(
      (candidate) => candidate.encoded === Math.round(value),
    );

    return axis.kind === 'boolean'
      ? formatBooleanCategoryLabel(category?.value, value)
      : category?.label ?? String(value);
  }

  if (axis?.kind === 'datetime-ns') {
    const sourceValue =
      sourceIndex === undefined ? undefined : axis.epochNsValues[sourceIndex];

    return formatDatetimeNsEpochValue(
      sourceValue === undefined
        ? axis.datetimeOriginNsBigInt +
            BigInt(Math.round(value * Number(NS_PER_MS)))
        : BigInt(sourceValue),
    );
  }

  const magnitude = Math.abs(value);
  const formatted =
    magnitude >= 1000
      ? value.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : magnitude >= 10
        ? value.toLocaleString('en-US', { maximumFractionDigits: 1 })
        : value.toLocaleString('en-US', { maximumFractionDigits: 4 });

  return axis?.unit === undefined || axis.unit === ''
    ? formatted
    : `${formatted} ${axis.unit}`;
}

export function formatParallelFastRecordAxisValue(
  buffers: Pick<ParallelBuffers, 'axisMetadataByAxis' | 'rawValuesByAxis'>,
  axis: ParallelParameter,
  recordIndex: number,
): string {
  return formatParallelFastAxisValue(
    buffers.axisMetadataByAxis?.[axis],
    buffers.rawValuesByAxis[axis]?.[recordIndex] ?? Number.NaN,
    recordIndex,
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createParallelAxisEncoder(
  parameter: ParallelParameter,
  spec: ParallelFastAxisSpec | undefined,
): ParallelAxisEncoder {
  const label = spec?.label ?? parameter;
  const unit = spec?.unit;
  const kind = spec?.kind ?? 'numeric';

  if (kind === 'categorical' || kind === 'boolean') {
    const categories = createInitialCategories(spec?.categories, kind === 'boolean');

    return {
      categories,
      dictionary: new Map(categories.map((category) => [category.value, category.encoded])),
      kind,
      metadata: {
        categories,
        domain: { max: 0, min: 0 },
        key: parameter,
        kind,
        label,
        ...(spec?.source === undefined ? {} : { source: spec.source }),
        unit,
      },
    };
  }

  if (kind === 'datetime-ns') {
    return {
      epochNsValues: [],
      kind,
      metadata: {
        datetimeOriginNs: '0',
        datetimeOriginNsBigInt: 0n,
        domain: { max: 0, min: 0 },
        epochNsValues: [],
        key: parameter,
        kind,
        label,
        ...(spec?.source === undefined ? {} : { source: spec.source }),
        unit,
      },
      origin: null,
    };
  }

  return {
    kind: 'numeric',
    metadata: {
      domain: { max: 0, min: 0 },
      key: parameter,
      kind: 'numeric',
      label,
      ...(spec?.source === undefined ? {} : { source: spec.source }),
      unit,
    },
  };
}

function encodeParallelAxisValue(
  encoder: ParallelAxisEncoder,
  sourceValues: ParallelFastValueArray,
  parameter: ParallelParameter,
  recordIndex: number,
): number {
  const rawValue = sourceValues[recordIndex];

  if (rawValue === null || rawValue === undefined) {
    return Number.NaN;
  }

  if (encoder.kind === 'numeric') {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      if (typeof rawValue === 'number' && Number.isNaN(rawValue)) {
        return Number.NaN;
      }
      throw new Error(
        `Parallel-fast axis "${parameter}" at row ${recordIndex} must be a finite number or missing.`,
      );
    }

    return value;
  }

  if (encoder.kind === 'datetime-ns') {
    const epochNs = parseDatetimeNsValue(rawValue, parameter, recordIndex);
    const origin = encoder.origin ?? epochNs;
    encoder.origin = origin;
    encoder.epochNsValues[recordIndex] = epochNs.toString();

    return Number(epochNs - origin) / Number(NS_PER_MS);
  }

  const categoryKey = normalizeCategoryValue(
    rawValue,
    parameter,
    recordIndex,
    encoder.kind === 'boolean',
  );
  let encoded = encoder.dictionary.get(categoryKey);

  if (encoded === undefined) {
    encoded = encoder.categories.length;
    encoder.dictionary.set(categoryKey, encoded);
    encoder.categories.push({
      encoded,
      label: String(rawValue),
      value: categoryKey,
    });
  }

  return encoded;
}

function finalizeParallelAxisMetadata(
  encoder: ParallelAxisEncoder,
  domain: ParallelAxisDomain,
): ParallelFastAxisMetadata {
  if (encoder.kind === 'categorical' || encoder.kind === 'boolean') {
    return {
      categories: encoder.categories,
      domain: { max: domain.max, min: domain.min },
      key: encoder.metadata.key,
      kind: encoder.kind,
      label: encoder.metadata.label,
      ...(encoder.metadata.source === undefined
        ? {}
        : { source: encoder.metadata.source }),
      unit: encoder.metadata.unit,
    };
  }

  if (encoder.kind === 'datetime-ns') {
    const origin = encoder.origin ?? 0n;

    return {
      datetimeOriginNs: origin.toString(),
      datetimeOriginNsBigInt: origin,
      domain: { max: domain.max, min: domain.min },
      epochNsValues: Array.from(encoder.epochNsValues),
      key: encoder.metadata.key,
      kind: 'datetime-ns',
      label: encoder.metadata.label,
      ...(encoder.metadata.source === undefined
        ? {}
        : { source: encoder.metadata.source }),
      unit: encoder.metadata.unit,
    };
  }

  return {
    ...encoder.metadata,
    domain: { max: domain.max, min: domain.min },
  };
}

function createDefaultAxisMetadataByAxis(
  axisOrder: readonly ParallelParameter[],
  domainsByAxis: ParallelAxisDomains,
): Record<ParallelParameter, ParallelFastAxisMetadata> {
  return createAxisMap(axisOrder, (parameter) => ({
    domain: {
      max: domainsByAxis[parameter].max,
      min: domainsByAxis[parameter].min,
    },
    key: parameter,
    kind: 'numeric',
    label: parameter,
  }));
}

function createInitialCategories(
  categories: readonly ParallelFastCategorySpec[] | undefined,
  booleanAxis: boolean,
): { encoded: number; label: string; value: string }[] {
  const sourceCategories =
    categories ?? (booleanAxis ? [{ value: false }, { value: true }] : []);

  return [...sourceCategories]
    .sort((first, second) => (first.order ?? 0) - (second.order ?? 0))
    .map((category, index) => ({
      encoded: index,
      label: category.label ?? String(category.value),
      value: String(category.value),
    }));
}

function normalizeCategoryValue(
  rawValue: unknown,
  parameter: ParallelParameter,
  recordIndex: number,
  booleanAxis: boolean,
): string {
  if (booleanAxis) {
    if (typeof rawValue !== 'boolean') {
      throw new Error(
        `Parallel-fast axis "${parameter}" at row ${recordIndex} must be boolean or missing.`,
      );
    }

    return String(rawValue);
  }

  if (
    typeof rawValue !== 'string' &&
    typeof rawValue !== 'number' &&
    typeof rawValue !== 'boolean'
  ) {
    throw new Error(
      `Parallel-fast axis "${parameter}" at row ${recordIndex} must be categorical or missing.`,
    );
  }

  return String(rawValue);
}

function parseDatetimeNsValue(
  rawValue: unknown,
  parameter: ParallelParameter,
  recordIndex: number,
): bigint {
  if (typeof rawValue === 'bigint') {
    return rawValue;
  }

  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue)) {
      throw new Error(
        `Parallel-fast axis "${parameter}" at row ${recordIndex} must be datetime-ns or missing.`,
      );
    }

    return BigInt(Math.trunc(rawValue));
  }

  if (typeof rawValue === 'string' && /^-?\d+$/u.test(rawValue)) {
    return BigInt(rawValue);
  }

  throw new Error(
    `Parallel-fast axis "${parameter}" at row ${recordIndex} must be datetime-ns or missing.`,
  );
}

function formatBooleanCategoryLabel(
  categoryValue: string | undefined,
  encodedValue: number,
): string {
  if (categoryValue === 'false' || categoryValue === 'true') {
    return categoryValue;
  }

  return Math.round(encodedValue) === 0 ? 'false' : 'true';
}

type ParallelDatetimeTickPrecision = 'date' | 'minute' | 'second' | 'fractional';

const ONE_SECOND_MS = 1000;
const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

function selectParallelDatetimeTickPrecision(spanMs: number): ParallelDatetimeTickPrecision {
  if (spanMs >= ONE_DAY_MS) {
    return 'date';
  }

  if (spanMs >= ONE_HOUR_MS) {
    return 'minute';
  }

  if (spanMs >= ONE_SECOND_MS) {
    return 'second';
  }

  return 'fractional';
}

function formatParallelDatetimeNsTickValue(
  epochNs: bigint,
  precision: ParallelDatetimeTickPrecision,
): string {
  const parts = getParallelUtcDateTimeParts(epochNs);

  if (precision === 'date') {
    return parts.date;
  }

  if (precision === 'minute') {
    return `${parts.hour}:${parts.minute}`;
  }

  if (precision === 'second') {
    return `${parts.hour}:${parts.minute}:${parts.second}`;
  }

  const fractional = parts.fractionalSecond.replace(/0+$/u, '');

  return `${parts.hour}:${parts.minute}:${parts.second}${fractional === '' ? '' : `.${fractional}`}`;
}

function getParallelUtcDateTimeParts(epochNs: bigint): {
  date: string;
  fractionalSecond: string;
  hour: string;
  minute: string;
  second: string;
} {
  const epochMs = epochNs / NS_PER_MS;
  const subMsNs = epochNs % NS_PER_MS;
  const iso = new Date(Number(epochMs)).toISOString();

  return {
    date: iso.slice(0, 10),
    fractionalSecond: `${iso.slice(20, 23)}${subMsNs.toString().padStart(6, '0')}`,
    hour: iso.slice(11, 13),
    minute: iso.slice(14, 16),
    second: iso.slice(17, 19),
  };
}

function formatDatetimeNsEpochValue(epochNs: bigint): string {
  const date = new Date(Number(epochNs / NS_PER_MS));
  const iso = date.toISOString();
  const subMs = (epochNs % NS_PER_MS).toString().padStart(6, '0').replace(/0+$/u, '');

  return subMs === '' ? iso : iso.replace('Z', `${subMs}Z`);
}

function createParallelStyleBuffers(
  columns: ParallelFastColumns,
  recordCount: number,
): ParallelStyleBuffers | undefined {
  if (columns.color === undefined && columns.opacity === undefined) {
    return undefined;
  }

  const color = normalizeParallelColorBuffer(columns.color, recordCount);
  const opacity = normalizeParallelOpacityBuffer(columns.opacity, recordCount);

  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    const alphaOffset = recordIndex * BYTES_PER_RGBA_COLOR + 3;
    color[alphaOffset] = Math.round((color[alphaOffset] / 255) * opacity[recordIndex] * 255);
  }

  return {
    color,
    colorFormat: 'rgba8',
    opacity,
    styledRecordCount: recordCount,
  };
}

function normalizeParallelColorBuffer(
  colors: ParallelFastColorArray | undefined,
  recordCount: number,
): Uint8Array {
  const rgba = new Uint8Array(recordCount * BYTES_PER_RGBA_COLOR);

  if (colors === undefined) {
    for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
      const offset = recordIndex * BYTES_PER_RGBA_COLOR;
      rgba[offset] = 255;
      rgba[offset + 1] = 255;
      rgba[offset + 2] = 255;
      rgba[offset + 3] = 255;
    }
    return rgba;
  }

  const expectedLength =
    colors instanceof Uint8Array ? recordCount * BYTES_PER_RGBA_COLOR : recordCount;
  if (colors.length !== expectedLength) {
    throw new Error(
      `Parallel-fast color style buffer has ${colors.length} values for ${recordCount} records.`,
    );
  }

  if (colors instanceof Uint8Array) {
    rgba.set(colors);
    return rgba;
  }

  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    const parsed = parseParallelHexColor(colors[recordIndex], recordIndex);
    const offset = recordIndex * BYTES_PER_RGBA_COLOR;
    rgba[offset] = parsed.r;
    rgba[offset + 1] = parsed.g;
    rgba[offset + 2] = parsed.b;
    rgba[offset + 3] = parsed.a;
  }

  return rgba;
}

function normalizeParallelOpacityBuffer(
  opacity: ParallelFastOpacityArray | undefined,
  recordCount: number,
): Float32Array {
  const normalized = new Float32Array(recordCount);

  if (opacity === undefined) {
    normalized.fill(1);
    return normalized;
  }

  if (opacity.length !== recordCount) {
    throw new Error(
      `Parallel-fast opacity style buffer has ${opacity.length} values for ${recordCount} records.`,
    );
  }

  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    const value = opacity[recordIndex] ?? 1;

    if (!Number.isFinite(value)) {
      throw new Error(
        `Parallel-fast opacity style buffer at row ${recordIndex} must be a finite number.`,
      );
    }
    if (value < 0 || value > 1) {
      throw new Error(
        `Parallel-fast opacity style buffer at row ${recordIndex} must be between 0 and 1.`,
      );
    }

    normalized[recordIndex] = value;
  }

  return normalized;
}

function parseParallelHexColor(
  color: string | null | undefined,
  recordIndex: number,
): { a: number; b: number; g: number; r: number } {
  if (color === null || color === undefined) {
    return { a: 255, b: 255, g: 255, r: 255 };
  }

  const match =
    /^#(?<r>[0-9a-f]{2})(?<g>[0-9a-f]{2})(?<b>[0-9a-f]{2})(?<a>[0-9a-f]{2})?$/iu.exec(
      color,
    );

  if (match?.groups === undefined) {
    throw new Error(
      `Parallel-fast color style buffer at row ${recordIndex} must use #RRGGBB or #RRGGBBAA format.`,
    );
  }

  return {
    a: match.groups.a === undefined ? 255 : Number.parseInt(match.groups.a, 16),
    b: Number.parseInt(match.groups.b, 16),
    g: Number.parseInt(match.groups.g, 16),
    r: Number.parseInt(match.groups.r, 16),
  };
}

function expandSegmentSourceIndicesByVertex(sourceIndices: Uint32Array): Uint32Array {
  const sourceIndicesByVertex = new Uint32Array(sourceIndices.length * 2);

  for (let segmentIndex = 0; segmentIndex < sourceIndices.length; segmentIndex += 1) {
    const sourceIndex = sourceIndices[segmentIndex];
    const vertexOffset = segmentIndex * 2;
    sourceIndicesByVertex[vertexOffset] = sourceIndex;
    sourceIndicesByVertex[vertexOffset + 1] = sourceIndex;
  }

  return sourceIndicesByVertex;
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
