import assert from 'node:assert/strict';

import { FastScatterSelectionController } from '../../packages/m-charts/src/m-scatter/workers/selectionController.ts';
import {
  cloneFastScatterSelectionWorkerColumns,
  computeFastScatterSelectionWorkerRequest,
  estimateFastScatterSelectionRequestCandidateCount,
  type FastScatterSelectionWorkerColumns,
  type FastScatterSelectionWorkerRequest,
  type FastScatterSelectionWorkerResponse,
} from '../../packages/m-charts/src/m-scatter/workers/workerProtocol.ts';

const columns = {
  sourceIndex: new Uint32Array([3, 0, 5, 1, 4, 2]),
  x: new Float64Array([0, 1, 2, 3, 4, 5]),
  y: {
    a: new Float64Array([10, 11, 12, 13, 14, 15]),
  },
};
const rectangleRequest = {
  bounds: {
    x: { max: 4.25, min: 1.5 },
    y: { max: 13.5, min: 11.5 },
    yKey: 'a',
  },
  requestId: 1,
  type: 'select-rectangle',
} as const;
const widerRectangleRequest = {
  bounds: {
    x: { max: 4.25, min: 1.5 },
    y: { max: 14.5, min: 11.5 },
    yKey: 'a',
  },
  requestId: 2,
  type: 'select-rectangle',
} as const;

const clonedColumns = cloneFastScatterSelectionWorkerColumns(columns);
columns.x[2] = 99;
columns.y.a[2] = 99;
columns.sourceIndex[2] = 99;

assert.deepEqual(Array.from(clonedColumns.x), [0, 1, 2, 3, 4, 5]);
assert.deepEqual(Array.from(clonedColumns.y.a), [10, 11, 12, 13, 14, 15]);
assert.deepEqual(Array.from(clonedColumns.sourceIndex ?? []), [3, 0, 5, 1, 4, 2]);

const rectangleResult = computeFastScatterSelectionWorkerRequest(
  clonedColumns,
  rectangleRequest,
);

assert.equal(rectangleResult.candidateCount, 3);
assert.deepEqual(Array.from(rectangleResult.sourceIndices), [1, 5]);
assert.deepEqual(
  Array.from(
    computeFastScatterSelectionWorkerRequest(clonedColumns, widerRectangleRequest)
      .sourceIndices,
  ),
  [1, 4, 5],
);
assert.equal(
  estimateFastScatterSelectionRequestCandidateCount(clonedColumns, rectangleRequest),
  3,
);

const syncController = new FastScatterSelectionController({
  columns: clonedColumns,
  minWorkerCandidateCount: 0,
  preference: 'sync',
});
const syncResult = await syncController.selectRectangle({
  bounds: rectangleRequest.bounds,
  type: 'select-rectangle',
});

assert.equal(syncResult.timing.mode, 'sync');
assert.equal(syncResult.timing.transferMs, 0);
assert.deepEqual(Array.from(syncResult.sourceIndices), [1, 5]);

const workerController = new FastScatterSelectionController({
  columns: clonedColumns,
  createWorker: createFakeSelectionWorker,
  minWorkerCandidateCount: 0,
  preference: 'worker',
});
const workerResult = await workerController.selectLasso({
  polygon: {
    points: [
      { x: 1.25, y: 11.25 },
      { x: 4.75, y: 11.25 },
      { x: 3.75, y: 14.5 },
      { x: 1.25, y: 13.75 },
    ],
    yKey: 'a',
  },
  type: 'select-lasso',
});

assert.equal(workerResult.timing.mode, 'worker');
assert.deepEqual(Array.from(workerResult.sourceIndices), [1, 5]);
workerController.dispose();

console.log('scatter-fast selection worker tests passed');

function createFakeSelectionWorker(): Worker {
  let workerColumns: FastScatterSelectionWorkerColumns | null = null;
  const messageHandlers = new Set<
    (event: MessageEvent<FastScatterSelectionWorkerResponse>) => void
  >();
  const emit = (response: FastScatterSelectionWorkerResponse) => {
    const event = { data: response } as MessageEvent<FastScatterSelectionWorkerResponse>;

    for (const handler of messageHandlers) {
      handler(event);
    }
  };

  return {
    addEventListener: (
      type: string,
      listener: (event: MessageEvent<FastScatterSelectionWorkerResponse>) => void,
    ) => {
      if (type === 'message') {
        messageHandlers.add(listener);
      }
    },
    postMessage: (message: FastScatterSelectionWorkerRequest) => {
      queueMicrotask(() => {
        if (message.type === 'setup') {
          workerColumns = message.columns;
          emit({
            pointCount: message.columns.x.length,
            requestId: message.requestId,
            type: 'setup-complete',
          });
          return;
        }

        if (workerColumns === null) {
          emit({
            message: 'Missing columns.',
            requestId: message.requestId,
            type: 'selection-error',
          });
          return;
        }

        emit({
          ...computeFastScatterSelectionWorkerRequest(workerColumns, message),
          requestId: message.requestId,
          type: 'selection-result',
        });
      });
    },
    removeEventListener: (
      type: string,
      listener: (event: MessageEvent<FastScatterSelectionWorkerResponse>) => void,
    ) => {
      if (type === 'message') {
        messageHandlers.delete(listener);
      }
    },
    terminate: () => {
      messageHandlers.clear();
    },
  } as unknown as Worker;
}
