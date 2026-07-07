import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';

import {
  MIXED_TABLE_AXES,
  MIXED_TABLE_COLUMNS,
  MIXED_TABLE_NAMES,
  MIXED_TABLE_STYLE_METADATA,
  type MixedTableFixtureMetadata,
  type MixedTableRecord,
} from '../apps/demo/src/data/mixedTableFixtures.ts';
import {
  PARALLEL_PARAMETERS,
  SCATTER_CATEGORIES,
  SCATTER_SHAPES,
  SCATTER_STYLE_GROUPS,
  SCATTER_STYLE_LIMITS,
  SCATTER_Y_ATTRIBUTES,
  type ParallelDatasetMetadata,
  type ParallelRecord,
  type ScatterDatasetMetadata,
  type ScatterShape,
  type ScatterRecord,
  type ScatterStyleGroup,
} from '../apps/demo/src/data/types.ts';
import type { FastScatterDatasetSchema } from 'm-charts/m-scatter';

type DatasetKind = 'scatter' | 'scatter-fast' | 'parallel' | 'mixed-tables' | 'histogram-bars';

interface GeneratorOptions {
  columnarOut?: string;
  count: number;
  kind: DatasetKind;
  schemaOut?: string;
  secondaryCount: number;
  seed: number;
  out: string;
}

const DEFAULT_OPTIONS: GeneratorOptions = {
  count: 1_000_000,
  kind: 'scatter',
  secondaryCount: 1_000,
  seed: 1,
  out: 'apps/demo/public/data/scatter-sample.json',
};

const PARALLEL_DEFAULT_COUNT = 100_000;
const PARALLEL_DEFAULT_OUT = 'apps/demo/public/data/parallel-sample.json';
const SCATTER_FAST_DEFAULT_OUT = 'apps/demo/public/data/scatter-fast-sample.json';
const SCATTER_FAST_DEFAULT_SCHEMA_OUT = 'apps/demo/public/data/scatter-fast-schema.json';
const MIXED_TABLES_DEFAULT_OUT = 'apps/demo/public/data/mixed-table-fixture.json';
const MIXED_TABLES_DEFAULT_COUNT = 1_000_000;
const MIXED_TABLES_DEFAULT_SECONDARY_COUNT = 1_000;
const HISTOGRAM_BARS_DEFAULT_OUT = 'apps/demo/public/data/histogram-bars-sample.json';
const HISTOGRAM_BARS_DEFAULT_COUNT = 48;

const USAGE = `Usage: pnpm generate:data -- [--kind scatter|scatter-fast|parallel|mixed-tables|histogram-bars] [--count <records-or-bars>] [--secondary-count <records>] [--seed <integer>] [--out <path>] [--schema-out <path>] [--columnar-out <path>]

Defaults:
  --kind ${DEFAULT_OPTIONS.kind}
  --count ${DEFAULT_OPTIONS.count}
  --seed ${DEFAULT_OPTIONS.seed}
  --out ${DEFAULT_OPTIONS.out}

Parallel defaults when --kind parallel is set without explicit --count/--out:
  --count ${PARALLEL_DEFAULT_COUNT}
  --out ${PARALLEL_DEFAULT_OUT}

Scatter-fast defaults when --kind scatter-fast is set without explicit --out/schema-out:
  --out ${SCATTER_FAST_DEFAULT_OUT}
  --schema-out ${SCATTER_FAST_DEFAULT_SCHEMA_OUT}
  --columnar-out ${deriveColumnarManifestPath(SCATTER_FAST_DEFAULT_OUT)}

Mixed-table defaults when --kind mixed-tables is set without explicit --count/out:
  --count ${MIXED_TABLES_DEFAULT_COUNT} primary records
  --secondary-count ${MIXED_TABLES_DEFAULT_SECONDARY_COUNT} secondary records
  --out ${MIXED_TABLES_DEFAULT_OUT}

Histogram bar-mode defaults when --kind histogram-bars is set without explicit --count/out:
  --count ${HISTOGRAM_BARS_DEFAULT_COUNT} bars per parameter
  --out ${HISTOGRAM_BARS_DEFAULT_OUT}
`;

function parseArgs(argv: string[]): GeneratorOptions {
  const options = { ...DEFAULT_OPTIONS };
  let countWasProvided = false;
  let outWasProvided = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    }

    const [flag, inlineValue] = arg.split('=', 2);
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined) {
      index += 1;
    }

    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}.\n\n${USAGE}`);
    }

    switch (flag) {
      case '--kind':
        options.kind = parseKind(value);
        if (options.kind === 'parallel') {
          if (!countWasProvided) {
            options.count = PARALLEL_DEFAULT_COUNT;
          }
          if (!outWasProvided) {
            options.out = PARALLEL_DEFAULT_OUT;
          }
        } else if (options.kind === 'scatter-fast') {
          if (!countWasProvided) {
            options.count = DEFAULT_OPTIONS.count;
          }
          if (!outWasProvided) {
            options.out = SCATTER_FAST_DEFAULT_OUT;
          }
          options.schemaOut ??= SCATTER_FAST_DEFAULT_SCHEMA_OUT;
        } else if (options.kind === 'mixed-tables') {
          if (!countWasProvided) {
            options.count = MIXED_TABLES_DEFAULT_COUNT;
          }
          if (!outWasProvided) {
            options.out = MIXED_TABLES_DEFAULT_OUT;
          }
        } else if (options.kind === 'histogram-bars') {
          if (!countWasProvided) {
            options.count = HISTOGRAM_BARS_DEFAULT_COUNT;
          }
          if (!outWasProvided) {
            options.out = HISTOGRAM_BARS_DEFAULT_OUT;
          }
        } else {
          if (!countWasProvided) {
            options.count = DEFAULT_OPTIONS.count;
          }
          if (!outWasProvided) {
            options.out = DEFAULT_OPTIONS.out;
          }
        }
        break;
      case '--count':
        options.count = parseCount(value);
        countWasProvided = true;
        break;
      case '--secondary-count':
        options.secondaryCount = parseCount(value);
        break;
      case '--seed':
        options.seed = parseSeed(value);
        break;
      case '--out':
        options.out = value;
        outWasProvided = true;
        break;
      case '--schema-out':
        options.schemaOut = value;
        break;
      case '--columnar-out':
        options.columnarOut = value;
        break;
      default:
        throw new Error(`Unknown option: ${flag}.\n\n${USAGE}`);
    }
  }

  return options;
}

function parseKind(value: string): DatasetKind {
  if (
    value === 'scatter' ||
    value === 'scatter-fast' ||
    value === 'parallel' ||
    value === 'mixed-tables' ||
    value === 'histogram-bars'
  ) {
    return value;
  }

  throw new Error(
    `--kind must be "scatter", "scatter-fast", "parallel", "mixed-tables", or "histogram-bars". Received: ${value}`,
  );
}

function parseCount(value: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`--count must be a non-negative safe integer. Received: ${value}`);
  }

  return parsed;
}

function parseSeed(value: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--seed must be a safe integer. Received: ${value}`);
  }

  return parsed;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function deterministicCreatedAt(seed: number, count: number): string {
  const baseTimeMs = Date.UTC(2024, 0, 1, 0, 0, 0, 0);
  const oneYearMs = 366 * 24 * 60 * 60 * 1000;
  const seedBits = seed >>> 0;
  const countBits = count >>> 0;
  const mixed = Math.imul(seedBits ^ 0x9e3779b9, 2_654_435_761) ^ countBits;
  const offsetMs = (mixed >>> 0) % oneYearMs;

  return new Date(baseTimeMs + offsetMs).toISOString();
}

function createMetadata(options: GeneratorOptions): ScatterDatasetMetadata {
  return {
    count: options.count,
    seed: options.seed,
    createdAt: deterministicCreatedAt(options.seed, options.count),
    attributes: {
      id: 'id',
      x: 'x',
      y: SCATTER_Y_ATTRIBUTES,
      category: 'category',
      styleGroup: 'styleGroup',
      color: 'color',
      opacity: 'opacity',
      rotation: 'rotation',
      size: 'size',
      shape: 'shape',
    },
    categories: SCATTER_CATEGORIES,
    styleGroups: SCATTER_STYLE_GROUPS,
    styles: {
      color: {
        attribute: 'color',
        format: '#RRGGBB',
      },
      opacity: {
        attribute: 'opacity',
        max: SCATTER_STYLE_LIMITS.opacity.max,
        min: SCATTER_STYLE_LIMITS.opacity.min,
      },
      rotation: {
        attribute: 'rotation',
        max: SCATTER_STYLE_LIMITS.rotation.max,
        min: SCATTER_STYLE_LIMITS.rotation.min,
        nullable: true,
        unit: SCATTER_STYLE_LIMITS.rotation.unit,
      },
      size: {
        attribute: 'size',
        max: SCATTER_STYLE_LIMITS.size.max,
        min: SCATTER_STYLE_LIMITS.size.min,
        unit: SCATTER_STYLE_LIMITS.size.unit,
      },
      shape: {
        attribute: 'shape',
        values: SCATTER_SHAPES,
      },
    },
  };
}

function createParallelMetadata(options: GeneratorOptions): ParallelDatasetMetadata {
  return {
    count: options.count,
    seed: options.seed,
    createdAt: deterministicCreatedAt(options.seed, options.count),
    attributes: {
      id: 'id',
      parameters: PARALLEL_PARAMETERS,
    },
  };
}

function createMixedTableMetadata(
  options: GeneratorOptions,
  tableCounts: readonly number[],
): MixedTableFixtureMetadata {
  const totalCount = tableCounts.reduce((sum, count) => sum + count, 0);
  return {
    axes: MIXED_TABLE_AXES,
    columns: MIXED_TABLE_COLUMNS,
    count: totalCount,
    createdAt: deterministicCreatedAt(options.seed, totalCount),
    seed: options.seed,
    styles: MIXED_TABLE_STYLE_METADATA,
    tableNames: MIXED_TABLE_NAMES,
    tables: MIXED_TABLE_NAMES.map((name, index) => ({
      count: tableCounts[index] ?? 0,
      name,
    })),
    version: 1,
  };
}

interface HistogramBarsPayload {
  metadata: {
    barsPerParameter: number;
    createdAt: string;
    seed: number;
    version: 1;
  };
  parameters: HistogramBarsParameter[];
  source: string;
}

interface HistogramBarsParameter {
  bins: HistogramBarsBin[];
  key: string;
  label: string;
  source: string;
  table: string;
  unit: string;
}

interface HistogramBarsBin {
  colorCounts?: Record<string, number>;
  count: number;
  max: number;
  min: number;
}

const HISTOGRAM_BAR_PARAMETERS = [
  {
    amplitude: 0.52,
    baseCount: 840,
    key: 'latencyMs',
    label: 'Latency',
    max: 240,
    min: 0,
    period: 2.4,
    source: 'search-aggregation:latencyMs',
    stacked: true,
    table: 'benchmark-primary',
    unit: 'ms',
  },
  {
    amplitude: 0.34,
    baseCount: 520,
    key: 'signalValue',
    label: 'Signal value',
    max: 160,
    min: 0,
    period: 3.2,
    source: 'search-aggregation:signalValue',
    stacked: false,
    table: 'benchmark-primary',
    unit: 'a.u.',
  },
  {
    amplitude: 0.46,
    baseCount: 360,
    key: 'secondarySignal',
    label: 'Secondary signal',
    max: 120,
    min: 0,
    period: 2.9,
    source: 'search-aggregation:secondarySignal',
    stacked: true,
    table: 'benchmark-secondary',
    unit: 'a.u.',
  },
] as const;

const HISTOGRAM_STACK_COLORS = ['#059669', '#2563EB', '#D97706', '#DC2626'] as const;

function createHistogramBarsPayload(options: GeneratorOptions): HistogramBarsPayload {
  const random = createRandom(options.seed);
  const barsPerParameter = options.count;

  return {
    metadata: {
      barsPerParameter,
      createdAt: deterministicCreatedAt(options.seed, barsPerParameter),
      seed: options.seed,
      version: 1,
    },
    parameters: HISTOGRAM_BAR_PARAMETERS.map((parameter, parameterIndex) => ({
      bins: createHistogramBarBins(parameter, parameterIndex, barsPerParameter, random),
      key: parameter.key,
      label: parameter.label,
      source: parameter.source,
      table: parameter.table,
      unit: parameter.unit,
    })),
    source: 'generated-histogram-bars',
  };
}

function createHistogramBarBins(
  parameter: (typeof HISTOGRAM_BAR_PARAMETERS)[number],
  parameterIndex: number,
  count: number,
  random: () => number,
): HistogramBarsBin[] {
  const bins: HistogramBarsBin[] = [];
  const width = count > 0 ? (parameter.max - parameter.min) / count : 1;

  for (let binIndex = 0; binIndex < count; binIndex += 1) {
    const progress = count > 1 ? binIndex / (count - 1) : 0.5;
    const peak = Math.exp(-((progress - 0.58) ** 2) / 0.055);
    const shoulder = Math.exp(-((progress - 0.22) ** 2) / 0.018) * 0.42;
    const wave = Math.sin((progress * Math.PI * 2 + parameterIndex * 0.7) * parameter.period);
    const jitter = (random() - 0.5) * parameter.baseCount * 0.09;
    const rawCount = parameter.baseCount *
      (0.18 + peak * parameter.amplitude + shoulder + wave * 0.08) +
      jitter;
    const binCount = Math.max(0, Math.round(rawCount));
    const min = round(parameter.min + width * binIndex, 6);
    const max = round(binIndex === count - 1 ? parameter.max : parameter.min + width * (binIndex + 1), 6);
    const colorCounts = parameter.stacked
      ? createHistogramBarColorCounts(binCount, binIndex, parameterIndex, random)
      : undefined;

    bins.push({
      ...(colorCounts === undefined ? {} : { colorCounts }),
      count: binCount,
      max,
      min,
    });
  }

  return bins;
}

function createHistogramBarColorCounts(
  count: number,
  binIndex: number,
  parameterIndex: number,
  random: () => number,
): Record<string, number> {
  const rawWeights = HISTOGRAM_STACK_COLORS.map((_, colorIndex) => {
    const wave = Math.sin((binIndex + 1) * (colorIndex + 2) * 0.27 + parameterIndex);
    return 0.2 + colorIndex * 0.08 + Math.max(0, wave) * 0.42 + random() * 0.12;
  });
  const weightSum = rawWeights.reduce((sum, weight) => sum + weight, 0);
  let remaining = count;

  return Object.fromEntries(
    HISTOGRAM_STACK_COLORS.map((color, colorIndex) => {
      const segmentCount =
        colorIndex === HISTOGRAM_STACK_COLORS.length - 1
          ? remaining
          : Math.min(remaining, Math.round((count * rawWeights[colorIndex]!) / weightSum));
      remaining -= segmentCount;

      return [color, segmentCount];
    }),
  );
}

function createRecord(
  index: number,
  count: number,
  random: () => number,
  idWidth: number,
): ScatterRecord {
  const progress = count > 1 ? index / (count - 1) : 0;
  const t = progress * Math.PI * 28;
  const xJitter = index === 0 || index === count - 1 ? 0 : (random() - 0.5) * 0.35;
  const x = round(index + xJitter, 6);

  const anomalyRoll = random();
  const baseCategoryIndex = Math.floor(progress * 9 + random() * 2) % 3;
  const category =
    anomalyRoll > 0.985 ? SCATTER_CATEGORIES[3] : SCATTER_CATEGORIES[baseCategoryIndex];
  const styleOffset = category === 'anomaly' ? 3 : baseCategoryIndex;
  const styleGroup =
    SCATTER_STYLE_GROUPS[(index * 7 + styleOffset + Math.floor(random() * 3)) % SCATTER_STYLE_GROUPS.length];
  const pointStyle = createPointStyle(index, baseCategoryIndex, styleGroup, category === 'anomaly');

  const clusterOffset = (baseCategoryIndex - 1) * 8;
  const longTrend = (progress - 0.5) * 30;
  const pulse = Math.sin(t * 0.17 + baseCategoryIndex) * 9;
  const aNoise = (random() - 0.5) * 7;
  const bNoise = (random() - 0.5) * 5;
  const cNoise = (random() - 0.5) * 6;
  const anomalyBoost = category === 'anomaly' ? 26 + random() * 18 : 0;

  const a = Math.sin(t) * 32 + Math.cos(t * 0.23) * 12 + longTrend + clusterOffset + aNoise + anomalyBoost;
  const b = a * 0.45 + Math.cos(t * 0.74) * 24 - longTrend * 0.2 + bNoise - anomalyBoost * 0.35;
  const c = (a - b) * 0.35 + Math.sin(t * 1.31) * 18 + pulse + cNoise + anomalyBoost * 0.2;
  const rotation = createPointRotation(index, a, b, c, category === 'anomaly');
  const rangeSample = createStyleRangeSample(index, count);

  return {
    id: `pt-${String(index).padStart(idWidth, '0')}`,
    x,
    a: round(a, 4),
    b: round(b, 4),
    c: round(c, 4),
    category,
    styleGroup,
    color: pointStyle.color,
    opacity: rangeSample?.opacity ?? pointStyle.opacity,
    rotation: rangeSample?.rotation ?? rotation,
    size: rangeSample?.size ?? pointStyle.size,
    shape: pointStyle.shape,
  };
}

function createParallelRecord(
  index: number,
  count: number,
  random: () => number,
  idWidth: number,
): ParallelRecord {
  const progress = count > 1 ? index / (count - 1) : 0;
  const t = progress * Math.PI * 18;
  const workloadBand = index % 5;
  const spike = random() > 0.985 ? 1 : 0;

  const throughput =
    340 +
    workloadBand * 58 +
    Math.sin(t) * 42 +
    Math.cos(t * 0.13) * 24 +
    (random() - 0.5) * 34 -
    spike * 120;
  const latency =
    94 -
    throughput * 0.08 +
    workloadBand * 6 +
    Math.sin(t * 0.7 + workloadBand) * 12 +
    random() * 18 +
    spike * 45;
  const errorRate =
    0.15 +
    workloadBand * 0.08 +
    Math.max(0, latency - 72) * 0.018 +
    random() * 0.45 +
    spike * 2.2;
  const cpuLoad =
    38 +
    throughput * 0.075 +
    Math.sin(t * 1.4) * 9 +
    (random() - 0.5) * 10 +
    spike * 13;
  const memoryUsage =
    46 +
    workloadBand * 7 +
    progress * 26 +
    Math.cos(t * 0.41) * 8 +
    random() * 9 +
    spike * 11;

  return {
    id: `pc-${String(index).padStart(idWidth, '0')}`,
    throughput: round(clamp(throughput, 50, 950), 3),
    latency: round(clamp(latency, 2, 220), 3),
    errorRate: round(clamp(errorRate, 0, 8), 4),
    cpuLoad: round(clamp(cpuLoad, 0, 100), 3),
    memoryUsage: round(clamp(memoryUsage, 0, 100), 3),
  };
}

interface ScatterFastRecord {
  id: string;
  timestampNs: string;
  phase: 'idle' | 'ramp' | 'steady' | 'cooldown';
  accepted: boolean;
  signalValue: number;
  color: string;
  opacity: number;
  rotation: number;
  size: number;
  shape: ScatterShape;
}

interface ScatterFastColumnarBuilder {
  accepted: Float64Array;
  color: Uint8Array;
  idPrefix: string;
  idWidth: number;
  opacity: Float32Array;
  phase: Float64Array;
  rotationDegrees: Float32Array;
  rotationRadians: Float32Array;
  shape: Uint8Array;
  signalValue: Float64Array;
  size: Float32Array;
  sourceIndex: Uint32Array;
  timestampNs: BigInt64Array;
  timestampOriginNs: bigint | null;
  x: Float64Array;
}

const SCATTER_FAST_OVERLAP_BLOCK_SIZE = 24;
const SCATTER_FAST_OVERLAP_GROUPS = [
  { anchorOffset: 2, size: 3 },
  { anchorOffset: 14, size: 2 },
] as const;

function createScatterFastSchema(): FastScatterDatasetSchema {
  return {
    version: 1,
    columns: [
      { key: 'id', role: 'id' },
      {
        axisType: 'datetime-ns',
        key: 'timestampNs',
        parameterName: 'Timestamp',
        role: 'x',
        unit: 'UTC',
      },
      {
        axisType: 'categorical',
        categories: [
          { label: 'Idle', order: 0, value: 'idle' },
          { label: 'Ramp', order: 1, value: 'ramp' },
          { label: 'Steady', order: 2, value: 'steady' },
          { label: 'Cooldown', order: 3, value: 'cooldown' },
        ],
        key: 'phase',
        parameterName: 'Process phase',
        role: 'y',
      },
      {
        axisType: 'boolean',
        categories: [
          { label: 'Rejected', value: false },
          { label: 'Accepted', value: true },
        ],
        key: 'accepted',
        parameterName: 'Acceptance',
        role: 'y',
      },
      {
        axisType: 'numeric',
        key: 'signalValue',
        parameterName: 'Signal value',
        role: 'y',
        unit: 'a.u.',
      },
      { key: 'color', role: 'style' },
      { key: 'opacity', role: 'style' },
      { key: 'rotation', role: 'style', unit: 'deg' },
      { key: 'size', role: 'style', unit: 'px' },
      { key: 'shape', role: 'style' },
    ],
    plots: [
      { id: 'phase', y: { column: 'phase' } },
      { id: 'accepted', y: { column: 'accepted' } },
      { id: 'signal', y: { column: 'signalValue' } },
    ],
    x: { column: 'timestampNs' },
  };
}

function createScatterFastRecord(
  index: number,
  count: number,
  random: () => number,
  idWidth: number,
): ScatterFastRecord {
  const progress = count > 1 ? index / (count - 1) : 0;
  const basePhase = progress < 0.18
    ? 'idle'
    : progress < 0.42
      ? 'ramp'
      : progress < 0.82
        ? 'steady'
        : 'cooldown';
  const accepted = basePhase === 'steady' ? random() > 0.08 : random() > 0.22;
  const wave = Math.sin(progress * Math.PI * 18);
  const signalValue =
    42 +
    progress * 28 +
    wave * 9 +
    (accepted ? -4 : 18) +
    (random() - 0.5) * 8;
  const baseNs = 1_717_200_000_000_000_000n;
  const stepNs = 250_000_000n;
  const jitterNs = BigInt(Math.floor(random() * 40_000_000));
  const overlapProfile = createScatterFastOverlapProfile(index, count);
  const phase = overlapProfile?.phase ?? basePhase;
  const phaseIndex = { cooldown: 3, idle: 0, ramp: 1, steady: 2 }[phase];
  const finalAccepted = overlapProfile?.accepted ?? accepted;
  const finalSignalValue = overlapProfile?.signalValue ?? round(clamp(signalValue, 1, 160), 3);
  const timestampNs =
    overlapProfile?.timestampNs ?? (baseNs + BigInt(index) * stepNs + jitterNs).toString();
  const phaseColor = {
    cooldown: '#7C3AED',
    idle: '#64748B',
    ramp: '#2563EB',
    steady: '#059669',
  }[phase];
  const rejectedColor = index % 2 === 0 ? '#DC2626' : '#EA580C';
  const size = 3.25 + (index % 4) * 0.55 + (finalAccepted ? 0 : 1.25);
  const opacity = 0.56 + (index % 5) * 0.07 + (finalAccepted ? 0 : 0.16);
  const shape =
    SCATTER_SHAPES[(index + phaseIndex + (finalAccepted ? 0 : 2)) % SCATTER_SHAPES.length];
  const rangeSample = createStyleRangeSample(index, count);

  return {
    accepted: finalAccepted,
    color: finalAccepted ? phaseColor : rejectedColor,
    id: `sf-${String(index).padStart(idWidth, '0')}`,
    signalValue: finalSignalValue,
    opacity: rangeSample?.opacity ?? round(clamp(opacity, 0.42, 0.94), 2),
    phase,
    rotation: rangeSample?.rotation ?? round((index * 13) % 360, 1),
    shape,
    size: rangeSample?.size ?? round(clamp(size, 3, 6.5), 2),
    timestampNs,
  };
}

function createScatterFastOverlapProfile(
  index: number,
  count: number,
):
  | {
      accepted: boolean;
      phase: ScatterFastRecord['phase'];
      signalValue: number;
      timestampNs: string;
    }
  | null {
  const overlapAnchorIndex = getScatterFastOverlapAnchorIndex(index, count);
  if (overlapAnchorIndex === null) {
    return null;
  }

  const progress = count > 1 ? overlapAnchorIndex / (count - 1) : 0;
  const phase = progress < 0.18
    ? 'idle'
    : progress < 0.42
      ? 'ramp'
      : progress < 0.82
        ? 'steady'
        : 'cooldown';
  const acceptanceCode = (overlapAnchorIndex * 17 + count * 11) % (phase === 'steady' ? 13 : 9);
  const accepted = phase === 'steady' ? acceptanceCode !== 0 : acceptanceCode > 1;
  const wave = Math.sin(progress * Math.PI * 18);
  const modulation = Math.cos(overlapAnchorIndex * 0.41) * 2.75 + ((overlapAnchorIndex % 5) - 2) * 0.35;
  const signalValue = round(
    clamp(42 + progress * 28 + wave * 9 + (accepted ? -4 : 18) + modulation, 1, 160),
    3,
  );
  const baseNs = 1_717_200_000_000_000_000n;
  const stepNs = 250_000_000n;
  const jitterNs = BigInt((overlapAnchorIndex * 17 + count * 29) % 40_000_000);

  return {
    accepted,
    phase,
    signalValue,
    timestampNs: (baseNs + BigInt(overlapAnchorIndex) * stepNs + jitterNs).toString(),
  };
}

function getScatterFastOverlapAnchorIndex(index: number, count: number): number | null {
  if (count < 3) {
    return null;
  }

  const blockStart = Math.floor(index / SCATTER_FAST_OVERLAP_BLOCK_SIZE) *
    SCATTER_FAST_OVERLAP_BLOCK_SIZE;
  const offset = index - blockStart;

  for (const group of SCATTER_FAST_OVERLAP_GROUPS) {
    const anchorIndex = blockStart + group.anchorOffset;
    if (anchorIndex >= count) {
      continue;
    }
    if (offset >= group.anchorOffset && offset < group.anchorOffset + group.size) {
      return anchorIndex;
    }
  }

  return null;
}

function createMixedTableRecord(
  tableName: (typeof MIXED_TABLE_NAMES)[number],
  tableIndex: number,
  localIndex: number,
  tableCount: number,
  globalIndex: number,
  random: () => number,
  idWidth: number,
): MixedTableRecord {
  const baseRecord = createScatterFastRecord(localIndex, tableCount, random, idWidth);

  return {
    ...baseRecord,
    id: `${tableIndex === 0 ? 'sf' : 'sf-b'}-${String(localIndex).padStart(idWidth, '0')}`,
    ...(tableIndex === 1
      ? {
          secondaryDrift: round(
            clamp(baseRecord.signalValue * 0.18 + Math.cos(globalIndex * 0.11) * 7, 0, 80),
            3,
          ),
          secondarySignal: round(
            clamp(baseRecord.signalValue * 0.72 + Math.sin(globalIndex * 0.17) * 12, 0, 160),
            3,
          ),
        }
      : {}),
    table: tableName,
  };
}

function createScatterFastColumnarBuilder(
  count: number,
  idWidth: number,
): ScatterFastColumnarBuilder {
  return {
    accepted: new Float64Array(count),
    color: new Uint8Array(count * 4),
    idPrefix: 'sf-',
    idWidth,
    opacity: new Float32Array(count),
    phase: new Float64Array(count),
    rotationDegrees: new Float32Array(count),
    rotationRadians: new Float32Array(count),
    shape: new Uint8Array(count),
    signalValue: new Float64Array(count),
    size: new Float32Array(count),
    sourceIndex: new Uint32Array(count),
    timestampNs: new BigInt64Array(count),
    timestampOriginNs: null,
    x: new Float64Array(count),
  };
}

function appendScatterFastColumnarRecord(
  builder: ScatterFastColumnarBuilder,
  index: number,
  record: ScatterFastRecord,
): void {
  const timestampNs = BigInt(record.timestampNs);
  const origin = builder.timestampOriginNs ?? timestampNs;
  builder.timestampOriginNs = origin;
  builder.timestampNs[index] = timestampNs;
  builder.x[index] = Number(timestampNs - origin) / 1_000_000;
  builder.phase[index] = phaseToCode(record.phase);
  builder.accepted[index] = record.accepted ? 1 : 0;
  builder.signalValue[index] = record.signalValue;
  writeHexColor(builder.color, index, record.color);
  builder.opacity[index] = record.opacity;
  builder.rotationDegrees[index] = normalizeDegrees(record.rotation);
  builder.rotationRadians[index] = normalizeRadians((record.rotation * Math.PI) / 180);
  builder.size[index] = record.size;
  builder.shape[index] = shapeToCode(record.shape);
  builder.sourceIndex[index] = index;
}

function phaseToCode(phase: ScatterFastRecord['phase']): number {
  switch (phase) {
    case 'idle':
      return 0;
    case 'ramp':
      return 1;
    case 'steady':
      return 2;
    case 'cooldown':
      return 3;
  }
}

function shapeToCode(shape: ScatterShape): number {
  switch (shape) {
    case 'circle':
      return 0;
    case 'rectangle':
      return 1;
    case 'triangle':
      return 2;
    case 'pin':
      return 3;
    case 'arrow':
      return 4;
  }
}

function writeHexColor(target: Uint8Array, index: number, color: string): void {
  const normalized = color.startsWith('#') ? color.slice(1) : color;
  const value = Number.parseInt(normalized, 16);
  const offset = index * 4;

  target[offset] = (value >>> 16) & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = value & 0xff;
  target[offset + 3] = 0xff;
}

const CATEGORY_COLORS = ['#2563EB', '#059669', '#D97706', '#DC2626'] as const;

const STYLE_GROUP_OPACITY: Record<ScatterStyleGroup, number> = {
  accent: 0.82,
  default: 0.72,
  highlight: 0.95,
  large: 0.88,
  'low-opacity': 0.35,
  muted: 0.55,
};

const STYLE_GROUP_SIZE: Record<ScatterStyleGroup, number> = {
  accent: 4,
  default: 3,
  highlight: 5,
  large: 7,
  'low-opacity': 3,
  muted: 2.5,
};

interface PointStyle {
  color: string;
  opacity: number;
  shape: ScatterShape;
  size: number;
}

interface StyleRangeSample {
  opacity: number;
  rotation: number;
  size: number;
}

function createPointStyle(
  index: number,
  categoryIndex: number,
  styleGroup: ScatterStyleGroup,
  isAnomaly: boolean,
): PointStyle {
  const color = isAnomaly
    ? CATEGORY_COLORS[3]
    : CATEGORY_COLORS[(categoryIndex + index) % 3];
  const opacity = clamp(
    STYLE_GROUP_OPACITY[styleGroup] + ((index % 4) - 1) * 0.04 + (isAnomaly ? 0.08 : 0),
    SCATTER_STYLE_LIMITS.opacity.min,
    SCATTER_STYLE_LIMITS.opacity.max,
  );
  const size = clamp(
    STYLE_GROUP_SIZE[styleGroup] + (index % 3) * 0.5 + (isAnomaly ? 1 : 0),
    SCATTER_STYLE_LIMITS.size.min,
    SCATTER_STYLE_LIMITS.size.max,
  );
  const shape = SCATTER_SHAPES[(index + categoryIndex) % SCATTER_SHAPES.length];

  return {
    color,
    opacity: round(opacity, 2),
    shape,
    size: round(size, 2),
  };
}

function createPointRotation(
  index: number,
  a: number,
  b: number,
  c: number,
  isAnomaly: boolean,
): number {
  const signalAngle = (Math.atan2(b - a, c - b) * 180) / Math.PI;
  const anomalyOffset = isAnomaly ? 37 : 0;

  return round(normalizeDegrees(signalAngle + index * 11 + anomalyOffset), 1);
}

function createStyleRangeSample(
  index: number,
  count: number,
): StyleRangeSample | undefined {
  if (count < 3) {
    return undefined;
  }

  if (index === 0) {
    return {
      opacity: SCATTER_STYLE_LIMITS.opacity.min,
      rotation: SCATTER_STYLE_LIMITS.rotation.min,
      size: SCATTER_STYLE_LIMITS.size.min,
    };
  }

  if (index === Math.floor((count - 1) / 2)) {
    return {
      opacity: midpoint(SCATTER_STYLE_LIMITS.opacity),
      rotation: midpoint(SCATTER_STYLE_LIMITS.rotation),
      size: midpoint(SCATTER_STYLE_LIMITS.size),
    };
  }

  if (index === count - 1) {
    return {
      opacity: SCATTER_STYLE_LIMITS.opacity.max,
      rotation: SCATTER_STYLE_LIMITS.rotation.max,
      size: SCATTER_STYLE_LIMITS.size.max,
    };
  }

  return undefined;
}

function midpoint(range: { max: number; min: number }): number {
  return (range.min + range.max) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeDegrees(value: number): number {
  const normalized = value % 360;

  return normalized < 0 ? normalized + 360 : normalized;
}

function normalizeRadians(value: number): number {
  const fullTurn = Math.PI * 2;
  const normalized = value % fullTurn;

  return normalized < 0 ? normalized + fullTurn : normalized;
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

async function writeChunk(
  stream: NodeJS.WritableStream,
  chunk: string | Uint8Array,
): Promise<void> {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
}

async function writeDataset(options: GeneratorOptions): Promise<void> {
  const outPath = resolve(options.out);
  await mkdir(dirname(outPath), { recursive: true });

  if (options.kind === 'histogram-bars') {
    await writeHistogramBarsDataset(options, outPath);
    return;
  }

  if (options.kind === 'mixed-tables') {
    await writeMixedTableDataset(options, outPath);
    return;
  }

  if (options.kind === 'scatter-fast') {
    await writeScatterFastSchema(options);
  }

  const random = createRandom(options.seed);
  const idWidth = Math.max(6, String(Math.max(0, options.count - 1)).length);
  const scatterFastColumnar =
    options.kind === 'scatter-fast'
      ? createScatterFastColumnarBuilder(options.count, idWidth)
      : null;
  const metadata =
    options.kind === 'parallel' ? createParallelMetadata(options) : createMetadata(options);
  const stream = createWriteStream(outPath, { encoding: 'utf8' });
  const finishedWriting = finished(stream);

  await writeChunk(stream, '{\n  "metadata": ');
  await writeChunk(stream, JSON.stringify(metadata, null, 2).replaceAll('\n', '\n  '));
  await writeChunk(stream, ',\n  "records": [\n');

  for (let index = 0; index < options.count; index += 1) {
    const record =
      options.kind === 'parallel'
        ? createParallelRecord(index, options.count, random, idWidth)
        : options.kind === 'scatter-fast'
          ? createScatterFastRecord(index, options.count, random, idWidth)
          : createRecord(index, options.count, random, idWidth);
    if (scatterFastColumnar !== null) {
      appendScatterFastColumnarRecord(scatterFastColumnar, index, record as ScatterFastRecord);
    }
    const suffix = index === options.count - 1 ? '\n' : ',\n';
    await writeChunk(stream, `    ${JSON.stringify(record)}${suffix}`);
  }

  await writeChunk(stream, '  ]\n}\n');
  stream.end();
  await finishedWriting;

  console.log(
    `Wrote ${options.count} ${options.kind} records to ${outPath} using seed ${options.seed}. ` +
      'metadata.createdAt is deterministic from seed and count.',
  );

  if (scatterFastColumnar !== null) {
    await writeScatterFastColumnar(options, scatterFastColumnar);
  }
}

async function writeHistogramBarsDataset(options: GeneratorOptions, outPath: string): Promise<void> {
  const payload = createHistogramBarsPayload(options);
  const stream = createWriteStream(outPath, { encoding: 'utf8' });
  const finishedWriting = finished(stream);

  stream.end(`${JSON.stringify(payload, null, 2)}\n`);
  await finishedWriting;

  console.log(
    `Wrote ${payload.parameters.length} histogram bar parameters with ${options.count} bars each to ${outPath} using seed ${options.seed}. ` +
      'metadata.createdAt is deterministic from seed and count.',
  );
}

async function writeMixedTableDataset(options: GeneratorOptions, outPath: string): Promise<void> {
  const tableCounts = createMixedTableCounts(options.count, options.secondaryCount);
  const metadata = createMixedTableMetadata(options, tableCounts);
  const random = createRandom(options.seed);
  const idWidth = Math.max(6, String(Math.max(0, Math.max(...tableCounts) - 1)).length);
  const stream = createWriteStream(outPath, { encoding: 'utf8' });
  const finishedWriting = finished(stream);

  await writeChunk(stream, '{\n  "metadata": ');
  await writeChunk(stream, JSON.stringify(metadata, null, 2).replaceAll('\n', '\n  '));
  await writeChunk(stream, ',\n  "tables": [\n');

  let globalIndex = 0;
  for (let tableIndex = 0; tableIndex < MIXED_TABLE_NAMES.length; tableIndex += 1) {
    const tableName = MIXED_TABLE_NAMES[tableIndex]!;
    const tableCount = tableCounts[tableIndex] ?? 0;
    const tablePrefix = tableIndex === 0 ? '    ' : ',\n    ';
    const tableHeader = { name: tableName };
    await writeChunk(
      stream,
      `${tablePrefix}${JSON.stringify(tableHeader).replace(/\}$/u, ',"records":[')}`,
    );

    for (let localIndex = 0; localIndex < tableCount; localIndex += 1) {
      const record = createMixedTableRecord(
        tableName,
        tableIndex,
        localIndex,
        tableCount,
        globalIndex,
        random,
        idWidth,
      );
      const prefix = localIndex === 0 ? '\n      ' : ',\n      ';
      await writeChunk(stream, `${prefix}${JSON.stringify(record)}`);
      globalIndex += 1;
    }

    await writeChunk(stream, tableCount > 0 ? '\n    ]}' : ']}');
  }

  await writeChunk(stream, '\n  ]\n}\n');
  stream.end();
  await finishedWriting;

  console.log(
    `Wrote ${tableCounts.reduce((sum, count) => sum + count, 0)} mixed-table records across ${MIXED_TABLE_NAMES.length} tables to ${outPath} using seed ${options.seed}. ` +
      'metadata.createdAt is deterministic from seed and count.',
  );
}

function createMixedTableCounts(count: number, secondaryCount: number): number[] {
  return [count, secondaryCount];
}

async function writeScatterFastSchema(options: GeneratorOptions): Promise<void> {
  const schemaOutPath = resolve(options.schemaOut ?? SCATTER_FAST_DEFAULT_SCHEMA_OUT);
  await mkdir(dirname(schemaOutPath), { recursive: true });
  const stream = createWriteStream(schemaOutPath, { encoding: 'utf8' });
  const finishedWriting = finished(stream);

  stream.end(`${JSON.stringify(createScatterFastSchema(), null, 2)}\n`);
  await finishedWriting;
}

async function writeScatterFastColumnar(
  options: GeneratorOptions,
  builder: ScatterFastColumnarBuilder,
): Promise<void> {
  const manifestPath = resolve(options.columnarOut ?? deriveColumnarManifestPath(options.out));
  const binaryPath = manifestPath.replace(/\.json$/u, '.bin');
  await mkdir(dirname(manifestPath), { recursive: true });
  await mkdir(dirname(binaryPath), { recursive: true });

  const chunks = createScatterFastColumnarChunks(builder);
  const binaryStream = createWriteStream(binaryPath);
  const finishedWriting = finished(binaryStream);
  for (const chunk of chunks) {
    await writeChunk(binaryStream, chunk.padding);
    await writeChunk(binaryStream, Buffer.from(chunk.array.buffer));
  }
  binaryStream.end();
  await finishedWriting;

  const manifest = {
    version: 1,
    count: options.count,
    idPrefix: builder.idPrefix,
    idWidth: builder.idWidth,
    binary: basename(binaryPath),
    timestampOriginNs: (builder.timestampOriginNs ?? 0n).toString(),
    domains: {
      accepted: { min: 0, max: 1 },
      phase: { min: -0.5, max: 3.5 },
      signalValue: calculateDomain(builder.signalValue),
      timestampNs: {
        min: builder.x[0] ?? 0,
        max: builder.x[builder.x.length - 1] ?? 0,
      },
    },
    columns: Object.fromEntries(
      chunks.map((chunk) => [
        chunk.name,
        {
          byteLength: chunk.array.byteLength,
          byteOffset: chunk.byteOffset,
          length: chunk.length,
          type: chunk.type,
        },
      ]),
    ),
  };
  const manifestStream = createWriteStream(manifestPath, { encoding: 'utf8' });
  const manifestFinished = finished(manifestStream);
  manifestStream.end(`${JSON.stringify(manifest, null, 2)}\n`);
  await manifestFinished;

  console.log(
    `Wrote ${options.count} scatter-fast columnar records to ${manifestPath} and ${binaryPath}.`,
  );
}

function calculateDomain(values: Float64Array): { max: number; min: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  return {
    max: Number.isFinite(max) ? max : 0,
    min: Number.isFinite(min) ? min : 0,
  };
}

type ScatterFastColumnarArray =
  | BigInt64Array
  | Float32Array
  | Float64Array
  | Uint8Array
  | Uint32Array;

function createScatterFastColumnarChunks(builder: ScatterFastColumnarBuilder): {
  array: ScatterFastColumnarArray;
  byteOffset: number;
  length: number;
  name: string;
  padding: Buffer;
  type: string;
}[] {
  const definitions: { array: ScatterFastColumnarArray; name: string; type: string }[] = [
    { array: builder.x, name: 'x', type: 'Float64Array' },
    { array: builder.phase, name: 'phase', type: 'Float64Array' },
    { array: builder.accepted, name: 'accepted', type: 'Float64Array' },
    { array: builder.signalValue, name: 'signalValue', type: 'Float64Array' },
    { array: builder.color, name: 'color', type: 'Uint8Array' },
    { array: builder.opacity, name: 'opacity', type: 'Float32Array' },
    { array: builder.rotationDegrees, name: 'rotationDegrees', type: 'Float32Array' },
    { array: builder.rotationRadians, name: 'rotationRadians', type: 'Float32Array' },
    { array: builder.size, name: 'size', type: 'Float32Array' },
    { array: builder.shape, name: 'shape', type: 'Uint8Array' },
    { array: builder.sourceIndex, name: 'sourceIndex', type: 'Uint32Array' },
    { array: builder.timestampNs, name: 'timestampNs', type: 'BigInt64Array' },
  ];
  let byteOffset = 0;

  return definitions.map((definition) => {
    const alignment = bytesPerElement(definition.array);
    const paddingLength = (alignment - (byteOffset % alignment)) % alignment;
    byteOffset += paddingLength;
    const chunk = {
      ...definition,
      byteOffset,
      length: definition.array.length,
      padding: Buffer.alloc(paddingLength),
    };
    byteOffset += definition.array.byteLength;

    return chunk;
  });
}

function bytesPerElement(array: ScatterFastColumnarArray): number {
  return array.BYTES_PER_ELEMENT;
}

function deriveColumnarManifestPath(outPath: string): string {
  return outPath.replace(/\.json$/u, '.columnar.json');
}

try {
  await writeDataset(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
