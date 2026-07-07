import type { FastScatterPointColumns } from '../core/index.js';
import {
  cloneFastScatterSelectionWorkerColumns,
  computeFastScatterSelectionWorkerRequest,
  estimateFastScatterSelectionRequestCandidateCount,
  type FastScatterSelectionExecutionResult,
  type FastScatterSelectionWorkerColumns,
  type FastScatterSelectionWorkerRequest,
  type FastScatterSelectionWorkerResponse,
  type FastScatterSelectionWorkerSelectLassoRequest,
  type FastScatterSelectionWorkerSelectRectangleRequest,
} from './workerProtocol.js';

export type FastScatterSelectionExecutionPreference = 'auto' | 'sync' | 'worker';

export interface FastScatterSelectionControllerOptions {
  readonly columns: Pick<FastScatterPointColumns, 'sourceIndex' | 'x' | 'xOrder' | 'y'>;
  readonly createWorker?: () => Worker;
  readonly minWorkerCandidateCount?: number;
  readonly preference?: FastScatterSelectionExecutionPreference;
}

export class FastScatterSelectionController {
  private readonly createWorker?: () => Worker;
  private readonly minWorkerCandidateCount: number;
  private readonly preference: FastScatterSelectionExecutionPreference;
  private readonly syncColumns: FastScatterSelectionWorkerColumns;
  private nextRequestId = 1;
  private setupPromise: Promise<void> | null = null;
  private worker: Worker | null = null;

  constructor(options: FastScatterSelectionControllerOptions) {
    this.createWorker = options.createWorker;
    this.minWorkerCandidateCount = Math.max(
      0,
      Math.floor(options.minWorkerCandidateCount ?? 50_000),
    );
    this.preference = options.preference ?? 'auto';
    this.syncColumns = {
      sourceIndex: options.columns.sourceIndex,
      x: options.columns.x,
      xOrder: options.columns.xOrder,
      y: options.columns.y,
    };
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.setupPromise = null;
  }

  selectRectangle(
    request: Omit<FastScatterSelectionWorkerSelectRectangleRequest, 'requestId'>,
  ): Promise<FastScatterSelectionExecutionResult> {
    return this.execute({ ...request, requestId: this.nextRequestId });
  }

  selectLasso(
    request: Omit<FastScatterSelectionWorkerSelectLassoRequest, 'requestId'>,
  ): Promise<FastScatterSelectionExecutionResult> {
    return this.execute({ ...request, requestId: this.nextRequestId });
  }

  private async execute(
    request:
      | FastScatterSelectionWorkerSelectLassoRequest
      | FastScatterSelectionWorkerSelectRectangleRequest,
  ): Promise<FastScatterSelectionExecutionResult> {
    this.nextRequestId += 1;
    const observableStartedAt = performance.now();
    const candidateCount = estimateFastScatterSelectionRequestCandidateCount(
      this.syncColumns,
      request,
    );
    const shouldUseWorker =
      this.preference === 'worker' ||
      (this.preference === 'auto' && candidateCount >= this.minWorkerCandidateCount);

    if (!shouldUseWorker || this.createWorker === undefined) {
      return this.executeSync(request, observableStartedAt, candidateCount);
    }

    try {
      return await this.executeWorker(request, observableStartedAt, candidateCount);
    } catch (error) {
      if (this.preference === 'worker') {
        throw new Error('Scatter-fast selection worker execution failed.', {
          cause: error,
        });
      }

      return this.executeSync(request, observableStartedAt, candidateCount);
    }
  }

  private executeSync(
    request:
      | FastScatterSelectionWorkerSelectLassoRequest
      | FastScatterSelectionWorkerSelectRectangleRequest,
    observableStartedAt: number,
    candidateCount: number,
  ): FastScatterSelectionExecutionResult {
    const result = computeFastScatterSelectionWorkerRequest(this.syncColumns, request);
    const observableMs = performance.now() - observableStartedAt;

    return {
      sourceIndices: result.sourceIndices,
      timing: {
        candidateCount,
        computeMs: result.computeMs,
        mode: 'sync',
        observableMs,
        transferMs: 0,
      },
    };
  }

  private async executeWorker(
    request:
      | FastScatterSelectionWorkerSelectLassoRequest
      | FastScatterSelectionWorkerSelectRectangleRequest,
    observableStartedAt: number,
    candidateCount: number,
  ): Promise<FastScatterSelectionExecutionResult> {
    const worker = this.getWorker();
    await this.ensureWorkerSetup(worker);
    const response = await this.postRequest(worker, request);

    if (response.type !== 'selection-result') {
      throw new Error(
        response.type === 'selection-error'
          ? response.message
          : 'Scatter-fast selection worker returned an invalid response.',
      );
    }

    const observableMs = performance.now() - observableStartedAt;

    return {
      sourceIndices: response.sourceIndices,
      timing: {
        candidateCount,
        computeMs: response.computeMs,
        mode: 'worker',
        observableMs,
        transferMs: Math.max(0, observableMs - response.computeMs),
      },
    };
  }

  private getWorker(): Worker {
    if (this.worker === null) {
      if (this.createWorker === undefined) {
        throw new Error('Scatter-fast selection worker factory is unavailable.');
      }

      this.worker = this.createWorker();
    }

    return this.worker;
  }

  private ensureWorkerSetup(worker: Worker): Promise<void> {
    if (this.setupPromise !== null) {
      return this.setupPromise;
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const request = {
      columns: cloneFastScatterSelectionWorkerColumns(this.syncColumns),
      requestId,
      type: 'setup',
    } satisfies FastScatterSelectionWorkerRequest;

    this.setupPromise = this.postRequest(worker, request).then((response) => {
      if (response.type !== 'setup-complete') {
        throw new Error(
          response.type === 'selection-error'
            ? response.message
            : 'Scatter-fast selection worker setup failed.',
        );
      }
    });

    return this.setupPromise;
  }

  private postRequest(
    worker: Worker,
    request: FastScatterSelectionWorkerRequest,
  ): Promise<FastScatterSelectionWorkerResponse> {
    return new Promise((resolve, reject) => {
      const handleMessage = (
        event: MessageEvent<FastScatterSelectionWorkerResponse>,
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
      worker.postMessage(request);
    });
  }
}
