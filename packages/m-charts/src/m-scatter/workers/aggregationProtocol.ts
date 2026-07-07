import {
  buildFastScatterAggregation,
  collectFastScatterAggregationTransferables,
  type FastScatterAggregationExecutionResult,
  type FastScatterAggregationRequest,
  type FastScatterAggregationSet,
  type FastScatterColorArray,
  type FastScatterPointColumns,
  type FastScatterTypedNumericArray,
} from '../core/index.js';

export type FastScatterAggregationWorkerMode = 'sync' | 'worker';

export interface FastScatterAggregationWorkerColumns {
  readonly color?: FastScatterColorArray;
  readonly colorFormat?: FastScatterPointColumns['colorFormat'];
  readonly sourceIndex?: Uint32Array;
  readonly x: FastScatterTypedNumericArray;
  readonly xOrder?: Uint32Array;
  readonly y: Readonly<Record<string, FastScatterTypedNumericArray>>;
}

export interface FastScatterAggregationWorkerSetupRequest {
  readonly columns: FastScatterAggregationWorkerColumns;
  readonly requestId: number;
  readonly type: 'setup';
}

export interface FastScatterAggregationWorkerAggregateRequest {
  readonly request: FastScatterAggregationRequest;
  readonly requestId: number;
  readonly type: 'aggregate';
}

export type FastScatterAggregationWorkerRequest =
  | FastScatterAggregationWorkerAggregateRequest
  | FastScatterAggregationWorkerSetupRequest;

export interface FastScatterAggregationWorkerSetupResponse {
  readonly pointCount: number;
  readonly requestId: number;
  readonly setupBytes: number;
  readonly setupMs: number;
  readonly type: 'setup-complete';
}

export interface FastScatterAggregationWorkerResultResponse {
  readonly aggregation: FastScatterAggregationSet;
  readonly computeMs: number;
  readonly requestBytes: number;
  readonly requestId: number;
  readonly resultBytes: number;
  readonly type: 'aggregate-result';
}

export interface FastScatterAggregationWorkerErrorResponse {
  readonly message: string;
  readonly requestId: number;
  readonly type: 'aggregate-error';
}

export type FastScatterAggregationWorkerResponse =
  | FastScatterAggregationWorkerErrorResponse
  | FastScatterAggregationWorkerResultResponse
  | FastScatterAggregationWorkerSetupResponse;

export function cloneFastScatterAggregationWorkerColumns(
  columns: Pick<
    FastScatterPointColumns,
    'color' | 'colorFormat' | 'sourceIndex' | 'x' | 'xOrder' | 'y'
  >,
): FastScatterAggregationWorkerColumns {
  return {
    color: cloneColorArray(columns.color),
    colorFormat: columns.colorFormat,
    sourceIndex:
      columns.sourceIndex === undefined
        ? undefined
        : new Uint32Array(columns.sourceIndex),
    x: cloneNumericArray(columns.x),
    xOrder:
      columns.xOrder === undefined ? undefined : new Uint32Array(columns.xOrder),
    y: Object.fromEntries(
      Object.entries(columns.y).map(([key, values]) => [key, cloneNumericArray(values)]),
    ),
  };
}

export function computeFastScatterAggregationWorkerRequest(
  columns: FastScatterAggregationWorkerColumns,
  request: FastScatterAggregationWorkerAggregateRequest,
): Omit<FastScatterAggregationWorkerResultResponse, 'requestId' | 'type'> {
  const aggregation = buildFastScatterAggregation(columns, request.request);

  return {
    aggregation,
    computeMs: aggregation.metrics.aggregateBuildMs,
    requestBytes: getFastScatterAggregationRequestByteLength(request.request),
    resultBytes: aggregation.metrics.resultBytes,
  };
}

export function getFastScatterAggregationRequestByteLength(
  request: FastScatterAggregationRequest,
): number {
  let total =
    getEncodedStringByteLength(request.mode) +
    Float64Array.BYTES_PER_ELEMENT * 2 +
    (request.hoverSourceIndex === undefined || request.hoverSourceIndex === null
      ? 0
      : Float64Array.BYTES_PER_ELEMENT) +
    (request.selectedSourceIndices?.byteLength ?? 0);

  for (const subplot of request.subplots) {
    total +=
      getEncodedStringByteLength(subplot.plotId) +
      getEncodedStringByteLength(subplot.yKey) +
      Float64Array.BYTES_PER_ELEMENT * 6;
  }

  if (request.mode === 'heatmap') {
    total += Float64Array.BYTES_PER_ELEMENT;
  }

  return total;
}

export function getFastScatterAggregationTransferables(
  aggregation: FastScatterAggregationSet,
): Transferable[] {
  return collectFastScatterAggregationTransferables(aggregation);
}

export function getFastScatterAggregationWorkerColumnTransferables(
  columns: FastScatterAggregationWorkerColumns,
): Transferable[] {
  const buffers = new Set<ArrayBuffer>();

  maybeAddTransferableBuffer(buffers, columns.color?.buffer);
  maybeAddTransferableBuffer(buffers, columns.sourceIndex?.buffer);
  maybeAddTransferableBuffer(buffers, columns.x.buffer);
  maybeAddTransferableBuffer(buffers, columns.xOrder?.buffer);

  for (const values of Object.values(columns.y)) {
    maybeAddTransferableBuffer(buffers, values.buffer);
  }

  return Array.from(buffers);
}

export function getFastScatterAggregationWorkerColumnByteLength(
  columns: FastScatterAggregationWorkerColumns,
): number {
  return (
    (columns.color?.byteLength ?? 0) +
    (columns.sourceIndex?.byteLength ?? 0) +
    columns.x.byteLength +
    (columns.xOrder?.byteLength ?? 0) +
    sumColumnByteLengths(columns.y)
  );
}

export function createFastScatterAggregationExecutionResult(
  aggregation: FastScatterAggregationSet,
  metrics: FastScatterAggregationExecutionResult['metrics'],
): FastScatterAggregationExecutionResult {
  return {
    aggregation,
    metrics,
  };
}

function cloneColorArray(
  color: FastScatterColorArray | undefined,
): FastScatterColorArray | undefined {
  if (color === undefined) {
    return undefined;
  }

  if (color instanceof Uint32Array) {
    return new Uint32Array(color);
  }

  return new Uint8Array(color);
}

function cloneNumericArray<T extends FastScatterTypedNumericArray>(values: T): T {
  return new (values.constructor as new (source: T) => T)(values);
}

function sumColumnByteLengths(columns: Readonly<Record<string, ArrayBufferView>>): number {
  let total = 0;

  for (const column of Object.values(columns)) {
    total += column.byteLength;
  }

  return total;
}

function getEncodedStringByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function maybeAddTransferableBuffer(
  buffers: Set<ArrayBuffer>,
  buffer: ArrayBufferLike | undefined,
): void {
  if (buffer instanceof ArrayBuffer && buffer.byteLength > 0) {
    buffers.add(buffer);
  }
}
