import {
  adaptMixedTablesForHistogram,
  type HistogramColumns,
  type HistogramDatasetAdapterMetadata,
  type HistogramParameterSpec,
  type HistogramPlotSpec,
  type HistogramValueColumn,
} from 'm-charts/m-histogram';

import type { FastRouteTableMode } from './fastRouteDataMode.ts';
import { loadFastPlotMixedTableFixture } from './fastPlotTableSources.ts';
import {
  SCATTER_WEBGPU_SCHEMA,
  type ScatterWebgpuPagedManifest,
  type ScatterWebgpuPagedManifestPage,
} from './scatterWebgpuDatasetFormat.ts';
import {
  generateAndStoreScatterWebgpuDataset,
  getStoredScatterWebgpuDataset,
  readStoredScatterWebgpuPage,
} from './scatterWebgpuDatasetStore.ts';

const PRIMARY_TABLE = 'benchmark-primary';
const DEFAULT_SIGNAL_SCALE = 0.0025;
const PHASE_COLORS = [
  0x6474_8bff,
  0x2563_ebff,
  0x0596_69ff,
  0x7c3a_edff,
] as const;
const REJECTED_COLORS = [0xdc26_26ff, 0xea58_0cff] as const;

export function getHistogramWebgpuRecordColor(
  phaseCode: number,
  isAccepted: boolean,
  sourceIndex: number,
): number {
  return isAccepted
    ? PHASE_COLORS[phaseCode] ?? PHASE_COLORS[0]
    : REJECTED_COLORS[sourceIndex % REJECTED_COLORS.length]!;
}

export interface LoadedHistogramWebgpuDataset {
  columns: HistogramColumns;
  generated: boolean;
  loadMs: number;
  metadata: HistogramDatasetAdapterMetadata;
  sourceFormat: string;
  spec: HistogramPlotSpec;
  storedBytes: number;
}

export async function loadHistogramWebgpuDataset(options: {
  fixtureUrl: string;
  pointCount: number;
  signal: AbortSignal;
  startedAt: number;
  tableMode: FastRouteTableMode;
}): Promise<LoadedHistogramWebgpuDataset> {
  let stored = await getStoredScatterWebgpuDataset(options.pointCount);
  let generated = false;
  if (stored === null) {
    stored = await generateAndStoreScatterWebgpuDataset({
      onProgress: () => undefined,
      pointCount: options.pointCount,
      signal: options.signal,
    });
    generated = true;
  }
  throwIfAborted(options.signal);

  const secondary = options.tableMode === 'multi'
    ? adaptMixedTablesForHistogram(
        (
          await loadFastPlotMixedTableFixture(
            options.fixtureUrl.replace(/\.json(?=($|[?#]))/u, '.secondary.json'),
          )
        ).fixture,
      )
    : null;
  const secondaryCount = secondary?.metadata.recordCount ?? 0;
  const totalCount = options.pointCount + secondaryCount;
  const manifest = stored.manifest;
  const parameters = createParameters(manifest, secondary?.spec.parameters ?? []);
  const phase = new Uint8Array(totalCount);
  const accepted = new Uint8Array(totalCount);
  const signalValue = new Float32Array(totalCount);
  signalValue.fill(Number.NaN);
  const color = new Uint32Array(totalCount);
  const valuesByParameter: Record<string, HistogramValueColumn> = {
    accepted,
    phase,
    signalValue,
  };

  for (const parameter of parameters) {
    if (valuesByParameter[parameter.key] !== undefined) continue;
    const values = new Float32Array(totalCount);
    values.fill(Number.NaN);
    valuesByParameter[parameter.key] = values;
  }

  const signalScale = manifest.columnScales?.signalValue ?? DEFAULT_SIGNAL_SCALE;
  for (let pageIndex = 0; pageIndex < manifest.pages.length; pageIndex += 1) {
    const page = manifest.pages[pageIndex]!;
    if (page.startIndex >= options.pointCount) break;
    throwIfAborted(options.signal);
    const buffer = await readStoredScatterWebgpuPage(
      stored.datasetId,
      'coordinates',
      pageIndex,
    );
    const copyCount = Math.min(page.count, options.pointCount - page.startIndex);
    const pagePhase = readPageColumn(buffer, page, 'phase', Uint8Array);
    const pageAccepted = readPageColumn(buffer, page, 'accepted', Uint8Array);
    const pageSignal = readPageColumn(buffer, page, 'signalValue', Uint16Array);
    phase.set(pagePhase.subarray(0, copyCount), page.startIndex);
    accepted.set(pageAccepted.subarray(0, copyCount), page.startIndex);
    for (let localIndex = 0; localIndex < copyCount; localIndex += 1) {
      const targetIndex = page.startIndex + localIndex;
      const phaseCode = pagePhase[localIndex] ?? 0;
      const isAccepted = pageAccepted[localIndex] === 1;
      signalValue[targetIndex] = (pageSignal[localIndex] ?? 0) * signalScale;
      color[targetIndex] = getHistogramWebgpuRecordColor(
        phaseCode,
        isAccepted,
        targetIndex,
      );
    }
    await yieldToBrowser();
  }

  if (secondary !== null) {
    for (const [key, source] of Object.entries(secondary.columns.valuesByParameter)) {
      const target = valuesByParameter[key];
      if (target === undefined) continue;
      copyValues(source, target, options.pointCount);
    }
    copyColors(
      secondary.columns.color,
      secondary.columns.colorFormat,
      color,
      options.pointCount,
      secondaryCount,
    );
  }

  const ids = createLazyArray(totalCount, (index) =>
    index < options.pointCount
      ? `${manifest.idPrefix}${String(index).padStart(manifest.idWidth, '0')}`
      : secondary?.columns.ids[index - options.pointCount] ?? `secondary-${index}`,
  );
  const tableBySourceIndex = createLazyArray(totalCount, (index) =>
    index < options.pointCount
      ? PRIMARY_TABLE
      : secondary?.columns.tableBySourceIndex?.[index - options.pointCount] ??
        secondary?.metadata.tableNames[0] ??
        'secondary-records',
  );
  const recordIdentityBySourceIndex = createLazyArray(totalCount, (sourceIndex) => ({
    id: ids[sourceIndex] ?? String(sourceIndex),
    sourceIndex,
    table: tableBySourceIndex[sourceIndex],
  }));
  const tableNames = options.tableMode === 'multi'
    ? [PRIMARY_TABLE, ...(secondary?.metadata.tableNames ?? [])]
    : [PRIMARY_TABLE];
  const tableRecordCounts = {
    [PRIMARY_TABLE]: options.pointCount,
    ...(secondary?.metadata.tableRecordCounts ?? {}),
  };

  return {
    columns: {
      color,
      colorFormat: 'rgba32',
      ids,
      parameters,
      recordIdentityBySourceIndex,
      tableBySourceIndex,
      valuesByParameter,
    },
    generated,
    loadMs: performance.now() - options.startedAt,
    metadata: {
      recordCount: totalCount,
      tableNames,
      tableRecordCounts,
    },
    sourceFormat: 'shared-scatter-webgpu-indexeddb',
    spec: {
      mode: 'histogram',
      parameters,
      subplots: parameters.map((parameter) => ({
        id: parameter.key,
        label: parameter.label,
        parameterKey: parameter.key,
      })),
    },
    storedBytes: stored.byteLength,
  };
}

function createParameters(
  manifest: ScatterWebgpuPagedManifest,
  secondaryParameters: readonly HistogramParameterSpec[],
): HistogramParameterSpec[] {
  const phaseSchema = SCATTER_WEBGPU_SCHEMA.columns.find((column) => column.key === 'phase');
  const acceptedSchema = SCATTER_WEBGPU_SCHEMA.columns.find(
    (column) => column.key === 'accepted',
  );
  const signalDomain = manifest.domains.signalValue ?? { min: 0, max: 1 };
  const signalScale = manifest.columnScales?.signalValue ?? DEFAULT_SIGNAL_SCALE;
  const primary: HistogramParameterSpec[] = [
    {
      categories: (phaseSchema?.categories ?? []).map((category, encoded) => ({
        encoded,
        label: category.label ?? String(category.value),
        order: category.order,
        value: category.value,
      })),
      domain: { min: -0.5, max: 3.5 },
      key: 'phase',
      kind: 'categorical',
      label: phaseSchema?.parameterName ?? 'Process phase',
      sourceTables: [PRIMARY_TABLE],
    },
    {
      categories: (acceptedSchema?.categories ?? []).map((category, encoded) => ({
        encoded,
        label: category.value === false ? 'false' : 'true',
        order: category.order ?? encoded,
        value: category.value,
      })),
      domain: { min: -0.5, max: 1.5 },
      key: 'accepted',
      kind: 'boolean',
      label: acceptedSchema?.parameterName ?? 'Acceptance',
      sourceTables: [PRIMARY_TABLE],
    },
    {
      domain: {
        max: signalDomain.max * signalScale,
        min: signalDomain.min * signalScale,
      },
      key: 'signalValue',
      kind: 'numeric',
      label: 'Signal value',
      sourceTables: [PRIMARY_TABLE],
      unit: 'a.u.',
    },
  ];
  const primaryKeys = new Set(primary.map((parameter) => parameter.key));
  return [
    ...primary.map((parameter) => {
      const secondary = secondaryParameters.find(
        (candidate) => candidate.key === parameter.key,
      );
      return secondary === undefined
        ? parameter
        : {
            ...parameter,
            sourceTables: [
              PRIMARY_TABLE,
              ...(secondary.sourceTables ?? []),
            ],
          };
    }),
    ...secondaryParameters.filter((parameter) => !primaryKeys.has(parameter.key)),
  ];
}

function readPageColumn<T extends Uint8Array | Uint16Array>(
  buffer: ArrayBuffer,
  page: ScatterWebgpuPagedManifestPage,
  key: string,
  Constructor: {
    new(buffer: ArrayBuffer, byteOffset: number, length: number): T;
  },
): T {
  const descriptor = page.columns[key];
  if (descriptor === undefined) {
    throw new Error(`Shared WebGPU dataset page is missing ${key}.`);
  }
  return new Constructor(buffer, descriptor.byteOffset, descriptor.length);
}

function copyValues(
  source: HistogramValueColumn,
  target: HistogramValueColumn,
  targetOffset: number,
): void {
  for (let index = 0; index < source.length; index += 1) {
    const raw = source[index];
    const value = typeof raw === 'number'
      ? raw
      : typeof raw === 'boolean'
        ? raw ? 1 : 0
        : Number(raw);
    (target as Float32Array | Uint8Array | Uint16Array | Uint32Array)[targetOffset + index] =
      Number.isFinite(value) ? value : Number.NaN;
  }
}

function copyColors(
  source: HistogramColumns['color'],
  format: HistogramColumns['colorFormat'],
  target: Uint32Array,
  targetOffset: number,
  count: number,
): void {
  if (source instanceof Uint32Array || format === 'rgba32') {
    for (let index = 0; index < count; index += 1) {
      target[targetOffset + index] = source?.[index] ?? 0x2563_ebff;
    }
    return;
  }
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    target[targetOffset + index] = source === undefined
      ? 0x2563_ebff
      : (
          ((source[offset] ?? 0) << 24) |
          ((source[offset + 1] ?? 0) << 16) |
          ((source[offset + 2] ?? 0) << 8) |
          (source[offset + 3] ?? 255)
        ) >>> 0;
  }
}

function createLazyArray<T>(length: number, getValue: (index: number) => T): readonly T[] {
  return new Proxy({ length }, {
    get(target, property) {
      if (property === 'length') return target.length;
      if (typeof property !== 'string' || !/^\d+$/u.test(property)) return undefined;
      const index = Number(property);
      return index < length ? getValue(index) : undefined;
    },
  }) as unknown as readonly T[];
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Dataset loading was cancelled.', 'AbortError');
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
