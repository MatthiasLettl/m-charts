import {
  createParallelWebgpuBuffers,
  type ParallelAxisDomains,
  type ParallelBuffers,
  type ParallelFastAxisSpec,
  type ParallelFastColumns,
  type ParallelWebgpuPackedData,
  type ParallelWebgpuPackedPage,
} from 'm-charts/m-parallel-webgpu';

import type { FastRouteTableMode } from './fastRouteDataMode.ts';
import { loadFastPlotMixedTableFixture } from './fastPlotTableSources.ts';
import type {
  ScatterWebgpuPagedManifest,
} from './scatterWebgpuDatasetFormat.ts';

const PRIMARY_TABLE = 'benchmark-primary';
const SECONDARY_TABLE = 'benchmark-secondary';
const DEFAULT_TIMESTAMP_SCALE_MS = 250;
const DEFAULT_REPRESENTATIVE_RECORD_LIMIT = 120_000;

const SINGLE_TABLE_AXES: readonly ParallelFastAxisSpec[] = [
  {
    key: 'timestamp',
    kind: 'numeric',
    label: 'Timestamp position',
    unit: 'normalized',
  },
  {
    categories: [
      { label: 'Idle', order: 0, value: 0 },
      { label: 'Ramp', order: 1, value: 1 },
      { label: 'Steady', order: 2, value: 2 },
      { label: 'Cooldown', order: 3, value: 3 },
    ],
    key: 'phase',
    kind: 'categorical',
    label: 'Process phase',
  },
  {
    categories: [
      { label: 'Rejected', order: 0, value: false },
      { label: 'Accepted', order: 1, value: true },
    ],
    key: 'accepted',
    kind: 'boolean',
    label: 'Acceptance',
  },
  {
    key: 'signalValue',
    kind: 'numeric',
    label: 'Signal value',
    unit: 'a.u.',
  },
];

const MULTI_TABLE_AXES: readonly ParallelFastAxisSpec[] = [
  {
    // The compact source contains millisecond offsets. Its finalized metadata
    // is promoted to datetime-ns after buffer creation.
    key: 'timestampNs',
    kind: 'numeric',
    label: 'Timestamp',
    unit: 'UTC',
  },
  {
    key: 'signalValue',
    kind: 'numeric',
    label: 'Signal value',
    unit: 'a.u.',
  },
  SINGLE_TABLE_AXES[1]!,
  SINGLE_TABLE_AXES[2]!,
  {
    key: 'secondarySignal',
    kind: 'numeric',
    label: 'Secondary signal',
    unit: 'a.u.',
  },
  {
    key: 'secondaryDrift',
    kind: 'numeric',
    label: 'Secondary drift',
    unit: 'a.u.',
  },
  {
    categories: [
      { label: PRIMARY_TABLE, order: 0, value: 0 },
      { label: SECONDARY_TABLE, order: 1, value: 1 },
    ],
    key: 'table',
    kind: 'categorical',
    label: 'Table',
  },
];

export function getParallelWebgpuDemoAxisSchema(
  tableMode: FastRouteTableMode,
): { axes: readonly ParallelFastAxisSpec[]; axisOrder: readonly string[] } {
  const axes = tableMode === 'multi' ? MULTI_TABLE_AXES : SINGLE_TABLE_AXES;
  return { axes, axisOrder: axes.map((axis) => axis.key) };
}

export interface LoadedParallelWebgpuDataset {
  buffers: ParallelBuffers;
  generated: boolean;
  loadMs: number;
  storedBytes: number;
  tableNames: readonly string[];
  tableRecordCounts: Readonly<Record<string, number>>;
}

export class LocalParallelWebgpuDatasetUnavailableError extends Error {}

export async function loadParallelWebgpuDataset(options: {
  manifestUrl?: string;
  fixtureUrl: string;
  pointCount: number;
  signal: AbortSignal;
  startedAt: number;
  tableMode: FastRouteTableMode;
}): Promise<LoadedParallelWebgpuDataset> {
  const primary = await openPrimaryColumnsWorker(options);
  throwIfAborted(options.signal);

  const secondaryFixture =
    options.tableMode === 'multi'
      ? (
          await loadFastPlotMixedTableFixture(
            options.fixtureUrl.replace(
              /\.json(?=($|[?#]))/u,
              '.secondary.json',
            ),
          )
        ).fixture
      : null;
  const secondaryRecords = secondaryFixture?.tables.flatMap(
    (table) => table.records,
  ) ?? [];
  const primaryCount = options.pointCount;
  const totalCount = primaryCount + secondaryRecords.length;
  const timestampOriginNs = BigInt(primary.manifest.timestampOriginNs);
  const timestampScaleMs = primary.manifest.xScaleMs ?? DEFAULT_TIMESTAMP_SCALE_MS;
  const timestamp = createCompactNumericView(totalCount, (sourceIndex) =>
    sourceIndex < primaryCount
      ? options.tableMode === 'multi'
        ? generatedOverlapXValue(sourceIndex) * timestampScaleMs
        : primaryCount <= 1 ? 0 : sourceIndex / (primaryCount - 1)
      : options.tableMode === 'multi'
        ? datetimeNsOffsetMs(
            secondaryRecords[sourceIndex - primaryCount]?.timestampNs,
            timestampOriginNs,
          )
        : totalCount <= 1 ? 0 : sourceIndex / (totalCount - 1),
  );
  const primaryPages = createPrimaryPageViews(primary);
  const secondaryPhase = new Uint8Array(secondaryRecords.length);
  const secondaryAccepted = new Uint8Array(secondaryRecords.length);
  const secondarySignal = new Float32Array(secondaryRecords.length);
  const secondaryColor = new Uint8Array(secondaryRecords.length * 4);
  const phase = createCompactNumericView(totalCount, (sourceIndex) =>
    sourceIndex < primaryCount
      ? readPrimaryPageValue(primaryPages.phase, primary.manifest, sourceIndex)
      : secondaryPhase[sourceIndex - primaryCount] ?? 0,
  );
  const accepted = createCompactNumericView(totalCount, (sourceIndex) =>
    sourceIndex < primaryCount
      ? readPrimaryPageValue(primaryPages.accepted, primary.manifest, sourceIndex)
      : secondaryAccepted[sourceIndex - primaryCount] ?? 0,
  );
  const signalScale = primary.manifest.columnScales?.signalValue ?? 0.0025;
  const signalValue = createCompactNumericView(totalCount, (sourceIndex) =>
    sourceIndex < primaryCount
      ? readPrimaryPageValue(primaryPages.signal, primary.manifest, sourceIndex) * signalScale
      : secondarySignal[sourceIndex - primaryCount] ?? 0,
  );
  const secondarySignalValue = createCompactNumericView(totalCount, (sourceIndex) =>
    sourceIndex < primaryCount
      ? Number.NaN
      : readOptionalFiniteNumber(
          secondaryRecords[sourceIndex - primaryCount]?.secondarySignal,
        ),
  );
  const secondaryDrift = createCompactNumericView(totalCount, (sourceIndex) =>
    sourceIndex < primaryCount
      ? Number.NaN
      : readOptionalFiniteNumber(
          secondaryRecords[sourceIndex - primaryCount]?.secondaryDrift,
        ),
  );
  const table = options.tableMode === 'multi'
    ? new Uint8Array(totalCount)
    : null;
  const color = createCompactRgbaView(
    totalCount,
    (sourceIndex, channel) => {
      if (sourceIndex >= primaryCount) {
        return secondaryColor[(sourceIndex - primaryCount) * 4 + channel] ?? 0;
      }
      return decodePackedStyleChannel(
        readPrimaryPageValue(primaryPages.styles, primary.manifest, sourceIndex),
        channel,
      );
    },
    (sourceIndex) => {
      if (sourceIndex < primaryCount) {
        return decodeParallelPackedStyleRgba(readPrimaryPageValue(
          primaryPages.styles,
          primary.manifest,
          sourceIndex,
        ));
      }
      const offset = (sourceIndex - primaryCount) * 4;
      return (
        (secondaryColor[offset] ?? 0) |
        ((secondaryColor[offset + 1] ?? 0) << 8) |
        ((secondaryColor[offset + 2] ?? 0) << 16) |
        ((secondaryColor[offset + 3] ?? 0) << 24)
      ) >>> 0;
    },
  );

  for (
    let secondaryIndex = 0;
    secondaryIndex < secondaryRecords.length;
    secondaryIndex += 1
  ) {
    const sourceIndex = primaryCount + secondaryIndex;
    const record = secondaryRecords[secondaryIndex]!;
    secondaryPhase[secondaryIndex] = phaseCode(record.phase);
    secondaryAccepted[secondaryIndex] = record.accepted ? 1 : 0;
    secondarySignal[secondaryIndex] = record.signalValue;
    table![sourceIndex] = 1;
    decodeHexColor(record.color, secondaryColor, secondaryIndex * 4, record.opacity);
  }

  const ids = createLazyArray(totalCount, (sourceIndex) =>
    sourceIndex < primaryCount
      ? `${primary.manifest.idPrefix}${String(sourceIndex).padStart(
          primary.manifest.idWidth,
          '0',
        )}`
      : secondaryRecords[sourceIndex - primaryCount]?.id ??
        `secondary-${sourceIndex}`,
  );
  const tableBySourceIndex = createLazyArray(totalCount, (sourceIndex) =>
    sourceIndex < primaryCount ? PRIMARY_TABLE : SECONDARY_TABLE,
  );
  const recordIdentityBySourceIndex = createLazyArray(
    totalCount,
    (sourceIndex) => ({
      id: ids[sourceIndex] ?? String(sourceIndex),
      sourceIndex,
      table: tableBySourceIndex[sourceIndex]!,
    }),
  );
  const { axes, axisOrder } = getParallelWebgpuDemoAxisSchema(options.tableMode);
  const columns: ParallelFastColumns = {
    axes,
    axisOrder,
    color,
    colorFormat: 'rgba8',
    ids,
    recordIdentityBySourceIndex,
    tableBySourceIndex,
    valuesByAxis: {
      accepted,
      phase,
      signalValue,
      ...(options.tableMode === 'multi'
        ? {
            secondaryDrift,
            secondarySignal: secondarySignalValue,
            table: table!,
            timestampNs: timestamp,
          }
        : { timestamp }),
    },
  };
  const tableRecordCounts = {
    [PRIMARY_TABLE]: primaryCount,
    ...(options.tableMode === 'multi'
      ? { [SECONDARY_TABLE]: secondaryRecords.length }
      : {}),
  };
  const prepared = createPreparedParallelMetadata({
    axisOrder,
    manifest: primary.manifest,
    primaryCount,
    secondaryRecords,
    signalScale,
    tableMode: options.tableMode,
    timestampOriginNs,
    timestampScaleMs,
  });
  primary.configure({
    axes: axisOrder.map((key) => {
      const axis = axes.find((candidate) => candidate.key === key)!;
      const domain = prepared.domainsByAxis[key]!;
      return {
        ...(axis.kind === 'categorical' || axis.kind === 'boolean'
          ? { categories: axis.categories?.map((_category, index) => index) ?? [] }
          : {}),
        key,
        max: domain.max,
        min: domain.min,
      };
    }),
    primaryCount,
    representativeRecordLimit: DEFAULT_REPRESENTATIVE_RECORD_LIMIT,
    secondaryValuesByAxis: secondaryRecords.map((_record, secondaryIndex) => {
      const sourceIndex = primaryCount + secondaryIndex;
      return axisOrder.map((axis) => Number(columns.valuesByAxis[axis]?.[sourceIndex]));
    }),
    signalScale,
    timestampScaleMs,
    totalCount,
  });
  const buffers = createParallelWebgpuBuffers(columns, {
    packedData: primary.packedData,
    preparedDomainsByAxis: prepared.domainsByAxis,
    preparedMissingValueCountByAxis: prepared.missingValueCountByAxis,
    trustedEncodedTypedColumns: true,
  });
  if (options.tableMode === 'multi') {
    promoteTimestampAxisToDatetimeNs({
      buffers,
      primaryCount,
      secondaryRecords,
      timestampOriginNs,
      timestampScaleMs,
    });
  }

  return {
    buffers,
    generated: false,
    loadMs: performance.now() - options.startedAt,
    storedBytes: primary.byteLength,
    tableNames: Object.keys(tableRecordCounts),
    tableRecordCounts,
  };
}

async function openPrimaryColumnsWorker(options: {
  manifestUrl?: string;
  pointCount: number;
  signal: AbortSignal;
}): Promise<{
  byteLength: number;
  coordinatePages: ArrayBuffer[];
  configure(options: {
    axes: readonly {
      categories?: readonly number[];
      key: string;
      max: number;
      min: number;
    }[];
    primaryCount: number;
    representativeRecordLimit: number;
    secondaryValuesByAxis: readonly (readonly number[])[];
    signalScale: number;
    timestampScaleMs: number;
    totalCount: number;
  }): void;
  manifest: ScatterWebgpuPagedManifest;
  packedData: ParallelWebgpuPackedData;
  stylePages: ArrayBuffer[];
}> {
  const datasetWorker = new Worker(
    new URL('../workers/parallelWebgpuDataset.worker.ts', import.meta.url),
    { type: 'module' },
  );
  const coordinatePages: ArrayBuffer[] = [];
  const stylePages: ArrayBuffer[] = [];
  const queuedPages: ParallelWebgpuPackedPage[] = [];
  const pageWaiters: Array<{
    reject(error: unknown): void;
    resolve(page: ParallelWebgpuPackedPage | null): void;
  }> = [];
  let complete = false;
  let streamError: unknown = null;
  let resolveRepresentatives!: (indices: Uint32Array) => void;
  let rejectRepresentatives!: (error: unknown) => void;
  const representativeSourceIndices = new Promise<Uint32Array>((resolve, reject) => {
    resolveRepresentatives = resolve;
    rejectRepresentatives = reject;
  });
  void representativeSourceIndices.catch(() => undefined);
  const manifestResult = await new Promise<{
    byteLength: number;
    manifest: ScatterWebgpuPagedManifest;
  }>((resolve, reject) => {
    const fail = (error: unknown) => {
      streamError = error;
      reject(error);
      rejectRepresentatives(error);
      for (const waiter of pageWaiters.splice(0)) waiter.reject(error);
      datasetWorker.terminate();
    };
    const abort = () => fail(new DOMException('Dataset load was cancelled.', 'AbortError'));
    options.signal.addEventListener('abort', abort, { once: true });
    datasetWorker.addEventListener('error', (event) => fail(new Error(event.message)));
    datasetWorker.addEventListener('message', (event: MessageEvent<
      | { message: string; type: 'error' }
      | { byteLength: number; manifest: ScatterWebgpuPagedManifest; type: 'manifest' }
      | {
          coordinateBuffer: ArrayBuffer;
          count: number;
          densityStyles: ArrayBuffer;
          packedValues: ArrayBuffer;
          pageIndex: number;
          start: number;
          styleBuffer: ArrayBuffer;
          type: 'page';
        }
      | { representativeSourceIndices: ArrayBuffer; type: 'complete' }
    >) => {
      if (event.data.type === 'error') {
        fail(
          event.data.message === 'LOCAL_DATASET_MISSING'
            ? new LocalParallelWebgpuDatasetUnavailableError(
                'Generate this WebGPU dataset in the browser before loading it.',
              )
            : new Error(event.data.message),
        );
      } else if (event.data.type === 'manifest') {
        resolve(event.data);
      } else if (event.data.type === 'page') {
        coordinatePages[event.data.pageIndex] = event.data.coordinateBuffer;
        stylePages[event.data.pageIndex] = event.data.styleBuffer;
        const page: ParallelWebgpuPackedPage = {
          count: event.data.count,
          densityStyles: new Uint32Array(event.data.densityStyles),
          start: event.data.start,
          values: new Uint32Array(event.data.packedValues),
        };
        const waiter = pageWaiters.shift();
        if (waiter === undefined) queuedPages.push(page);
        else waiter.resolve(page);
      } else {
        complete = true;
        resolveRepresentatives(new Uint32Array(event.data.representativeSourceIndices));
        for (const waiter of pageWaiters.splice(0)) waiter.resolve(null);
        datasetWorker.terminate();
      }
    });
    datasetWorker.postMessage({
      ...(options.manifestUrl === undefined ? {} : { manifestUrl: options.manifestUrl }),
      pointCount: options.pointCount,
      type: 'load',
    });
  });
  const nextPage = () => {
    if (queuedPages.length > 0) return Promise.resolve(queuedPages.shift()!);
    if (streamError !== null) return Promise.reject(streamError);
    if (complete) return Promise.resolve(null);
    return new Promise<ParallelWebgpuPackedPage | null>((resolve, reject) => {
      pageWaiters.push({ reject, resolve });
    });
  };
  let pagesClaimed = false;
  return {
    ...manifestResult,
    coordinatePages,
    configure(config) {
      datasetWorker.postMessage({ ...config, type: 'configure' });
    },
    packedData: {
      async *createPages() {
        if (pagesClaimed) throw new Error('Parallel packed page stream was already consumed.');
        pagesClaimed = true;
        while (true) {
          const page = await nextPage();
          if (page === null) break;
          yield page;
        }
      },
      representativeRecordLimit: DEFAULT_REPRESENTATIVE_RECORD_LIMIT,
      representativeSourceIndices,
    },
    stylePages,
  };
}

function createPrimaryPageViews(primary: {
  coordinatePages: ArrayBuffer[];
  manifest: ScatterWebgpuPagedManifest;
  stylePages: ArrayBuffer[];
}) {
  return {
    accepted: createLazyPageViews(primary.coordinatePages, primary.manifest, 'accepted'),
    phase: createLazyPageViews(primary.coordinatePages, primary.manifest, 'phase'),
    signal: createLazyPageViews(primary.coordinatePages, primary.manifest, 'signalValue'),
    styles: new Proxy({ length: primary.manifest.pages.length }, {
      get(target, property) {
        if (property === 'length') return target.length;
        if (typeof property !== 'string' || !/^\d+$/u.test(property)) return undefined;
        const buffer = primary.stylePages[Number(property)];
        return buffer === undefined ? undefined : new Uint32Array(buffer);
      },
    }) as unknown as Uint32Array[],
  };
}

function createLazyPageViews(
  buffers: ArrayBuffer[],
  manifest: ScatterWebgpuPagedManifest,
  key: string,
): (Uint8Array | Uint16Array | Float32Array)[] {
  return new Proxy({ length: manifest.pages.length }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property !== 'string' || !/^\d+$/u.test(property)) return undefined;
      const pageIndex = Number(property);
      const buffer = buffers[pageIndex];
      const column = manifest.pages[pageIndex]?.columns[key];
      if (buffer === undefined || column === undefined) return undefined;
      if (column.type === 'Uint8Array') {
        return new Uint8Array(buffer, column.byteOffset, column.length);
      }
      if (column.type === 'Uint16Array') {
        return new Uint16Array(buffer, column.byteOffset, column.length);
      }
      return new Float32Array(buffer, column.byteOffset, column.length);
    },
  }) as unknown as (Uint8Array | Uint16Array | Float32Array)[];
}

function readPrimaryPageValue(
  pages: readonly (Float32Array | Uint8Array | Uint16Array | Uint32Array)[],
  manifest: ScatterWebgpuPagedManifest,
  sourceIndex: number,
): number {
  const pageIndex = Math.min(
    pages.length - 1,
    Math.floor(sourceIndex / manifest.pageSize),
  );
  const page = manifest.pages[pageIndex]!;
  return pages[pageIndex]?.[sourceIndex - page.startIndex] ?? 0;
}

function createPreparedParallelMetadata(options: {
  axisOrder: readonly string[];
  manifest: ScatterWebgpuPagedManifest;
  primaryCount: number;
  secondaryRecords: readonly Readonly<Record<string, unknown>>[];
  signalScale: number;
  tableMode: FastRouteTableMode;
  timestampOriginNs: bigint;
  timestampScaleMs: number;
}): {
  domainsByAxis: ParallelAxisDomains;
  missingValueCountByAxis: Readonly<Record<string, number>>;
} {
  const encodedSignalDomain = options.manifest.domains.signalValue ?? { max: 0, min: 0 };
  const encodedTimestampDomain = options.manifest.domains.timestampNs ?? {
    max: Math.max(0, options.primaryCount - 1),
    min: 0,
  };
  const initialRanges: Record<string, { max: number; min: number }> = {
    accepted: { max: 1.5, min: -0.5 },
    phase: { max: 3.5, min: -0.5 },
    signalValue: {
      max: encodedSignalDomain.max * options.signalScale,
      min: encodedSignalDomain.min * options.signalScale,
    },
    ...(options.tableMode === 'multi'
      ? {
          secondaryDrift: { max: Number.NEGATIVE_INFINITY, min: Number.POSITIVE_INFINITY },
          secondarySignal: { max: Number.NEGATIVE_INFINITY, min: Number.POSITIVE_INFINITY },
          table: { max: 1.5, min: -0.5 },
          timestampNs: {
            max: encodedTimestampDomain.max * options.timestampScaleMs,
            min: encodedTimestampDomain.min * options.timestampScaleMs,
          },
        }
      : { timestamp: { max: options.primaryCount <= 1 ? 0 : 1, min: 0 } }),
  };
  const missing: Record<string, number> = Object.fromEntries(
    options.axisOrder.map((axis) => [
      axis,
      axis === 'secondarySignal' || axis === 'secondaryDrift'
        ? options.primaryCount
        : 0,
    ]),
  );
  const extend = (axis: string, value: number) => {
    if (!Number.isFinite(value)) {
      missing[axis] = (missing[axis] ?? 0) + 1;
      return;
    }
    const range = initialRanges[axis]!;
    range.min = Math.min(range.min, value);
    range.max = Math.max(range.max, value);
  };
  for (const record of options.secondaryRecords) {
    extend('timestampNs', datetimeNsOffsetMs(record.timestampNs, options.timestampOriginNs));
    extend('signalValue', readOptionalFiniteNumber(record.signalValue));
    extend('secondarySignal', readOptionalFiniteNumber(record.secondarySignal));
    extend('secondaryDrift', readOptionalFiniteNumber(record.secondaryDrift));
    if (record.phase === null || record.phase === undefined) {
      missing.phase = (missing.phase ?? 0) + 1;
    }
    if (record.accepted === null || record.accepted === undefined) {
      missing.accepted = (missing.accepted ?? 0) + 1;
    }
  }
  const domainsByAxis = Object.fromEntries(options.axisOrder.map((axis) => {
    const range = initialRanges[axis]!;
    const min = Number.isFinite(range.min) ? range.min : 0;
    const max = Number.isFinite(range.max) ? range.max : 0;
    return [axis, { max, min, span: max - min }];
  })) as ParallelAxisDomains;
  return { domainsByAxis, missingValueCountByAxis: missing };
}

function decodePackedStyleChannel(packed: number, channel: number): number {
  const rgb565 = packed & 0xffff;
  if (channel === 0) return Math.round(((rgb565 & 31) / 31) * 255);
  if (channel === 1) return Math.round((((rgb565 >>> 5) & 63) / 63) * 255);
  if (channel === 2) return Math.round((((rgb565 >>> 11) & 31) / 31) * 255);
  return Math.round((((packed >>> 16) & 15) / 15) * 255);
}

export function decodeParallelPackedStyleRgba(packed: number): number {
  const red = Math.round(((packed & 31) / 31) * 255);
  const green = Math.round((((packed >>> 5) & 63) / 63) * 255);
  const blue = Math.round((((packed >>> 11) & 31) / 31) * 255);
  const alpha = ((packed >>> 16) & 15) * 17;
  return (red | (green << 8) | (blue << 16) | (alpha << 24)) >>> 0;
}

function decodeHexColor(
  value: string,
  output: Uint8Array,
  offset: number,
  opacity: number,
): void {
  const color = Number.parseInt(value.replace('#', ''), 16);
  output[offset] = (color >>> 16) & 255;
  output[offset + 1] = (color >>> 8) & 255;
  output[offset + 2] = color & 255;
  output[offset + 3] = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
}

function phaseCode(value: string): number {
  return { cooldown: 3, idle: 0, ramp: 1, steady: 2 }[
    value as 'cooldown' | 'idle' | 'ramp' | 'steady'
  ] ?? 0;
}

function generatedOverlapXValue(index: number): number {
  const blockStart = Math.floor(index / 24) * 24;
  const offset = index - blockStart;
  if (offset >= 2 && offset < 5) return blockStart + 2;
  if (offset >= 14 && offset < 16) return blockStart + 14;
  return index;
}

function datetimeNsOffsetMs(value: unknown, originNs: bigint): number {
  if (typeof value !== 'string' && typeof value !== 'bigint') {
    return Number.NaN;
  }
  try {
    return Number(BigInt(value) - originNs) / 1_000_000;
  } catch {
    return Number.NaN;
  }
}

function readOptionalFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number.NaN;
}

function promoteTimestampAxisToDatetimeNs(options: {
  buffers: ParallelBuffers;
  primaryCount: number;
  secondaryRecords: readonly Readonly<Record<string, unknown>>[];
  timestampOriginNs: bigint;
  timestampScaleMs: number;
}): void {
  const domain = options.buffers.domainsByAxis.timestampNs!;
  const epochNsValues = createLazyArray<string | undefined>(
    options.buffers.recordCount,
    (sourceIndex) => {
      if (sourceIndex < options.primaryCount) {
        return (
          options.timestampOriginNs +
          BigInt(Math.round(
            generatedOverlapXValue(sourceIndex) *
              options.timestampScaleMs *
              1_000_000,
          ))
        ).toString();
      }
      const value = options.secondaryRecords[
        sourceIndex - options.primaryCount
      ]?.timestampNs;
      return typeof value === 'string' || typeof value === 'bigint'
        ? String(value)
        : undefined;
    },
  );

  options.buffers.axisMetadataByAxis = {
    ...options.buffers.axisMetadataByAxis,
    timestampNs: {
      datetimeOriginNs: options.timestampOriginNs.toString(),
      datetimeOriginNsBigInt: options.timestampOriginNs,
      domain: { max: domain.max, min: domain.min },
      epochNsValues,
      key: 'timestampNs',
      kind: 'datetime-ns',
      label: 'Timestamp',
      unit: 'UTC',
    },
  };
}

function createLazyArray<T>(
  length: number,
  getValue: (index: number) => T,
): readonly T[] {
  return new Proxy({ length }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property !== 'string' || !/^\d+$/u.test(property)) {
        return undefined;
      }
      const index = Number(property);
      return index < length ? getValue(index) : undefined;
    },
  }) as unknown as readonly T[];
}

function createCompactNumericView(
  length: number,
  getValue: (index: number) => number,
): readonly number[] {
  const target = {
    __parallelCompactGetValue: getValue,
    __parallelCompactNumericView: true as const,
    length,
  };
  return new Proxy(target, {
    get(target, property) {
      if (property in target) {
        return target[property as keyof typeof target];
      }
      if (typeof property !== 'string' || !/^\d+$/u.test(property)) {
        return undefined;
      }
      const index = Number(property);
      return index < length ? getValue(index) : undefined;
    },
  }) as unknown as readonly number[];
}

function createCompactRgbaView(
  recordCount: number,
  getChannel: (sourceIndex: number, channel: number) => number,
  getPackedRgba: (sourceIndex: number) => number,
) {
  const length = recordCount * 4;
  const target = {
    __parallelCompactGetPackedRgba: getPackedRgba,
    __parallelCompactRgbaView: true as const,
    length,
  };
  return new Proxy(target, {
    get(target, property) {
      if (property in target) {
        return target[property as keyof typeof target];
      }
      if (typeof property !== 'string' || !/^\d+$/u.test(property)) {
        return undefined;
      }
      const index = Number(property);
      return index < length
        ? getChannel(Math.floor(index / 4), index % 4)
        : undefined;
    },
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Dataset load was cancelled.', 'AbortError');
  }
}
