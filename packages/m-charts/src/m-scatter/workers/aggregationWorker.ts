import {
  computeFastScatterAggregationWorkerRequest,
  getFastScatterAggregationTransferables,
  getFastScatterAggregationWorkerColumnByteLength,
  type FastScatterAggregationWorkerColumns,
  type FastScatterAggregationWorkerRequest,
  type FastScatterAggregationWorkerResponse,
} from './aggregationProtocol.js';

let columns: FastScatterAggregationWorkerColumns | null = null;

const workerScope = self as unknown as {
  onmessage:
    | ((event: MessageEvent<FastScatterAggregationWorkerRequest>) => void)
    | null;
  postMessage: (message: FastScatterAggregationWorkerResponse, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (event: MessageEvent<FastScatterAggregationWorkerRequest>) => {
  const request = event.data;

  try {
    if (request.type === 'setup') {
      const setupStartedAt = performance.now();
      columns = request.columns;
      postResponse({
        pointCount: columns.x.length,
        requestId: request.requestId,
        setupBytes: getFastScatterAggregationWorkerColumnByteLength(columns),
        setupMs: performance.now() - setupStartedAt,
        type: 'setup-complete',
      });
      return;
    }

    if (columns === null) {
      postResponse({
        message: 'Scatter-fast aggregation worker has not received setup columns.',
        requestId: request.requestId,
        type: 'aggregate-error',
      });
      return;
    }

    const result = computeFastScatterAggregationWorkerRequest(columns, request);
    workerScope.postMessage(
      {
        ...result,
        requestId: request.requestId,
        type: 'aggregate-result',
      } satisfies FastScatterAggregationWorkerResponse,
      getFastScatterAggregationTransferables(result.aggregation),
    );
  } catch (error) {
    postResponse({
      message:
        error instanceof Error
          ? error.message
          : 'Unknown scatter-fast aggregation worker error.',
      requestId: request.requestId,
      type: 'aggregate-error',
    });
  }
};

function postResponse(response: FastScatterAggregationWorkerResponse): void {
  workerScope.postMessage(response);
}
