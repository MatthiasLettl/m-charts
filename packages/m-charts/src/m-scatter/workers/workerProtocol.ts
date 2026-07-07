import {
  estimateFastScatterSelectionCandidateCount,
  getFastScatterSelectionPolygonBounds,
  selectFastScatterSourceIndicesInBounds,
  selectFastScatterSourceIndicesInPolygon,
  type FastScatterPointColumns,
  type FastScatterSelectionBounds,
  type FastScatterSelectionPolygon,
  type FastScatterTypedNumericArray,
} from '../core/index.js';

export type FastScatterSelectionWorkerMode = 'sync' | 'worker';
export type FastScatterSelectionWorkerRequestKind = 'rectangle' | 'lasso';

export interface FastScatterSelectionWorkerColumns {
  readonly sourceIndex?: Uint32Array;
  readonly x: FastScatterTypedNumericArray;
  readonly xOrder?: Uint32Array;
  readonly y: Readonly<Record<string, FastScatterTypedNumericArray>>;
}

export interface FastScatterSelectionWorkerSetupRequest {
  readonly columns: FastScatterSelectionWorkerColumns;
  readonly requestId: number;
  readonly type: 'setup';
}

export interface FastScatterSelectionWorkerSelectRectangleRequest {
  readonly bounds: FastScatterSelectionBounds;
  readonly requestId: number;
  readonly type: 'select-rectangle';
}

export interface FastScatterSelectionWorkerSelectLassoRequest {
  readonly polygon: FastScatterSelectionPolygon;
  readonly requestId: number;
  readonly type: 'select-lasso';
}

export type FastScatterSelectionWorkerRequest =
  | FastScatterSelectionWorkerSetupRequest
  | FastScatterSelectionWorkerSelectRectangleRequest
  | FastScatterSelectionWorkerSelectLassoRequest;

export interface FastScatterSelectionWorkerSetupResponse {
  readonly pointCount: number;
  readonly requestId: number;
  readonly type: 'setup-complete';
}

export interface FastScatterSelectionWorkerResultResponse {
  readonly candidateCount: number;
  readonly computeMs: number;
  readonly requestId: number;
  readonly sourceIndices: Uint32Array;
  readonly type: 'selection-result';
}

export interface FastScatterSelectionWorkerErrorResponse {
  readonly message: string;
  readonly requestId: number;
  readonly type: 'selection-error';
}

export type FastScatterSelectionWorkerResponse =
  | FastScatterSelectionWorkerErrorResponse
  | FastScatterSelectionWorkerResultResponse
  | FastScatterSelectionWorkerSetupResponse;

export interface FastScatterSelectionExecutionTiming {
  readonly candidateCount: number;
  readonly computeMs: number;
  readonly mode: FastScatterSelectionWorkerMode;
  readonly observableMs: number;
  readonly transferMs: number;
}

export interface FastScatterSelectionExecutionResult {
  readonly sourceIndices: Uint32Array;
  readonly timing: FastScatterSelectionExecutionTiming;
}

export function cloneFastScatterSelectionWorkerColumns(
  columns: Pick<FastScatterPointColumns, 'sourceIndex' | 'x' | 'xOrder' | 'y'>,
): FastScatterSelectionWorkerColumns {
  return {
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

export function computeFastScatterSelectionWorkerRequest(
  columns: FastScatterSelectionWorkerColumns,
  request:
    | FastScatterSelectionWorkerSelectLassoRequest
    | FastScatterSelectionWorkerSelectRectangleRequest,
): Omit<FastScatterSelectionWorkerResultResponse, 'requestId' | 'type'> {
  const startedAt = performance.now();

  if (request.type === 'select-rectangle') {
    const sourceIndices = selectFastScatterSourceIndicesInBounds(
      columns,
      request.bounds,
    );

    return {
      candidateCount: estimateFastScatterSelectionCandidateCount(
        columns,
        request.bounds,
      ),
      computeMs: performance.now() - startedAt,
      sourceIndices,
    };
  }

  const result = selectFastScatterSourceIndicesInPolygon(columns, request.polygon);

  return {
    candidateCount: result.diagnostics.candidateCount,
    computeMs: performance.now() - startedAt,
    sourceIndices: result.sourceIndices,
  };
}

export function estimateFastScatterSelectionRequestCandidateCount(
  columns: Pick<FastScatterPointColumns, 'x'>,
  request:
    | FastScatterSelectionWorkerSelectLassoRequest
    | FastScatterSelectionWorkerSelectRectangleRequest,
): number {
  return estimateFastScatterSelectionCandidateCount(
    columns,
    request.type === 'select-rectangle'
      ? request.bounds
      : getFastScatterSelectionPolygonBounds(request.polygon),
  );
}

function cloneNumericArray<T extends FastScatterTypedNumericArray>(values: T): T {
  return new (values.constructor as new (source: T) => T)(values);
}
