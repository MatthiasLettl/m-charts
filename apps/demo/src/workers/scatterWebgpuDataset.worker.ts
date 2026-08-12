/// <reference lib="webworker" />

import {
  createScatterWebgpuDatasetGenerator,
  SCATTER_WEBGPU_DEFAULT_PAGE_SIZE,
  SCATTER_WEBGPU_DEFAULT_SEED,
} from '../data/scatterWebgpuDatasetFormat.ts';

interface StartMessage {
  count: number;
  pageSize?: number;
  seed?: number;
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

  void generate(event.data.count, event.data.pageSize, event.data.seed);
});

async function generate(
  count: number,
  pageSize = SCATTER_WEBGPU_DEFAULT_PAGE_SIZE,
  seed = SCATTER_WEBGPU_DEFAULT_SEED,
): Promise<void> {
  try {
    const generator = createScatterWebgpuDatasetGenerator({
      count,
      pageSize,
      seed,
    });
    for (let pageIndex = 0; pageIndex < generator.pageCount; pageIndex += 1) {
      const page = generator.createNextPage();
      if (page === null) break;
      const x = new Uint32Array(page.manifest.count);
      for (let localIndex = 0; localIndex < x.length; localIndex += 1) {
        x[localIndex] = generatedOverlapXValue(page.manifest.startIndex + localIndex);
      }
      worker.postMessage(
        { page, pageCount: generator.pageCount, type: 'page', xBuffer: x.buffer },
        [page.coordinateBuffer, page.styleBuffer, x.buffer],
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

function generatedOverlapXValue(index: number): number {
  const blockStart = Math.floor(index / 24) * 24;
  const offset = index - blockStart;
  if (offset >= 2 && offset < 5) return blockStart + 2;
  if (offset >= 14 && offset < 16) return blockStart + 14;
  return index;
}

export {};
