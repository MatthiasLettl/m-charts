import {
  SCATTER_WEBGPU_DATASET_FORMAT_VERSION,
  SCATTER_WEBGPU_DEFAULT_PAGE_SIZE,
  SCATTER_WEBGPU_DEFAULT_SEED,
  SCATTER_WEBGPU_GENERATOR_VERSION,
  type ScatterWebgpuGeneratedPage,
  type ScatterWebgpuPagedManifest,
} from './scatterWebgpuDatasetFormat.ts';

const DATABASE_NAME = 'm-charts-webgpu-demo-datasets';
const DATABASE_VERSION =
  SCATTER_WEBGPU_DATASET_FORMAT_VERSION * 100 + SCATTER_WEBGPU_GENERATOR_VERSION;
const DATASETS_STORE = 'webgpu-datasets';
const PAGES_STORE = 'webgpu-pages';

export const SCATTER_WEBGPU_DEMO_POINT_COUNTS = [
  1_000_000,
  10_000_000,
  25_000_000,
] as const;

export interface StoredScatterWebgpuDataset {
  byteLength: number;
  completedAt: number;
  datasetId: string;
  manifest: ScatterWebgpuPagedManifest;
  status: 'ready';
}

interface StoredScatterWebgpuPage {
  buffer: ArrayBuffer;
  id: string;
}

interface BuildingScatterWebgpuDataset {
  byteLength: number;
  datasetId: string;
  startedAt: number;
  status: 'building';
}

type ScatterWebgpuDatasetRecord = BuildingScatterWebgpuDataset | StoredScatterWebgpuDataset;

export function scatterWebgpuDatasetId(pointCount: number): string {
  return [
    `v${SCATTER_WEBGPU_DATASET_FORMAT_VERSION}`,
    `g${SCATTER_WEBGPU_GENERATOR_VERSION}`,
    `seed${SCATTER_WEBGPU_DEFAULT_SEED}`,
    `page${SCATTER_WEBGPU_DEFAULT_PAGE_SIZE}`,
    `points${pointCount}`,
  ].join('-');
}

export async function getStoredScatterWebgpuDataset(
  pointCount: number,
): Promise<StoredScatterWebgpuDataset | null> {
  const database = await openDatabase();
  const record = await requestToPromise<ScatterWebgpuDatasetRecord | undefined>(
    database.transaction(DATASETS_STORE).objectStore(DATASETS_STORE).get(
      scatterWebgpuDatasetId(pointCount),
    ),
  );
  database.close();
  return record?.status === 'ready' ? record : null;
}

export async function listStoredScatterWebgpuDatasets(): Promise<
  StoredScatterWebgpuDataset[]
> {
  const database = await openDatabase();
  const records = await requestToPromise<ScatterWebgpuDatasetRecord[]>(
    database.transaction(DATASETS_STORE).objectStore(DATASETS_STORE).getAll(),
  );
  database.close();
  return records.filter(
    (record): record is StoredScatterWebgpuDataset => record.status === 'ready',
  );
}

export async function readStoredScatterWebgpuPage(
  datasetId: string,
  kind: 'coordinates' | 'styles',
  pageIndex: number,
): Promise<ArrayBuffer> {
  const database = await openDatabase();
  const id = pageId(datasetId, kind, pageIndex);
  const record = await requestToPromise<StoredScatterWebgpuPage | undefined>(
    database.transaction(PAGES_STORE).objectStore(PAGES_STORE).get(id),
  );
  database.close();
  if (record === undefined) {
    throw new Error(`Local WebGPU dataset page ${pageIndex} (${kind}) is missing.`);
  }
  return record.buffer;
}

export async function deleteStoredScatterWebgpuDataset(pointCount: number): Promise<void> {
  const datasetId = scatterWebgpuDatasetId(pointCount);
  const database = await openDatabase();
  const transaction = database.transaction([DATASETS_STORE, PAGES_STORE], 'readwrite');
  transaction.objectStore(DATASETS_STORE).delete(datasetId);
  const pages = transaction.objectStore(PAGES_STORE);
  const keys = await requestToPromise<IDBValidKey[]>(pages.getAllKeys());
  for (const key of keys) {
    if (typeof key === 'string' && key.startsWith(`${datasetId}:`)) pages.delete(key);
  }
  await transactionDone(transaction);
  database.close();
}

export async function generateAndStoreScatterWebgpuDataset(options: {
  onProgress: (progress: { completedPages: number; pageCount: number }) => void;
  pointCount: number;
  signal: AbortSignal;
}): Promise<StoredScatterWebgpuDataset> {
  if (options.signal.aborted) {
    throw new DOMException('Dataset generation was cancelled.', 'AbortError');
  }
  await assertStorageHeadroom(options.pointCount);
  void navigator.storage?.persist?.().catch(() => false);
  await deleteStoredScatterWebgpuDataset(options.pointCount);
  const datasetId = scatterWebgpuDatasetId(options.pointCount);
  await putDatasetRecord({
    byteLength: 0,
    datasetId,
    startedAt: Date.now(),
    status: 'building',
  });

  const worker = new Worker(
    new URL('../workers/scatterWebgpuDataset.worker.ts', import.meta.url),
    { type: 'module' },
  );

  try {
    return await new Promise<StoredScatterWebgpuDataset>((resolve, reject) => {
      let byteLength = 0;
      let completedPages = 0;
      let pendingPageWrite = Promise.resolve();
      const rejectAfterWrites = (error: Error) => {
        void pendingPageWrite.then(
          () => reject(error),
          () => reject(error),
        );
      };
      const abort = () => {
        rejectAfterWrites(new DOMException('Dataset generation was cancelled.', 'AbortError'));
      };
      options.signal.addEventListener('abort', abort, { once: true });

      worker.addEventListener('message', (event: MessageEvent<
        | { manifest: ScatterWebgpuPagedManifest; type: 'complete' }
        | { message: string; type: 'error' }
        | { page: ScatterWebgpuGeneratedPage; pageCount: number; type: 'page' }
      >) => {
        if (event.data.type === 'error') {
          rejectAfterWrites(new Error(event.data.message));
          return;
        }
        if (event.data.type === 'page') {
          const { page, pageCount } = event.data;
          pendingPageWrite = pendingPageWrite.then(async () => {
            if (options.signal.aborted) return;
            await putGeneratedPage(datasetId, page);
            byteLength += page.coordinateBuffer.byteLength + page.styleBuffer.byteLength;
            completedPages += 1;
            options.onProgress({ completedPages, pageCount });
            worker.postMessage({ type: 'continue' });
          });
          pendingPageWrite.catch(reject);
          return;
        }
        const manifest = event.data.manifest;
        void pendingPageWrite.then(async () => {
          if (options.signal.aborted) return;
          const dataset: StoredScatterWebgpuDataset = {
            byteLength,
            completedAt: Date.now(),
            datasetId,
            manifest,
            status: 'ready',
          };
          await putDatasetRecord(dataset);
          resolve(dataset);
        }).catch(reject);
      });
      worker.addEventListener('error', (event) => {
        rejectAfterWrites(new Error(event.message));
      });
      worker.postMessage({ count: options.pointCount, type: 'start' });
    });
  } catch (error) {
    await deleteStoredScatterWebgpuDataset(options.pointCount).catch(() => undefined);
    throw error;
  } finally {
    worker.terminate();
  }
}

async function assertStorageHeadroom(pointCount: number): Promise<void> {
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.quota === undefined || estimate.usage === undefined) return;
  const expectedBytes = pointCount * 8;
  const availableBytes = estimate.quota - estimate.usage;
  if (availableBytes < expectedBytes * 1.1) {
    throw new Error(
      `Not enough browser storage is available. This dataset needs about ${formatBytes(expectedBytes)}, but only ${formatBytes(availableBytes)} is free.`,
    );
  }
}

async function putGeneratedPage(
  datasetId: string,
  page: ScatterWebgpuGeneratedPage,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(PAGES_STORE, 'readwrite');
  const store = transaction.objectStore(PAGES_STORE);
  store.put({
    buffer: page.coordinateBuffer,
    id: pageId(datasetId, 'coordinates', page.pageIndex),
  } satisfies StoredScatterWebgpuPage);
  store.put({
    buffer: page.styleBuffer,
    id: pageId(datasetId, 'styles', page.pageIndex),
  } satisfies StoredScatterWebgpuPage);
  await transactionDone(transaction);
  database.close();
}

async function putDatasetRecord(record: ScatterWebgpuDatasetRecord): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(DATASETS_STORE, 'readwrite');
  transaction.objectStore(DATASETS_STORE).put(record);
  await transactionDone(transaction);
  database.close();
}

function pageId(
  datasetId: string,
  kind: 'coordinates' | 'styles',
  pageIndex: number,
): string {
  return `${datasetId}:${kind}:${pageIndex}`;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DATASETS_STORE)) {
        database.createObjectStore(DATASETS_STORE, { keyPath: 'datasetId' });
      } else {
        request.transaction?.objectStore(DATASETS_STORE).clear();
      }
      if (!database.objectStoreNames.contains(PAGES_STORE)) {
        database.createObjectStore(PAGES_STORE, { keyPath: 'id' });
      } else {
        request.transaction?.objectStore(PAGES_STORE).clear();
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB failed.')));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed.')));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')));
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')));
  });
}

function formatBytes(bytes: number): string {
  return `${Math.max(0, bytes) / (1024 * 1024) >= 100
    ? (Math.max(0, bytes) / (1024 * 1024)).toFixed(0)
    : (Math.max(0, bytes) / (1024 * 1024)).toFixed(1)} MB`;
}
