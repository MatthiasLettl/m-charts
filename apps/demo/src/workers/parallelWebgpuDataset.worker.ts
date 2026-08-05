/// <reference lib="webworker" />

import { ParallelRepresentativeAccumulator } from 'm-charts/m-parallel-webgpu';

import {
  getStoredScatterWebgpuDataset,
  readStoredScatterWebgpuPage,
} from '../data/scatterWebgpuDatasetStore.ts';
import type {
  ScatterWebgpuPagedManifest,
  ScatterWebgpuPagedManifestPage,
} from '../data/scatterWebgpuDatasetFormat.ts';

const worker = self as DedicatedWorkerGlobalScope;
const STYLE_PREFETCH_PAGES = 4;

interface ConfiguredAxis {
  categories?: readonly number[];
  key: string;
  max: number;
  min: number;
}

interface ConfigureMessage {
  axes: readonly ConfiguredAxis[];
  primaryCount: number;
  representativeRecordLimit: number;
  secondaryValuesByAxis: readonly (readonly number[])[];
  signalScale: number;
  timestampScaleMs: number;
  totalCount: number;
  type: 'configure';
}

type PageSource = Awaited<ReturnType<typeof createLocalSource>> | Awaited<
  ReturnType<typeof createHttpSource>
>;

let source: PageSource | null = null;
let configured = false;

worker.addEventListener('message', (event: MessageEvent<
  | { manifestUrl?: string; pointCount: number; type: 'load' }
  | ConfigureMessage
>) => {
  if (event.data.type === 'load') {
    void open(event.data).catch(reportError);
  } else if (!configured) {
    configured = true;
    void stream(event.data).catch(reportError);
  }
});

async function open(options: { manifestUrl?: string; pointCount: number }) {
  source = options.manifestUrl === undefined
    ? await createLocalSource(options.pointCount)
    : await createHttpSource(options.manifestUrl);
  worker.postMessage({
    byteLength: source.byteLength,
    manifest: source.manifest,
    type: 'manifest',
  });
}

async function stream(options: ConfigureMessage) {
  if (source === null) throw new Error('Parallel WebGPU source is not open.');
  const accumulator = new ParallelRepresentativeAccumulator(
    options.axes.map(({ categories }) =>
      categories === undefined ? {} : { categories },
    ),
    options.totalCount,
    options.representativeRecordLimit,
  );
  const activePages = source.manifest.pages.filter(
    (page) => page.startIndex < options.primaryCount,
  );
  const pending = new Map<number, Promise<[ArrayBuffer, ArrayBuffer]>>();
  const prefetch = (activeIndex: number) => {
    const page = activePages[activeIndex];
    if (page === undefined || pending.has(activeIndex)) return;
    const sourceIndex = source!.manifest.pages.indexOf(page);
    pending.set(activeIndex, Promise.all([
      source!.readPage('coordinates', page, sourceIndex),
      source!.readPage('styles', page, sourceIndex),
    ]));
  };
  for (let index = 0; index < STYLE_PREFETCH_PAGES; index += 1) prefetch(index);

  for (let activeIndex = 0; activeIndex < activePages.length; activeIndex += 1) {
    const page = activePages[activeIndex]!;
    const [coordinateBuffer, styleBuffer] = await pending.get(activeIndex)!;
    pending.delete(activeIndex);
    prefetch(activeIndex + STYLE_PREFETCH_PAGES);
    const count = Math.min(page.count, options.primaryCount - page.startIndex);
    const phase = readColumn(coordinateBuffer, page, 'phase');
    const accepted = readColumn(coordinateBuffer, page, 'accepted');
    const signal = readColumn(coordinateBuffer, page, 'signalValue');
    const sourceStyles = new Uint32Array(styleBuffer);
    const styleWordsPerRecord = (source.manifest.styleStrideBytes ?? 12) / 4;
    const valueCount = count * options.axes.length;
    const packedValues = new Uint32Array(Math.max(1, Math.ceil(valueCount / 2)));
    const densityStyles = new Uint32Array(Math.max(1, Math.ceil(count / 2)));
    const row = new Array<number>(options.axes.length);

    for (let localIndex = 0; localIndex < count; localIndex += 1) {
      const sourceIndex = page.startIndex + localIndex;
      for (let axisIndex = 0; axisIndex < options.axes.length; axisIndex += 1) {
        const axis = options.axes[axisIndex]!;
        const raw = readPrimaryAxisValue({
          accepted,
          axis: axis.key,
          localIndex,
          phase,
          primaryCount: options.primaryCount,
          signal,
          signalScale: options.signalScale,
          sourceIndex,
          timestampScaleMs: options.timestampScaleMs,
        });
        row[axisIndex] = raw;
        writeQuantizedValue(
          packedValues,
          localIndex * options.axes.length + axisIndex,
          normalize(raw, axis.min, axis.max),
        );
      }
      accumulator.add(sourceIndex, row);
      writeDensityStyle(
        densityStyles,
        localIndex,
        sourceStyles[localIndex * styleWordsPerRecord] ?? 0,
      );
    }

    worker.postMessage({
      coordinateBuffer,
      count,
      densityStyles: densityStyles.buffer,
      packedValues: packedValues.buffer,
      pageIndex: source.manifest.pages.indexOf(page),
      start: page.startIndex,
      styleBuffer,
      type: 'page',
    }, [
      coordinateBuffer,
      styleBuffer,
      packedValues.buffer,
      densityStyles.buffer,
    ]);
  }

  for (let secondaryIndex = 0; secondaryIndex < options.secondaryValuesByAxis.length; secondaryIndex += 1) {
    accumulator.add(
      options.primaryCount + secondaryIndex,
      options.secondaryValuesByAxis[secondaryIndex]!,
    );
  }
  const representativeSourceIndices = accumulator.finish();
  worker.postMessage({
    representativeSourceIndices: representativeSourceIndices.buffer,
    type: 'complete',
  }, [representativeSourceIndices.buffer]);
}

function readPrimaryAxisValue(options: {
  accepted: ArrayLike<number>;
  axis: string;
  localIndex: number;
  phase: ArrayLike<number>;
  primaryCount: number;
  signal: ArrayLike<number>;
  signalScale: number;
  sourceIndex: number;
  timestampScaleMs: number;
}): number {
  if (options.axis === 'timestamp') {
    return options.primaryCount <= 1
      ? 0
      : options.sourceIndex / (options.primaryCount - 1);
  }
  if (options.axis === 'timestampNs') {
    return generatedOverlapXValue(options.sourceIndex) * options.timestampScaleMs;
  }
  if (options.axis === 'phase') return options.phase[options.localIndex] ?? Number.NaN;
  if (options.axis === 'accepted') return options.accepted[options.localIndex] ?? Number.NaN;
  if (options.axis === 'signalValue') {
    return (options.signal[options.localIndex] ?? Number.NaN) * options.signalScale;
  }
  if (options.axis === 'table') return 0;
  return Number.NaN;
}

function readColumn(
  buffer: ArrayBuffer,
  page: ScatterWebgpuPagedManifestPage,
  key: string,
): Uint8Array | Uint16Array | Float32Array {
  const column = page.columns[key];
  if (column === undefined) throw new Error(`Parallel source column ${key} is missing.`);
  if (column.type === 'Uint8Array') {
    return new Uint8Array(buffer, column.byteOffset, column.length);
  }
  if (column.type === 'Uint16Array') {
    return new Uint16Array(buffer, column.byteOffset, column.length);
  }
  if (column.type === 'Float32Array') {
    return new Float32Array(buffer, column.byteOffset, column.length);
  }
  throw new Error(`Parallel source column ${key} uses unsupported type ${column.type}.`);
}

function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  return max === min ? 0.5 : (value - min) / (max - min);
}

function writeQuantizedValue(packed: Uint32Array, index: number, value: number): void {
  const quantized = Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(1, value)) * 65534)
    : 65535;
  const wordIndex = index >>> 1;
  const shift = (index & 1) * 16;
  packed[wordIndex] = (packed[wordIndex]! | (quantized << shift)) >>> 0;
}

function writeDensityStyle(output: Uint32Array, index: number, packed: number): void {
  const rgb565 = packed & 0xffff;
  const red8 = Math.round(((rgb565 & 31) / 31) * 255);
  const green8 = Math.round((((rgb565 >>> 5) & 63) / 63) * 255);
  const blue8 = Math.round((((rgb565 >>> 11) & 31) / 31) * 255);
  const alpha8 = ((packed >>> 16) & 15) * 17;
  const rgba4444 =
    ((red8 * 15 / 255) & 15) |
    (((green8 * 15 / 255) & 15) << 4) |
    (((blue8 * 15 / 255) & 15) << 8) |
    (((alpha8 * 15 / 255) & 15) << 12);
  const wordIndex = index >>> 1;
  output[wordIndex] = index % 2 === 0
    ? rgba4444
    : (output[wordIndex]! | (rgba4444 << 16)) >>> 0;
}

function generatedOverlapXValue(index: number): number {
  const blockStart = Math.floor(index / 24) * 24;
  const offset = index - blockStart;
  if (offset >= 2 && offset < 5) return blockStart + 2;
  if (offset >= 14 && offset < 16) return blockStart + 14;
  return index;
}

function reportError(error: unknown): void {
  worker.postMessage({
    message: error instanceof Error ? error.message : 'Unknown parallel dataset error.',
    type: 'error',
  });
}

async function createLocalSource(pointCount: number) {
  const stored = await getStoredScatterWebgpuDataset(pointCount);
  if (stored === null) throw new Error('LOCAL_DATASET_MISSING');
  return {
    byteLength: stored.byteLength,
    manifest: stored.manifest,
    readPage: (
      kind: 'coordinates' | 'styles',
      _page: ScatterWebgpuPagedManifestPage,
      pageIndex: number,
    ) => readStoredScatterWebgpuPage(stored.datasetId, kind, pageIndex),
  };
}

async function createHttpSource(manifestUrl: string) {
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`Could not load the WebGPU dataset manifest (${response.status}).`);
  const manifest = await response.json() as ScatterWebgpuPagedManifest;
  const baseUrl = new URL(manifestUrl, worker.location.href);
  return {
    byteLength: manifest.pages.reduce(
      (total, page) => total + page.byteLength + page.styleByteLength,
      0,
    ),
    manifest,
    async readPage(kind: 'coordinates' | 'styles', page: ScatterWebgpuPagedManifestPage) {
      const url = new URL(kind === 'coordinates' ? page.binary : page.styleBinary, baseUrl);
      const pageResponse = await fetch(url);
      if (!pageResponse.ok) throw new Error(`Could not load WebGPU dataset page ${url.pathname}.`);
      return pageResponse.arrayBuffer();
    },
  };
}

export {};
