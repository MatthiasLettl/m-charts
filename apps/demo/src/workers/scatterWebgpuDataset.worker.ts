/// <reference lib="webworker" />

import {
  createScatterWebgpuDatasetGenerator,
  SCATTER_WEBGPU_DEFAULT_PAGE_SIZE,
  SCATTER_WEBGPU_DEFAULT_SEED,
} from '../data/scatterWebgpuDatasetFormat.ts';

interface StartMessage {
  count: number;
  type: 'start';
}

interface ContinueMessage {
  type: 'continue';
}

type IncomingMessage = ContinueMessage | StartMessage;

const worker = self as DedicatedWorkerGlobalScope;
let continueGeneration: (() => void) | null = null;

worker.addEventListener('message', (event: MessageEvent<IncomingMessage>) => {
  if (event.data.type === 'continue') {
    continueGeneration?.();
    continueGeneration = null;
    return;
  }

  void generate(event.data.count);
});

async function generate(count: number): Promise<void> {
  try {
    const generator = createScatterWebgpuDatasetGenerator({
      count,
      pageSize: SCATTER_WEBGPU_DEFAULT_PAGE_SIZE,
      seed: SCATTER_WEBGPU_DEFAULT_SEED,
    });
    for (let pageIndex = 0; pageIndex < generator.pageCount; pageIndex += 1) {
      const page = generator.createNextPage();
      if (page === null) break;
      worker.postMessage(
        { page, pageCount: generator.pageCount, type: 'page' },
        [page.coordinateBuffer, page.styleBuffer],
      );
      await new Promise<void>((resolve) => {
        continueGeneration = resolve;
      });
    }
    worker.postMessage({ manifest: generator.createManifest(), type: 'complete' });
  } catch (error) {
    worker.postMessage({
      message: error instanceof Error ? error.message : 'Unknown dataset generation error.',
      type: 'error',
    });
  }
}

export {};
