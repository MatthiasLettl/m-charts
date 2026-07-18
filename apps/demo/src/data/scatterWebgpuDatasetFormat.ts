import type { FastScatterDatasetSchema, FastScatterRange } from 'm-charts/m-scatter';

import {
  SCATTER_SHAPES,
  SCATTER_STYLE_LIMITS,
  type ScatterShape,
} from './types.ts';

export const SCATTER_WEBGPU_DATASET_FORMAT_VERSION = 7 as const;
export const SCATTER_WEBGPU_GENERATOR_VERSION = 1 as const;
export const SCATTER_WEBGPU_DEFAULT_PAGE_SIZE = 250_000;
export const SCATTER_WEBGPU_DEFAULT_SEED = 1;

export interface ScatterWebgpuPageColumn {
  byteLength: number;
  byteOffset: number;
  length: number;
  type: string;
}

export interface ScatterWebgpuPagedManifestPage {
  binary: string;
  byteLength: number;
  columns: Record<string, ScatterWebgpuPageColumn>;
  count: number;
  startIndex: number;
  styleBinary: string;
  styleByteLength: number;
}

export interface ScatterWebgpuPagedManifest {
  columnScales?: Record<string, number>;
  count: number;
  domains: Record<string, FastScatterRange>;
  format: 'm-scatter-webgpu-paged';
  generatorVersion?: typeof SCATTER_WEBGPU_GENERATOR_VERSION;
  idPrefix: string;
  idWidth: number;
  maxPointSize: number;
  pageSize: number;
  pages: ScatterWebgpuPagedManifestPage[];
  seed: number;
  styleStrideBytes?: 4 | 8 | 12;
  timestampOriginNs: string;
  version: 2 | 3 | 4 | 5 | 6 | typeof SCATTER_WEBGPU_DATASET_FORMAT_VERSION;
  xScaleMs?: number;
  xStorage?: 'generated-overlap-index';
}

export interface ScatterWebgpuGeneratedPage {
  coordinateBuffer: ArrayBuffer;
  manifest: ScatterWebgpuPagedManifestPage;
  pageIndex: number;
  styleBuffer: ArrayBuffer;
}

export const SCATTER_WEBGPU_SCHEMA: FastScatterDatasetSchema = {
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

interface ScatterFastRecord {
  accepted: boolean;
  color: string;
  opacity: number;
  phase: 'idle' | 'ramp' | 'steady' | 'cooldown';
  rotation: number;
  shape: ScatterShape;
  signalValue: number;
  size: number;
  timestampNs: string;
}

const X_SCALE_MS = 250;
const SIGNAL_SCALE = 0.0025;
const OVERLAP_BLOCK_SIZE = 24;
const OVERLAP_GROUPS = [
  { anchorOffset: 2, size: 3 },
  { anchorOffset: 14, size: 2 },
] as const;

export function createScatterWebgpuDatasetGenerator(options: {
  count: number;
  pageSize?: number;
  seed?: number;
}) {
  const count = options.count;
  const pageSize = options.pageSize ?? SCATTER_WEBGPU_DEFAULT_PAGE_SIZE;
  const seed = options.seed ?? SCATTER_WEBGPU_DEFAULT_SEED;
  const random = createRandom(seed);
  const idWidth = Math.max(6, String(Math.max(0, count - 1)).length);
  const pageCount = Math.ceil(count / pageSize);
  const pages: ScatterWebgpuPagedManifestPage[] = [];
  let nextPageIndex = 0;
  let timestampOriginNs: bigint | null = null;
  let signalMin = Number.POSITIVE_INFINITY;
  let signalMax = Number.NEGATIVE_INFINITY;
  let maxPointSize = 0;

  return {
    get pageCount() {
      return pageCount;
    },
    createNextPage(): ScatterWebgpuGeneratedPage | null {
      if (nextPageIndex >= pageCount) return null;
      const pageIndex = nextPageIndex;
      nextPageIndex += 1;
      const startIndex = pageIndex * pageSize;
      const pagePointCount = Math.min(pageSize, count - startIndex);
      const coordinateBuffer = new ArrayBuffer(pagePointCount * 4);
      const phase = new Uint8Array(coordinateBuffer, 0, pagePointCount);
      const accepted = new Uint8Array(coordinateBuffer, pagePointCount, pagePointCount);
      const signalValue = new Uint16Array(
        coordinateBuffer,
        pagePointCount * 2,
        pagePointCount,
      );
      const styleBuffer = new ArrayBuffer(pagePointCount * 4);
      const styles = new Uint32Array(styleBuffer);

      for (let localIndex = 0; localIndex < pagePointCount; localIndex += 1) {
        const index = startIndex + localIndex;
        const record = createScatterFastRecord(index, count, random);
        timestampOriginNs ??= BigInt(record.timestampNs);
        phase[localIndex] = phaseToCode(record.phase);
        accepted[localIndex] = record.accepted ? 1 : 0;
        signalValue[localIndex] = Math.round(record.signalValue / SIGNAL_SCALE);
        styles[localIndex] = packStyle(record);
        signalMin = Math.min(signalMin, record.signalValue);
        signalMax = Math.max(signalMax, record.signalValue);
        maxPointSize = Math.max(maxPointSize, record.size);
      }

      const pageName = `scatter-webgpu-${count}.page-${String(pageIndex).padStart(4, '0')}.bin`;
      const styleName = `scatter-webgpu-${count}.styles-${String(pageIndex).padStart(4, '0')}.bin`;
      const manifestPage: ScatterWebgpuPagedManifestPage = {
        binary: pageName,
        byteLength: coordinateBuffer.byteLength,
        columns: {
          phase: {
            byteLength: phase.byteLength,
            byteOffset: phase.byteOffset,
            length: phase.length,
            type: 'Uint8Array',
          },
          accepted: {
            byteLength: accepted.byteLength,
            byteOffset: accepted.byteOffset,
            length: accepted.length,
            type: 'Uint8Array',
          },
          signalValue: {
            byteLength: signalValue.byteLength,
            byteOffset: signalValue.byteOffset,
            length: signalValue.length,
            type: 'Uint16Array',
          },
        },
        count: pagePointCount,
        startIndex,
        styleBinary: styleName,
        styleByteLength: styleBuffer.byteLength,
      };
      pages.push(manifestPage);
      return { coordinateBuffer, manifest: manifestPage, pageIndex, styleBuffer };
    },
    createManifest(): ScatterWebgpuPagedManifest {
      if (pages.length !== pageCount) {
        throw new Error(`Cannot create a manifest before all ${pageCount} pages are generated.`);
      }
      return {
        columnScales: { signalValue: SIGNAL_SCALE },
        count,
        domains: {
          accepted: { min: 0, max: 1 },
          phase: { min: -0.5, max: 3.5 },
          signalValue: {
            min: Number.isFinite(signalMin) ? Math.round(signalMin / SIGNAL_SCALE) : 0,
            max: Number.isFinite(signalMax) ? Math.round(signalMax / SIGNAL_SCALE) : 0,
          },
          timestampNs: {
            min: 0,
            max: count === 0 ? 0 : (getOverlapAnchorIndex(count - 1, count) ?? count - 1),
          },
        },
        format: 'm-scatter-webgpu-paged',
        generatorVersion: SCATTER_WEBGPU_GENERATOR_VERSION,
        idPrefix: 'sf-',
        idWidth,
        maxPointSize,
        pageSize,
        pages: [...pages],
        seed,
        styleStrideBytes: 4,
        timestampOriginNs: (timestampOriginNs ?? 0n).toString(),
        version: SCATTER_WEBGPU_DATASET_FORMAT_VERSION,
        xScaleMs: X_SCALE_MS,
        xStorage: 'generated-overlap-index',
      };
    },
  };
}

function createScatterFastRecord(
  index: number,
  count: number,
  random: () => number,
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
  const signalValue = 42 + progress * 28 + wave * 9 + (accepted ? -4 : 18) +
    (random() - 0.5) * 8;
  const jitterNs = BigInt(Math.floor(random() * 40_000_000));
  const overlapProfile = createOverlapProfile(index, count);
  const phase = overlapProfile?.phase ?? basePhase;
  const phaseIndex = { cooldown: 3, idle: 0, ramp: 1, steady: 2 }[phase];
  const finalAccepted = overlapProfile?.accepted ?? accepted;
  const finalSignalValue = overlapProfile?.signalValue ?? round(clamp(signalValue, 1, 160), 3);
  const timestampNs = overlapProfile?.timestampNs ??
    (1_717_200_000_000_000_000n + BigInt(index) * 250_000_000n + jitterNs).toString();
  const phaseColor = {
    cooldown: '#7C3AED',
    idle: '#64748B',
    ramp: '#2563EB',
    steady: '#059669',
  }[phase];
  const rejectedColor = index % 2 === 0 ? '#DC2626' : '#EA580C';
  const size = 3.25 + (index % 4) * 0.55 + (finalAccepted ? 0 : 1.25);
  const opacity = 0.56 + (index % 5) * 0.07 + (finalAccepted ? 0 : 0.16);
  const shape = SCATTER_SHAPES[
    (index + phaseIndex + (finalAccepted ? 0 : 2)) % SCATTER_SHAPES.length
  ]!;
  const rangeSample = createStyleRangeSample(index, count);
  return {
    accepted: finalAccepted,
    color: finalAccepted ? phaseColor : rejectedColor,
    opacity: rangeSample?.opacity ?? round(clamp(opacity, 0.42, 0.94), 2),
    phase,
    rotation: rangeSample?.rotation ?? round((index * 13) % 360, 1),
    shape,
    signalValue: finalSignalValue,
    size: rangeSample?.size ?? round(clamp(size, 3, 6.5), 2),
    timestampNs,
  };
}

function createOverlapProfile(index: number, count: number): Pick<
  ScatterFastRecord,
  'accepted' | 'phase' | 'signalValue' | 'timestampNs'
> | null {
  const anchor = getOverlapAnchorIndex(index, count);
  if (anchor === null) return null;
  const progress = count > 1 ? anchor / (count - 1) : 0;
  const phase = progress < 0.18
    ? 'idle'
    : progress < 0.42
      ? 'ramp'
      : progress < 0.82
        ? 'steady'
        : 'cooldown';
  const acceptanceCode = (anchor * 17 + count * 11) % (phase === 'steady' ? 13 : 9);
  const accepted = phase === 'steady' ? acceptanceCode !== 0 : acceptanceCode > 1;
  const wave = Math.sin(progress * Math.PI * 18);
  const modulation = Math.cos(anchor * 0.41) * 2.75 + ((anchor % 5) - 2) * 0.35;
  return {
    accepted,
    phase,
    signalValue: round(
      clamp(42 + progress * 28 + wave * 9 + (accepted ? -4 : 18) + modulation, 1, 160),
      3,
    ),
    timestampNs: (
      1_717_200_000_000_000_000n + BigInt(anchor) * 250_000_000n +
      BigInt((anchor * 17 + count * 29) % 40_000_000)
    ).toString(),
  };
}

function getOverlapAnchorIndex(index: number, count: number): number | null {
  if (count < 3) return null;
  const blockStart = Math.floor(index / OVERLAP_BLOCK_SIZE) * OVERLAP_BLOCK_SIZE;
  const offset = index - blockStart;
  for (const group of OVERLAP_GROUPS) {
    const anchor = blockStart + group.anchorOffset;
    if (anchor < count && offset >= group.anchorOffset && offset < group.anchorOffset + group.size) {
      return anchor;
    }
  }
  return null;
}

function createStyleRangeSample(index: number, count: number) {
  if (count < 3) return undefined;
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

function packStyle(record: ScatterFastRecord): number {
  const opacity = Math.fround(record.opacity);
  const sourceRotation = Math.fround(normalizeRadians((record.rotation * Math.PI) / 180));
  const fullTurn = Math.PI * 2;
  const rotation = ((sourceRotation + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
  const encodedRotation = Math.max(0, Math.min(63, Math.round(
    ((rotation + Math.PI) / fullTurn) * 63,
  )));
  const encodedSize = Math.max(0, Math.min(7, Math.round(record.size - 1)));
  const color = Number.parseInt(record.color.replace('#', ''), 16);
  const red = (color >>> 16) & 0xff;
  const green = (color >>> 8) & 0xff;
  const blue = color & 0xff;
  const rgb565 = Math.round((red / 255) * 31) |
    (Math.round((green / 255) * 63) << 5) |
    (Math.round((blue / 255) * 31) << 11);
  return (
    rgb565 |
    (Math.round(Math.max(0, Math.min(1, opacity)) * 15) << 16) |
    (shapeToCode(record.shape) << 20) |
    (encodedRotation << 23) |
    (encodedSize << 29)
  ) >>> 0;
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

function phaseToCode(phase: ScatterFastRecord['phase']): number {
  return { cooldown: 3, idle: 0, ramp: 1, steady: 2 }[phase];
}

function shapeToCode(shape: ScatterShape): number {
  return { arrow: 4, circle: 0, pin: 3, rectangle: 1, triangle: 2 }[shape];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function midpoint(range: { max: number; min: number }): number {
  return (range.min + range.max) / 2;
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
