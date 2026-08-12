import type {
  HistogramColumns,
  HistogramDatasetAdapterMetadata,
  HistogramParameterSpec,
  HistogramPlotSpec,
} from 'm-charts/m-histogram';
import { adaptMixedTablesForHistogram } from 'm-charts/m-histogram';
import type {
  HistogramWebgpuStreamBatch,
  HistogramWebgpuStreamSource,
} from 'm-charts/m-histogram-webgpu';
import type { FastScatterDataDomain } from 'm-charts/m-scatter';
import {
  createParallelWebgpuBuffers,
  type ParallelAxisDomains,
  type ParallelFastColumns,
  type ParallelFastValueArray,
  type ParallelWebgpuPackedPage,
  type ParallelWebgpuStreamBatch,
} from 'm-charts/m-parallel-webgpu';

import { getHistogramWebgpuRecordColor } from './histogramWebgpuDatasetAdapter.ts';
import {
  decodeParallelPackedStyleRgba,
  getParallelWebgpuDemoAxisSchema,
  type LoadedParallelWebgpuDataset,
} from './parallelWebgpuDatasetAdapter.ts';
import { loadFastPlotMixedTableFixture } from './fastPlotTableSources.ts';
import {
  prepareScatterWebgpuDemoStream,
  type ScatterWebgpuDemoStreamKind,
} from './scatterWebgpuStreaming.ts';

const PRIMARY_TABLE = 'benchmark-primary';
const SIGNAL_SCALE = 0.0025;
const HISTOGRAM_STREAM_BATCH_SIZE = 250_000;
const PARALLEL_STREAM_BATCH_SIZE = 65_536;
const GENERATED_HISTOGRAM_SIGNAL_DOMAIN_BY_COUNT: Readonly<
  Record<number, { max: number; min: number }>
> = {
  1_000_000: { max: 39_461, min: 10_929 },
  10_000_000: { max: 39_468, min: 10_928 },
  25_000_000: { max: 39_472, min: 10_928 },
};

export interface PreparedHistogramWebgpuDemoStream {
  readonly columns: HistogramColumns;
  readonly loadMs: number;
  readonly metadata: HistogramDatasetAdapterMetadata;
  readonly source: HistogramWebgpuStreamSource;
  readonly sourceFormat: string;
  readonly spec: HistogramPlotSpec;
}

export async function prepareHistogramWebgpuDemoStream(options: {
  kind: ScatterWebgpuDemoStreamKind;
  pointCount: number;
  secondaryFixtureUrl?: string;
  signal: AbortSignal;
  startedAt: number;
}): Promise<PreparedHistogramWebgpuDemoStream> {
  const scatterOptions = { ...options, batchSize: HISTOGRAM_STREAM_BATCH_SIZE };
  const prepared = await prepareScatterWebgpuDemoStream(scatterOptions);
  // These exact seeded-generator domains match the stored normal-table demo.
  // Keeping them available before the first page makes streamed bin boundaries
  // stable without scanning or materializing the complete dataset up front.
  const signalScale = options.kind === 'function' ? 1 : SIGNAL_SCALE;
  const primarySpec = createHistogramSpec(
    GENERATED_HISTOGRAM_SIGNAL_DOMAIN_BY_COUNT[prepared.pointCount] ??
      prepared.source.domain?.yByPlot.signal,
    signalScale,
  );
  const secondary = options.secondaryFixtureUrl === undefined
    ? null
    : adaptMixedTablesForHistogram(
        (await loadFastPlotMixedTableFixture(options.secondaryFixtureUrl)).fixture,
      );
  const parameters = [
    ...primarySpec.parameters.map((parameter) => {
      const secondaryParameter = secondary?.spec.parameters.find(
        (candidate) => candidate.key === parameter.key,
      );
      return secondaryParameter === undefined
        ? parameter
        : {
            ...parameter,
            sourceTables: [
              ...(parameter.sourceTables ?? []),
              ...(secondaryParameter.sourceTables ?? []),
            ],
          };
    }),
    ...(secondary?.spec.parameters.filter(
      (parameter) => !primarySpec.parameters.some(
        (primaryParameter) => primaryParameter.key === parameter.key,
      ),
    ) ?? []),
  ];
  const spec: HistogramPlotSpec = {
    mode: 'histogram',
    parameters,
    subplots: parameters.map((parameter) => ({
      id: parameter.key,
      label: parameter.label,
      parameterKey: parameter.key,
    })),
  };
  const convert = (
    batch: Parameters<typeof convertHistogramBatch>[0],
    sourceOffset = 0,
  ) => convertHistogramBatch(batch, spec, sourceOffset, signalScale);
  const batches = createRestartableMappedBatches(
    prepared.source.batches,
    async () => (await prepareScatterWebgpuDemoStream(scatterOptions)).source.batches,
    convert,
  );
  return {
    columns: convert(prepared.firstBatch).columns,
    loadMs: performance.now() - options.startedAt,
    metadata: {
      recordCount: prepared.pointCount,
      tableNames: prepared.tableNames,
      tableRecordCounts: prepared.tableRecordCounts,
    },
    source: {
      batches,
      expectedCount: prepared.pointCount,
      initialCapacity: prepared.firstBatch.columns.x.length,
      spec,
    },
    sourceFormat: `${options.kind}-webgpu-stream`,
    spec,
  };
}

export async function prepareParallelWebgpuDemoStream(options: {
  kind: ScatterWebgpuDemoStreamKind;
  pointCount: number;
  secondaryFixtureUrl?: string;
  signal: AbortSignal;
  startedAt: number;
}): Promise<LoadedParallelWebgpuDataset> {
  const scatterOptions = { ...options, batchSize: PARALLEL_STREAM_BATCH_SIZE };
  const prepared = await prepareScatterWebgpuDemoStream(scatterOptions);
  const tableMode = options.secondaryFixtureUrl === undefined ? 'single' : 'multi';
  const { axes, axisOrder } = getParallelWebgpuDemoAxisSchema(tableMode);
  const domainsByAxis = createParallelDomains(
    prepared.source.domain,
    axisOrder,
    options.kind === 'function' ? 1 : SIGNAL_SCALE,
  );
  const xDomain = prepared.source.domain?.x ?? {
    max: Math.max(1, prepared.pointCount - 1),
    min: 0,
  };
  const convert = (
    batch: Parameters<typeof convertParallelBatch>[0],
    sourceOffset = 0,
  ) => convertParallelBatch(
    batch,
    xDomain,
    axes,
    axisOrder,
    domainsByAxis,
    sourceOffset,
    options.kind === 'function' ? 1 : SIGNAL_SCALE,
  );
  const firstColumns = convert(prepared.firstBatch).columns;
  const batches = createRestartableMappedBatches(
    prepared.source.batches,
    async () => (await prepareScatterWebgpuDemoStream(scatterOptions)).source.batches,
    convert,
  );
  return {
    buffers: createParallelWebgpuBuffers(firstColumns, {
      preparedDomainsByAxis: domainsByAxis,
      trustedEncodedTypedColumns: true,
    }),
    generated: false,
    loadMs: performance.now() - options.startedAt,
    storedBytes: 0,
    streamingSource: {
      batches,
      domainsByAxis,
      expectedCount: prepared.pointCount,
      initialCapacity: prepared.firstBatch.columns.x.length,
      missingValueCountByAxis: Object.fromEntries(axisOrder.map((key) => [
        key,
        key === 'table' || key === 'timestamp' || key === 'timestampNs'
          ? 0
          : prepared.missingValueCountByColumn[key] ?? 0,
      ])),
    },
    tableNames: prepared.tableNames,
    tableRecordCounts: prepared.tableRecordCounts,
  };
}

function createHistogramSpec(
  signalDomain: { max: number; min: number } | undefined,
  signalScale: number,
): HistogramPlotSpec {
  const parameters: HistogramParameterSpec[] = [
    {
      categories: [
        { encoded: 0, label: 'Idle', order: 0, value: 'idle' },
        { encoded: 1, label: 'Ramp', order: 1, value: 'ramp' },
        { encoded: 2, label: 'Steady', order: 2, value: 'steady' },
        { encoded: 3, label: 'Cooldown', order: 3, value: 'cooldown' },
      ],
      domain: { max: 3.5, min: -0.5 },
      key: 'phase',
      kind: 'categorical',
      label: 'Process phase',
      sourceTables: [PRIMARY_TABLE],
    },
    {
      categories: [
        { encoded: 0, label: 'false', order: 0, value: false },
        { encoded: 1, label: 'true', order: 1, value: true },
      ],
      domain: { max: 1.5, min: -0.5 },
      key: 'accepted',
      kind: 'boolean',
      label: 'Acceptance',
      sourceTables: [PRIMARY_TABLE],
    },
    {
      domain: signalDomain === undefined
        ? { max: 110, min: 20 }
        : {
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
  return {
    mode: 'histogram',
    parameters,
    subplots: parameters.map((parameter) => ({
      id: parameter.key,
      label: parameter.label,
      parameterKey: parameter.key,
    })),
  };
}

function convertHistogramBatch(
  batch: {
    readonly columns: {
      readonly ids: readonly string[];
      readonly recordIdentityBySourceIndex?: readonly {
        readonly id: string;
        readonly sourceIndex: number;
        readonly table: string;
      }[];
      readonly tableBySourceIndex?: readonly string[];
      readonly y: Readonly<Record<string, ArrayLike<number>>>;
    };
    readonly packedStyles?: Uint32Array;
  },
  spec: HistogramPlotSpec,
  sourceOffset: number,
  signalScale: number,
): HistogramWebgpuStreamBatch {
  const phase = batch.columns.y.phase as Uint8Array;
  const accepted = batch.columns.y.accepted as Uint8Array;
  const encodedSignal = batch.columns.y.signalValue as Uint16Array;
  const count = phase.length;
  const signalValue = new Float32Array(count);
  const color = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    signalValue[index] = (encodedSignal[index] ?? 0) * signalScale;
    color[index] = getHistogramWebgpuRecordColor(
      phase[index] ?? 0,
      accepted[index] === 1,
      sourceOffset + index,
    );
  }
  const valuesByParameter: Record<string, HistogramColumns['valuesByParameter'][string]> = {
    accepted,
    phase,
    signalValue,
  };
  for (const parameter of spec.parameters) {
    if (valuesByParameter[parameter.key] !== undefined) continue;
    const values = batch.columns.y[parameter.key];
    const copy = new Float32Array(count);
    copy.fill(Number.NaN);
    if (values !== undefined) {
      for (let index = 0; index < count; index += 1) {
        copy[index] = values[index] ?? Number.NaN;
      }
    }
    valuesByParameter[parameter.key] = copy;
  }
  const ids = materializeIds(batch.columns.ids);
  const tableBySourceIndex = Array.from(
    { length: count },
    (_, index) => batch.columns.tableBySourceIndex?.[index] ?? PRIMARY_TABLE,
  );
  return {
    columns: {
      color,
      colorFormat: 'rgba32',
      ids,
      parameters: spec.parameters,
      recordIdentityBySourceIndex: Array.from(
        { length: count },
        (_, index) => batch.columns.recordIdentityBySourceIndex?.[index] ?? {
          id: ids[index] ?? String(sourceOffset + index),
          sourceIndex: sourceOffset + index,
          table: tableBySourceIndex[index] ?? PRIMARY_TABLE,
        },
      ),
      tableBySourceIndex,
      valuesByParameter,
    },
  };
}

function createParallelDomains(
  dataDomain: FastScatterDataDomain | undefined,
  axisOrder: readonly string[],
  signalScale: number,
): ParallelAxisDomains {
  return Object.fromEntries(axisOrder.map((key) => {
    if (key === 'timestamp' || key === 'timestampNs') {
      return [key, { max: 1, min: 0, span: 1 }];
    }
    if (key === 'accepted') return [key, { max: 1.5, min: -0.5, span: 2 }];
    if (key === 'phase') return [key, { max: 3.5, min: -0.5, span: 4 }];
    if (key === 'table') return [key, { max: 1.5, min: -0.5, span: 2 }];
    const range = key === 'signalValue'
      ? dataDomain?.yByPlot.signal
      : dataDomain?.yByPlot[key];
    const min = key === 'signalValue'
      ? (range?.min ?? 20 / signalScale) * signalScale
      : range?.min ?? 0;
    const max = key === 'signalValue'
      ? (range?.max ?? 110 / signalScale) * signalScale
      : range?.max ?? 1;
    return [key, { max, min, span: Math.max(0, max - min) }];
  }));
}

function convertParallelBatch(batch: {
  readonly columns: {
    readonly ids: readonly string[];
    readonly recordIdentityBySourceIndex?: readonly {
      readonly id: string;
      readonly sourceIndex: number;
      readonly table: string;
    }[];
    readonly tableBySourceIndex?: readonly string[];
    readonly x: ArrayLike<number>;
    readonly y: Readonly<Record<string, ArrayLike<number>>>;
  };
  readonly packedStyles?: Uint32Array;
},
xDomain: { max: number; min: number },
axes: ReturnType<typeof getParallelWebgpuDemoAxisSchema>['axes'],
axisOrder: readonly string[],
domainsByAxis: ParallelAxisDomains,
sourceOffset: number,
signalScale: number,
): ParallelWebgpuStreamBatch {
  const phase = batch.columns.y.phase as Uint8Array;
  const accepted = batch.columns.y.accepted as Uint8Array;
  const encodedSignal = batch.columns.y.signalValue as Uint16Array;
  const count = phase.length;
  const timestamp = new Float32Array(count);
  const signalValue = new Float32Array(count);
  const color = new Uint8Array(count * 4);
  const packedPage = createParallelPackedPage(count, sourceOffset, axisOrder.length);
  const denominator = Math.max(1, xDomain.max - xDomain.min);
  const valuesByAxis: Record<string, ParallelFastValueArray> = {
    accepted,
    phase,
    signalValue,
    [axisOrder.includes('timestampNs') ? 'timestampNs' : 'timestamp']: timestamp,
  };
  for (const key of axisOrder) {
    if (valuesByAxis[key] !== undefined) continue;
    if (key === 'table') {
      const table = new Uint8Array(count);
      for (let index = 0; index < count; index += 1) {
        table[index] = batch.columns.tableBySourceIndex?.[index] === PRIMARY_TABLE ? 0 : 1;
      }
      valuesByAxis[key] = table;
      continue;
    }
    const source = batch.columns.y[key];
    if (source === undefined) {
      valuesByAxis[key] = createMissingValues(count);
    } else {
      const values = new Float32Array(count);
      for (let index = 0; index < count; index += 1) {
        values[index] = source[index] ?? Number.NaN;
      }
      valuesByAxis[key] = values;
    }
  }
  for (let index = 0; index < count; index += 1) {
    timestamp[index] = ((batch.columns.x[index] ?? xDomain.min) - xDomain.min) / denominator;
    signalValue[index] = (encodedSignal[index] ?? 0) * signalScale;
    const packedStyle = batch.packedStyles?.[index] ?? 0;
    unpackParallelRgba(
      decodeParallelPackedStyleRgba(packedStyle),
      color,
      index * 4,
    );
    const valueOffset = index * axisOrder.length;
    for (let axisIndex = 0; axisIndex < axisOrder.length; axisIndex += 1) {
      const key = axisOrder[axisIndex]!;
      writeParallelPackedValue(
        packedPage.values,
        valueOffset + axisIndex,
        normalizeParallelPackedValue(
          Number(valuesByAxis[key]?.[index] ?? Number.NaN),
          domainsByAxis[key]!,
        ),
      );
    }
    writeParallelDensityStyle(
      packedPage.densityStyles,
      index,
      packedStyle,
    );
  }
  const ids = materializeIds(batch.columns.ids);
  const columns: ParallelFastColumns = {
    axes,
    axisOrder,
    color,
    colorFormat: 'rgba8',
    ids,
    recordIdentityBySourceIndex: Array.from(
      { length: count },
      (_, index) => batch.columns.recordIdentityBySourceIndex?.[index] ?? {
        id: ids[index] ?? String(sourceOffset + index),
        sourceIndex: sourceOffset + index,
        table: batch.columns.tableBySourceIndex?.[index] ?? PRIMARY_TABLE,
      },
    ),
    tableBySourceIndex: Array.from(
      { length: count },
      (_, index) => batch.columns.tableBySourceIndex?.[index] ?? PRIMARY_TABLE,
    ),
    valuesByAxis,
  };
  return { columns, packedPage };
}

function materializeIds(ids: readonly string[]): string[] {
  return Array.from({ length: ids.length }, (_, index) => ids[index] ?? String(index));
}

function unpackParallelRgba(packed: number, target: Uint8Array, offset: number): void {
  target[offset] = packed & 0xff;
  target[offset + 1] = (packed >>> 8) & 0xff;
  target[offset + 2] = (packed >>> 16) & 0xff;
  target[offset + 3] = (packed >>> 24) & 0xff;
}

function createParallelPackedPage(
  count: number,
  start: number,
  axisCount: number,
): ParallelWebgpuPackedPage {
  return {
    count,
    densityStyles: new Uint32Array(Math.max(1, Math.ceil(count / 2))),
    start,
    values: new Uint32Array(Math.max(1, Math.ceil((count * axisCount) / 2))),
  };
}

function createMissingValues(count: number): Float32Array {
  const values = new Float32Array(count);
  values.fill(Number.NaN);
  return values;
}

function normalizeParallelPackedValue(
  value: number,
  domain: { max: number; min: number; span: number },
): number {
  if (!Number.isFinite(value)) return Number.NaN;
  return domain.span === 0 ? 0.5 : (value - domain.min) / domain.span;
}

function writeParallelPackedValue(
  target: Uint32Array,
  linearIndex: number,
  normalized: number,
): void {
  const quantized = Number.isFinite(normalized)
    ? Math.round(Math.max(0, Math.min(1, normalized)) * 65_534)
    : 65_535;
  const wordIndex = linearIndex >>> 1;
  const shift = (linearIndex & 1) * 16;
  target[wordIndex] = (target[wordIndex]! | (quantized << shift)) >>> 0;
}

function writeParallelDensityStyle(
  target: Uint32Array,
  index: number,
  packed: number,
): void {
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
  target[wordIndex] = index % 2 === 0
    ? rgba4444
    : (target[wordIndex]! | (rgba4444 << 16)) >>> 0;
}

function mapBatches<
  TInput extends { readonly columns: { readonly ids: readonly unknown[] } },
  TOutput,
>(
  source: AsyncIterable<TInput>,
  convert: (batch: TInput, sourceOffset: number) => TOutput,
): AsyncIterable<TOutput> {
  return {
    async *[Symbol.asyncIterator]() {
      let sourceOffset = 0;
      for await (const batch of source) {
        yield convert(batch, sourceOffset);
        sourceOffset += batch.columns.ids.length;
      }
    },
  };
}

function createRestartableMappedBatches<
  TInput extends { readonly columns: { readonly ids: readonly unknown[] } },
  TOutput,
>(
  initial: AsyncIterable<TInput>,
  recreate: () => Promise<AsyncIterable<TInput>>,
  convert: (batch: TInput, sourceOffset: number) => TOutput,
): AsyncIterable<TOutput> {
  let claimed = false;
  return {
    async *[Symbol.asyncIterator]() {
      const source = claimed ? await recreate() : initial;
      claimed = true;
      yield* mapBatches(source, convert);
    },
  };
}
