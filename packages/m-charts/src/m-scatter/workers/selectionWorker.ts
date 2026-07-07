import {
  computeFastScatterSelectionWorkerRequest,
  type FastScatterSelectionWorkerColumns,
  type FastScatterSelectionWorkerRequest,
  type FastScatterSelectionWorkerResponse,
} from './workerProtocol.js';

let columns: FastScatterSelectionWorkerColumns | null = null;

const workerScope = self as unknown as {
  onmessage:
    | ((event: MessageEvent<FastScatterSelectionWorkerRequest>) => void)
    | null;
  postMessage: (message: FastScatterSelectionWorkerResponse, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (event: MessageEvent<FastScatterSelectionWorkerRequest>) => {
  const request = event.data;

  try {
    if (request.type === 'setup') {
      columns = request.columns;
      postResponse({
        pointCount: columns.x.length,
        requestId: request.requestId,
        type: 'setup-complete',
      });
      return;
    }

    if (columns === null) {
      postResponse({
        message: 'Scatter-fast selection worker has not received setup columns.',
        requestId: request.requestId,
        type: 'selection-error',
      });
      return;
    }

    const result = computeFastScatterSelectionWorkerRequest(columns, request);
    workerScope.postMessage(
      {
        ...result,
        requestId: request.requestId,
        type: 'selection-result',
      } satisfies FastScatterSelectionWorkerResponse,
      [result.sourceIndices.buffer],
    );
  } catch (error) {
    postResponse({
      message:
        error instanceof Error
          ? error.message
          : 'Unknown scatter-fast selection worker error.',
      requestId: request.requestId,
      type: 'selection-error',
    });
  }
};

function postResponse(response: FastScatterSelectionWorkerResponse): void {
  workerScope.postMessage(response);
}
