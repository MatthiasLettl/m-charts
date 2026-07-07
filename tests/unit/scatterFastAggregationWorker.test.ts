import assert from 'node:assert/strict';

import { FastScatterAggregationController, FastScatterAggregationStaleRequestError } from '../../packages/m-charts/src/m-scatter/workers/aggregationController.ts';
import {
  cloneFastScatterAggregationWorkerColumns,
  computeFastScatterAggregationWorkerRequest,
  getFastScatterAggregationWorkerColumnByteLength,
  type FastScatterAggregationWorkerAggregateRequest,
  type FastScatterAggregationWorkerColumns,
  type FastScatterAggregationWorkerRequest,
  type FastScatterAggregationWorkerResponse,
} from '../../packages/m-charts/src/m-scatter/workers/aggregationProtocol.ts';

const columns = {
  color: new Uint32Array([
    0x111111ff,
    0x222222ff,
    0x333333ff,
    0x444444ff,
    0x555555ff,
    0x666666ff,
  ]),
  colorFormat: 'rgba32' as const,
  sourceIndex: new Uint32Array([5, 1, 4, 0, 3, 2]),
  x: new Float64Array([0, 1, 1, 1, 2, 3]),
  y: {
    a: new Float64Array([10, 10, 10, 11, 20, Number.POSITIVE_INFINITY]),
    b: new Float64Array([100, 100, 101, 100, Number.NaN, 200]),
  },
};
const bubbleRequest = {
  hoverSourceIndex: 1,
  mode: 'bubble',
  selectedSourceIndices: new Uint32Array([0, 1, 3, 4]),
  subplots: [
    {
      plotHeightPx: 20,
      plotId: 'plot-a',
      plotWidthPx: 20,
      yKey: 'a',
      yRange: { max: 20, min: 10 },
    },
    {
      plotHeightPx: 20,
      plotId: 'plot-b',
      plotWidthPx: 20,
      yKey: 'b',
      yRange: { max: 101, min: 100 },
    },
  ],
  xRange: { max: 2, min: 0 },
} as const;

const clonedColumns = cloneFastScatterAggregationWorkerColumns(columns);
columns.x[1] = 99;
columns.y.a[1] = 99;
columns.sourceIndex[1] = 99;
columns.color[1] = 0x999999ff;

assert.deepEqual(Array.from(clonedColumns.x), [0, 1, 1, 1, 2, 3]);
assert.deepEqual(Array.from(clonedColumns.y.a), [10, 10, 10, 11, 20, Number.POSITIVE_INFINITY]);
assert.deepEqual(Array.from(clonedColumns.sourceIndex ?? []), [5, 1, 4, 0, 3, 2]);
assert.deepEqual(Array.from(clonedColumns.color ?? []), [
  0x111111ff,
  0x222222ff,
  0x333333ff,
  0x444444ff,
  0x555555ff,
  0x666666ff,
]);
assert.ok(getFastScatterAggregationWorkerColumnByteLength(clonedColumns) > 0);

const directWorkerResult = computeFastScatterAggregationWorkerRequest(clonedColumns, {
  request: bubbleRequest,
  requestId: 1,
  type: 'aggregate',
});
assert.equal(directWorkerResult.aggregation.kind, 'bubble');
assert.equal(directWorkerResult.requestBytes > 0, true);
assert.equal(directWorkerResult.resultBytes, directWorkerResult.aggregation.metrics.resultBytes);

const syncController = new FastScatterAggregationController({
  columns: clonedColumns,
  minWorkerPointCount: 0,
  preference: 'sync',
});
const syncResult = await syncController.aggregate(bubbleRequest);

assert.equal(syncResult.metrics.mode, 'sync');
assert.equal(syncResult.metrics.setupBytes, 0);
assert.equal(syncResult.metrics.transferBytes, 0);
assert.equal(syncResult.metrics.transferMs, 0);

const workerController = new FastScatterAggregationController({
  columns: clonedColumns,
  createWorker: createFakeAggregationWorker,
  minWorkerPointCount: 0,
  preference: 'worker',
});
const workerResult = await workerController.aggregate(bubbleRequest);

assert.equal(workerResult.metrics.mode, 'worker');
assert.equal(workerResult.metrics.setupBytes > 0, true);
assert.equal(workerResult.metrics.resultBytes, workerResult.aggregation.metrics.resultBytes);
assert.deepEqual(
  toComparableAggregation(workerResult.aggregation),
  toComparableAggregation(syncResult.aggregation),
);

await workerController.aggregate(bubbleRequest);
const slowRequest = workerController.aggregate({
  ...bubbleRequest,
  xRange: { max: 3, min: 0 },
});
const fastRequest = workerController.aggregate({
  ...bubbleRequest,
  xRange: { max: 2, min: 0 },
});
const [slowOutcome, fastOutcome] = await Promise.allSettled([slowRequest, fastRequest]);

assert.equal(slowOutcome.status, 'rejected');
assert.equal(slowOutcome.reason instanceof FastScatterAggregationStaleRequestError, true);
assert.equal(fastOutcome.status, 'fulfilled');
if (fastOutcome.status === 'fulfilled') {
  assert.deepEqual(
    toComparableAggregation(fastOutcome.value.aggregation),
    toComparableAggregation(syncResult.aggregation),
  );
}

workerController.dispose();

console.log('scatter-fast aggregation worker tests passed');

function createFakeAggregationWorker(): Worker {
  let workerColumns: FastScatterAggregationWorkerColumns | null = null;
  let setupComplete = false;
  const messageHandlers = new Set<
    (event: MessageEvent<FastScatterAggregationWorkerResponse>) => void
  >();
  const emit = (response: FastScatterAggregationWorkerResponse) => {
    const event = { data: response } as MessageEvent<FastScatterAggregationWorkerResponse>;

    for (const handler of messageHandlers) {
      handler(event);
    }
  };

  return {
    addEventListener: (
      type: string,
      listener: (event: MessageEvent<FastScatterAggregationWorkerResponse>) => void,
    ) => {
      if (type === 'message') {
        messageHandlers.add(listener);
      }
    },
    postMessage: (message: FastScatterAggregationWorkerRequest) => {
      if (message.type === 'setup') {
        workerColumns = message.columns;
        const setupBytes = getFastScatterAggregationWorkerColumnByteLength(message.columns);

        setTimeout(() => {
          setupComplete = true;
          emit({
            pointCount: message.columns.x.length,
            requestId: message.requestId,
            setupBytes,
            setupMs: 0.5,
            type: 'setup-complete',
          });
        }, 0);
        return;
      }

      if (workerColumns === null || !setupComplete) {
        queueMicrotask(() => {
          emit({
            message: 'Missing columns.',
            requestId: message.requestId,
            type: 'aggregate-error',
          });
        });
        return;
      }

      const result = computeFastScatterAggregationWorkerRequest(
        workerColumns,
        message as FastScatterAggregationWorkerAggregateRequest,
      );
      const aggregateDelayMs = message.request.xRange.max > 2 ? 20 : 0;

      setTimeout(() => {
        emit({
          ...result,
          requestId: message.requestId,
          type: 'aggregate-result',
        });
      }, aggregateDelayMs);
    },
    removeEventListener: (
      type: string,
      listener: (event: MessageEvent<FastScatterAggregationWorkerResponse>) => void,
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

function toComparableAggregation(
  aggregation: ReturnType<typeof computeFastScatterAggregationWorkerRequest>['aggregation'],
): object {
  if (aggregation.kind === 'bubble') {
    return {
      kind: aggregation.kind,
      pointCount: aggregation.pointCount,
      totalAggregateCount: aggregation.totalAggregateCount,
      subplots: aggregation.subplots.map((subplot) => ({
        aggregateCount: subplot.aggregateCount,
        centerX: Array.from(subplot.centerX),
        centerY: Array.from(subplot.centerY),
        counts: Array.from(subplot.counts),
        hovered: Array.from(subplot.hovered),
        membershipCounts: Array.from(subplot.membershipCounts),
        membershipOffsets: Array.from(subplot.membershipOffsets),
        plotId: subplot.plotId,
        representativeColor: Array.from(subplot.representativeColor),
        selectedCounts: Array.from(subplot.selectedCounts),
        sourceIndices: Array.from(subplot.sourceIndices),
        yKey: subplot.yKey,
      })),
    };
  }

  return {
    kind: aggregation.kind,
    pointCount: aggregation.pointCount,
    totalCellCount: aggregation.totalCellCount,
    totalPopulatedCellCount: aggregation.totalPopulatedCellCount,
    subplots: aggregation.subplots.map((subplot) => ({
      cellCount: subplot.cellCount,
      counts: Array.from(subplot.counts),
      heatBinPx: subplot.heatBinPx,
      hovered: Array.from(subplot.hovered),
      membershipCounts: Array.from(subplot.membershipCounts),
      membershipOffsets: Array.from(subplot.membershipOffsets),
      plotHeightPx: subplot.plotHeightPx,
      plotId: subplot.plotId,
      plotWidthPx: subplot.plotWidthPx,
      populatedCellCount: subplot.populatedCellCount,
      selectedCounts: Array.from(subplot.selectedCounts),
      sourceIndices: Array.from(subplot.sourceIndices),
      xBinCount: subplot.xBinCount,
      xBinSize: subplot.xBinSize,
      xRange: subplot.xRange,
      yBinCount: subplot.yBinCount,
      yBinSize: subplot.yBinSize,
      yKey: subplot.yKey,
      yRange: subplot.yRange,
    })),
  };
}
