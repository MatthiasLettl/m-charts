import type {
  FastScatterAggregationExecutionResult,
  FastScatterAggregationRequest,
  FastScatterPointColumns,
} from '../core/index.js';
import { buildFastScatterAggregation } from '../core/index.js';
import {
  cloneFastScatterAggregationWorkerColumns,
  createFastScatterAggregationExecutionResult,
  getFastScatterAggregationRequestByteLength,
  getFastScatterAggregationWorkerColumnTransferables,
  type FastScatterAggregationWorkerAggregateRequest,
  type FastScatterAggregationWorkerColumns,
  type FastScatterAggregationWorkerRequest,
  type FastScatterAggregationWorkerResponse,
} from './aggregationProtocol.js';

export type FastScatterAggregationExecutionPreference =
  | 'auto'
  | 'sync'
  | 'worker';

export interface FastScatterAggregationControllerOptions {
  readonly columns: Pick<
    FastScatterPointColumns,
    'color' | 'colorFormat' | 'sourceIndex' | 'x' | 'xOrder' | 'y'
  >;
  readonly createWorker?: () => Worker;
  readonly minWorkerPointCount?: number;
  readonly preference?: FastScatterAggregationExecutionPreference;
}

interface PendingWorkerAggregateRequest {
  readonly cleanup: () => void;
  readonly reject: (reason?: unknown) => void;
  readonly sequence: number;
}

interface WorkerSetupTiming {
  readonly setupBytes: number;
  readonly setupMs: number;
}

export class FastScatterAggregationStaleRequestError extends Error {
  readonly requestId: number;

  constructor(requestId: number) {
    super(`Scatter-fast aggregation request ${requestId} was superseded by a newer request.`);
    this.name = 'FastScatterAggregationStaleRequestError';
    this.requestId = requestId;
  }
}

export class FastScatterAggregationController {
  private readonly createWorker?: () => Worker;
  private readonly minWorkerPointCount: number;
  private readonly preference: FastScatterAggregationExecutionPreference;
  private readonly syncColumns: FastScatterAggregationWorkerColumns;
  private nextRequestId = 1;
  private nextSequence = 1;
  private latestStartedSequence = 0;
  private readonly pendingWorkerRequests = new Map<number, PendingWorkerAggregateRequest>();
  private setupPromise: Promise<WorkerSetupTiming> | null = null;
  private worker: Worker | null = null;

  constructor(options: FastScatterAggregationControllerOptions) {
    this.createWorker = options.createWorker;
    this.minWorkerPointCount = Math.max(
      0,
      Math.floor(options.minWorkerPointCount ?? 50_000),
    );
    this.preference = options.preference ?? 'auto';
    this.syncColumns = {
      color: options.columns.color,
      colorFormat: options.columns.colorFormat,
      sourceIndex: options.columns.sourceIndex,
      x: options.columns.x,
      xOrder: options.columns.xOrder,
      y: options.columns.y,
    };
  }

  dispose(): void {
    for (const [requestId, pending] of this.pendingWorkerRequests) {
      this.pendingWorkerRequests.delete(requestId);
      pending.cleanup();
      pending.reject(new FastScatterAggregationStaleRequestError(requestId));
    }

    this.worker?.terminate();
    this.worker = null;
    this.setupPromise = null;
  }

  aggregate(
    request: FastScatterAggregationRequest,
  ): Promise<FastScatterAggregationExecutionResult> {
    const requestId = this.nextRequestId;
    const sequence = this.nextSequence;
    this.nextRequestId += 1;
    this.nextSequence += 1;
    this.latestStartedSequence = sequence;

    return this.execute(request, requestId, sequence);
  }

  prepare(): Promise<WorkerSetupTiming> {
    if (this.createWorker === undefined || this.preference === 'sync') {
      return Promise.resolve({ setupBytes: 0, setupMs: 0 });
    }

    return this.ensureWorkerSetup(this.getWorker());
  }

  private async execute(
    request: FastScatterAggregationRequest,
    requestId: number,
    sequence: number,
  ): Promise<FastScatterAggregationExecutionResult> {
    const observableStartedAt = performance.now();
    const shouldUseWorker =
      this.preference === 'worker' ||
      (this.preference === 'auto' &&
        this.createWorker !== undefined &&
        this.syncColumns.x.length >= this.minWorkerPointCount);

    if (!shouldUseWorker || this.createWorker === undefined) {
      return this.executeSync(request, observableStartedAt);
    }

    try {
      return await this.executeWorker(request, requestId, sequence, observableStartedAt);
    } catch (error) {
      if (error instanceof FastScatterAggregationStaleRequestError) {
        throw error;
      }

      if (this.preference === 'worker') {
        throw new Error('Scatter-fast aggregation worker execution failed.', {
          cause: error,
        });
      }

      return this.executeSync(request, observableStartedAt);
    }
  }

  private executeSync(
    request: FastScatterAggregationRequest,
    observableStartedAt: number,
  ): FastScatterAggregationExecutionResult {
    const aggregation = buildFastScatterAggregation(this.syncColumns, request);
    const observableMs = performance.now() - observableStartedAt;

    return createFastScatterAggregationExecutionResult(aggregation, {
      aggregateBuildMs: aggregation.metrics.aggregateBuildMs,
      mode: 'sync',
      observableMs,
      requestBytes: getFastScatterAggregationRequestByteLength(request),
      resultBytes: aggregation.metrics.resultBytes,
      setupBytes: 0,
      setupMs: 0,
      transferBytes: 0,
      transferMs: 0,
    });
  }

  private async executeWorker(
    request: FastScatterAggregationRequest,
    requestId: number,
    sequence: number,
    observableStartedAt: number,
  ): Promise<FastScatterAggregationExecutionResult> {
    const worker = this.getWorker();
    this.cancelPendingWorkerRequests(sequence);
    const setupTiming = await this.ensureWorkerSetup(worker);

    if (sequence < this.latestStartedSequence) {
      throw new FastScatterAggregationStaleRequestError(requestId);
    }

    const response = await this.postAggregateRequest(worker, {
      request,
      requestId,
      type: 'aggregate',
    }, sequence);

    if (response.type !== 'aggregate-result') {
      throw new Error(
        response.type === 'aggregate-error'
          ? response.message
          : 'Scatter-fast aggregation worker returned an invalid response.',
      );
    }

    const observableMs = performance.now() - observableStartedAt;

    return createFastScatterAggregationExecutionResult(response.aggregation, {
      aggregateBuildMs: response.computeMs,
      mode: 'worker',
      observableMs,
      requestBytes: response.requestBytes,
      resultBytes: response.resultBytes,
      setupBytes: setupTiming.setupBytes,
      setupMs: setupTiming.setupMs,
      transferBytes:
        response.requestBytes + response.resultBytes + setupTiming.setupBytes,
      transferMs: Math.max(
        0,
        observableMs - response.computeMs - setupTiming.setupMs,
      ),
    });
  }

  private getWorker(): Worker {
    if (this.worker === null) {
      if (this.createWorker === undefined) {
        throw new Error('Scatter-fast aggregation worker factory is unavailable.');
      }

      this.worker = this.createWorker();
    }

    return this.worker;
  }

  private ensureWorkerSetup(worker: Worker): Promise<WorkerSetupTiming> {
    if (this.setupPromise !== null) {
      return this.setupPromise;
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const columns = cloneFastScatterAggregationWorkerColumns(this.syncColumns);
    const request = {
      columns,
      requestId,
      type: 'setup',
    } satisfies FastScatterAggregationWorkerRequest;
    const transferables = getFastScatterAggregationWorkerColumnTransferables(columns);

    this.setupPromise = this.postRequest(worker, request, transferables).then((response) => {
      if (response.type !== 'setup-complete') {
        throw new Error(
          response.type === 'aggregate-error'
            ? response.message
            : 'Scatter-fast aggregation worker setup failed.',
        );
      }

      return {
        setupBytes: response.setupBytes,
        setupMs: response.setupMs,
      };
    }).catch((error: unknown) => {
      this.setupPromise = null;
      throw error;
    });

    return this.setupPromise;
  }

  private postAggregateRequest(
    worker: Worker,
    request: FastScatterAggregationWorkerAggregateRequest,
    sequence: number,
  ): Promise<FastScatterAggregationWorkerResponse> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (settled) {
          return;
        }

        settled = true;
        this.pendingWorkerRequests.delete(request.requestId);
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
      };
      const handleMessage = (
        event: MessageEvent<FastScatterAggregationWorkerResponse>,
      ) => {
        if (event.data.requestId !== request.requestId) {
          return;
        }

        cleanup();
        resolve(event.data);
      };
      const handleError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message));
      };

      this.pendingWorkerRequests.set(request.requestId, {
        cleanup,
        reject,
        sequence,
      });
      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
      worker.postMessage(request);
    });
  }

  private postRequest(
    worker: Worker,
    request: FastScatterAggregationWorkerRequest,
    transferables: Transferable[] = [],
  ): Promise<FastScatterAggregationWorkerResponse> {
    return new Promise((resolve, reject) => {
      const handleMessage = (
        event: MessageEvent<FastScatterAggregationWorkerResponse>,
      ) => {
        if (event.data.requestId !== request.requestId) {
          return;
        }

        cleanup();
        resolve(event.data);
      };
      const handleError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message));
      };
      const cleanup = () => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
      };

      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
      worker.postMessage(request, transferables);
    });
  }

  private cancelPendingWorkerRequests(sequence: number): void {
    for (const [requestId, pending] of this.pendingWorkerRequests) {
      if (pending.sequence >= sequence) {
        continue;
      }

      this.pendingWorkerRequests.delete(requestId);
      pending.cleanup();
      pending.reject(new FastScatterAggregationStaleRequestError(requestId));
    }
  }
}
