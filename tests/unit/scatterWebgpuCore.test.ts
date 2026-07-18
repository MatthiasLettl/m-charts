import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FAST_SCATTER_WEBGPU_MAX_RENDERED_POINTS_PER_SUBPLOT,
  FastScatterWebgpuWasmAggregationSession,
  buildFastScatterWebgpuBubbleAggregation,
  calculateFastScatterWebgpuColumnEncoding,
  calculateFastScatterWebgpuAlignedStyleWindowBytes,
  calculateFastScatterWebgpuLodPointIndex,
  calculateFastScatterWebgpuLodRange,
  createFastScatterWebgpuPlot,
  createFastScatterWebgpuSelectedBitset,
  createScatterPlot,
  encodeFastScatterWebgpuRange,
  encodeFastScatterWebgpuIndexedRange,
  encodeFastScatterWebgpuValue,
  fastScatterWebgpuUpdateRequiresDraw,
  isFastScatterWebgpuLodPoint,
  packFastScatterWebgpuStyle,
  type FastScatterPointColumns,
  type ScatterWebgpuPlotOptions,
} from '../../packages/m-charts/src/m-scatter-webgpu/index.ts';
import { buildFastScatterAggregation } from '../../packages/m-charts/src/m-scatter/index.ts';
import { diagnoseWebgpuSupport } from '../../packages/m-charts/src/plot-engine-webgpu/index.ts';

assert.deepEqual(
  createFastScatterWebgpuSelectedBitset(new Uint32Array([0, 31, 32, 70]), 71),
  new Uint32Array([0x8000_0001, 1, 1 << 6]),
);
assert.deepEqual(
  encodeFastScatterWebgpuIndexedRange({ min: 24_999_990, max: 25_000_000 }),
  { origin: 24_999_990, range: { min: 0, max: 10 } },
);

const columns: FastScatterPointColumns = {
  color: new Uint8Array([0x11, 0x22, 0x33, 0x44]),
  colorFormat: 'rgba8',
  ids: ['point-1'],
  opacity: new Float32Array([0.5]),
  rotation: new Float32Array([0]),
  shape: new Uint8Array([2]),
  size: new Float32Array([7]),
  x: new Float64Array([1_700_000_000_000]),
  y: { value: new Float32Array([4]) },
};

assert.equal(
  calculateFastScatterWebgpuAlignedStyleWindowBytes(128 * 1024 * 1024, 256),
  128 * 1024 * 1024,
);
assert.deepEqual(calculateFastScatterWebgpuLodRange(0, 25_000_000, 262_144), {
  count: 260_416,
  start: 0,
  stride: 96,
});
assert.deepEqual(calculateFastScatterWebgpuLodRange(123, 25_000_123, 262_144), {
  count: 260_416,
  start: 96,
  stride: 96,
});
assert.deepEqual(calculateFastScatterWebgpuLodRange(100, 1_100), {
  count: 1_000,
  start: 100,
  stride: 1,
});
assert.equal(FAST_SCATTER_WEBGPU_MAX_RENDERED_POINTS_PER_SUBPLOT, 1_000_000);
assert.deepEqual(calculateFastScatterWebgpuLodRange(0, 999_999), {
  count: 999_999,
  start: 0,
  stride: 1,
});
assert.deepEqual(calculateFastScatterWebgpuLodRange(0, 25_000_000), {
  count: 1_000_000,
  start: 0,
  stride: 25,
});
const representativePoint = calculateFastScatterWebgpuLodPointIndex(0, 1234, 25);
assert.equal(isFastScatterWebgpuLodPoint(representativePoint, 0, 1_000_000, 25), true);
assert.equal(isFastScatterWebgpuLodPoint(representativePoint + 1, 0, 1_000_000, 25), false);
assert.equal(
  calculateFastScatterWebgpuAlignedStyleWindowBytes(1_000, 256),
  768,
);

const style = packFastScatterWebgpuStyle(columns, 0, [0, 0, 0, 255]);
assert.equal(style.color, 0x44332211);
assert.equal(style.meta & 0xff, 128);
assert.equal((style.meta >>> 8) & 0x7, 2);
assert.equal((style.meta >>> 11) & 0x3ff, 512);
assert.equal((style.meta >>> 21) & 0x7ff, 28);
assert.equal(style.size, 7);

const coordinateValues = new Float64Array([
  1_700_000_000_000,
  1_700_000_001_000,
  1_700_000_002_000,
]);
const encoding = calculateFastScatterWebgpuColumnEncoding(coordinateValues);
assert.deepEqual(encoding, {
  offset: 1_700_000_000_000,
  scale: 2000,
});
assert.equal(encodeFastScatterWebgpuValue(coordinateValues[0]!, encoding), 0);
assert.equal(encodeFastScatterWebgpuValue(coordinateValues[1]!, encoding), 0.5);
assert.equal(encodeFastScatterWebgpuValue(coordinateValues[2]!, encoding), 1);
assert.deepEqual(
  encodeFastScatterWebgpuRange(
    { min: coordinateValues[0]!, max: coordinateValues[2]! },
    encoding,
  ),
  { min: 0, max: 1 },
);

assert.equal(typeof createFastScatterWebgpuPlot, 'function');
assert.equal(createScatterPlot, createFastScatterWebgpuPlot);
const plotOptions = {
  aggregationBackend: 'typescript',
  axisMode: 'xy',
  columns,
  indexedStyle: true,
  mode: 'pan',
  spec: {
    plots: [{ id: 'value', label: 'Value', yKey: 'value' }],
    xLabel: 'Time',
  },
  viewport: {
    x: { min: coordinateValues[0]!, max: coordinateValues[2]! },
    yByPlot: { value: { min: 0, max: 10 } },
  },
} satisfies ScatterWebgpuPlotOptions;
assert.equal('visualizationMode' in plotOptions, false);
assert.equal(plotOptions.indexedStyle, true);
assert.equal(plotOptions.aggregationBackend, 'typescript');
assert.equal(fastScatterWebgpuUpdateRequiresDraw({ hoverSourceIndex: 0 }), false);
assert.equal(fastScatterWebgpuUpdateRequiresDraw({ onMetrics: undefined }), false);
assert.equal(
  fastScatterWebgpuUpdateRequiresDraw({ viewport: plotOptions.viewport }),
  true,
);

const diagnostic = await diagnoseWebgpuSupport();
assert.equal(typeof diagnostic.hasNavigatorGpu, 'boolean');
assert.equal(typeof diagnostic.adapterAvailable, 'boolean');

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sourceRoot = resolve(repoRoot, 'packages/m-charts/src/m-scatter-webgpu');
for (const filePath of listSourceFiles(sourceRoot)) {
  const source = readFileSync(filePath, 'utf8');
  assert.equal(/from\s+['"]react(?:\/[^'"]*)?['"]/.test(source), false);
  assert.equal(/from\s+['"]react-router(?:-dom)?(?:\/[^'"]*)?['"]/.test(source), false);
  assert.equal(/import\.meta\.env|process\.env/.test(source), false);
}

const shader = readFileSync(
  resolve(sourceRoot, 'core/shaders.ts'),
  'utf8',
);
assert.match(shader, /@vertex\s+fn pointVertex/);
assert.match(shader, /@fragment\s+fn pointFragment/);
assert.match(shader, /array<PackedStyle>/);
assert.match(shader, /decodePointSize/);
assert.match(shader, /override STYLE_MODE: u32/);
assert.doesNotMatch(shader, /override SELECTED_PASS: u32/);
assert.doesNotMatch(shader, /override Y_STORAGE_MODE: u32/);
assert.match(shader, /uniforms\.flags\.z & 0x40000000u/u);
assert.match(shader, /uniforms\.flags\.z & 0x80000000u/u);
assert.match(shader, /selectedMembership\[pointIndex >> 5u\]/u);
assert.doesNotMatch(shader, /sizeDelta/u);
assert.match(shader, /select\(pointIndex, 0u, STYLE_MODE != 0u\)/);
assert.match(shader, /indexedStyle = STYLE_MODE == 2u/);
assert.match(shader, /shape = pointIndex % 5u/);
assert.match(shader, /fn aggregateVertex/u);
assert.match(shader, /fn aggregateFragment/u);
assert.match(shader, /let pointMode = uniforms\.params\.x > 1\.5/u);
assert.match(shader, /bubbleMode/u);
assert.match(shader, /selectedFraction/u);

const bubbleLod = buildFastScatterWebgpuBubbleAggregation(
  {
    ids: ['0', '1', '2', '3', '4', '5'],
    sourceIndex: new Uint32Array([0, 1, 2, 3, 4, 5]),
    x: new Float64Array([0, 0, 0, 1, 2, 3]),
    y: { value: new Float64Array([1, 1, 2, 3, 4, 5]) },
  },
  {
    hoverSourceIndex: 1,
    mode: 'bubble',
    selectedSourceIndices: new Uint32Array([1]),
    subplots: [{
      plotHeightPx: 100,
      plotId: 'value',
      plotWidthPx: 100,
      yKey: 'value',
      yRange: { min: 0, max: 6 },
    }],
    xRange: { min: 0, max: 3 },
  },
  3,
);
assert.equal(bubbleLod.totalAggregateCount, 5);
assert.ok((bubbleLod.subplots[0]?.aggregateCount ?? 0) <= 3);
assert.equal(bubbleLod.subplots[0]?.counts[0], 2);
assert.equal(bubbleLod.subplots[0]?.selectedCounts[0], 1);
assert.equal(bubbleLod.subplots[0]?.hovered[0], 1);
assert.deepEqual(Array.from(bubbleLod.subplots[0]?.sourceIndices ?? []), [0, 1, 4]);
const hashedBubbleLod = buildFastScatterWebgpuBubbleAggregation(
  {
    ids: ['0', '1', '2', '3', '4', '5'],
    x: new Proxy(
      { byteLength: 0, generatedOverlapIndex: true, length: 6 },
      {
        get(target, property) {
          if (property in target) return target[property as keyof typeof target];
          if (typeof property !== 'string') return undefined;
          const index = Number(property);
          return index >= 2 && index < 5 ? 2 : index;
        },
      },
    ) as unknown as Uint32Array,
    y: { value: new Float64Array([1, 1, 2, 2, 4, 5]) },
  },
  {
    mode: 'bubble',
    subplots: [{
      plotHeightPx: 100,
      plotId: 'value',
      plotWidthPx: 100,
      yKey: 'value',
      yRange: { min: 0, max: 6 },
    }],
    xRange: { min: 0, max: 3 },
  },
  2,
);
assert.equal(hashedBubbleLod.totalAggregateCount, 4);
assert.ok((hashedBubbleLod.subplots[0]?.aggregateCount ?? 0) <= 2);
assert.equal(hashedBubbleLod.subplots[0]?.counts.includes(2), true);
assert.deepEqual(
  Array.from(hashedBubbleLod.subplots[0]?.centerX ?? []),
  Array.from(hashedBubbleLod.subplots[0]?.centerX ?? []).sort((left, right) => left - right),
);

const wasmColumns: FastScatterPointColumns = {
  ids: ['0', '1', '2', '3', '4', '5'],
  sourceIndex: new Uint32Array([0, 1, 2, 3, 4, 5]),
  x: new Float64Array([0, 0, 0, 1, 2, 3]),
  y: { value: new Float32Array([1, 1, 2, 3, 4, 5]) },
};
const wasmSession = FastScatterWebgpuWasmAggregationSession.create(
  wasmColumns,
  { xLabel: 'x', plots: [{ id: 'value', label: 'Value', yKey: 'value' }] },
  true,
);
assert.notEqual(wasmSession, null);
const heatRequest = {
  heatBinPx: 20,
  hoverSourceIndex: 1,
  mode: 'heatmap' as const,
  selectedSourceIndices: new Uint32Array([1, 4]),
  subplots: [{
    plotHeightPx: 100,
    plotId: 'value',
    plotWidthPx: 100,
    yKey: 'value',
    yRange: { min: 0, max: 6 },
  }],
  xRange: { min: 0, max: 3 },
};
const wasmHeat = wasmSession?.build(heatRequest);
const typescriptHeat = buildFastScatterAggregation(wasmColumns, heatRequest);
assert.equal(wasmHeat?.kind, 'heatmap');
assert.equal(typescriptHeat.kind, 'heatmap');
if (wasmHeat?.kind === 'heatmap' && typescriptHeat.kind === 'heatmap') {
  const actual = wasmHeat.subplots[0]!;
  const expected = typescriptHeat.subplots[0]!;
  assert.deepEqual(actual.counts, expected.counts);
  assert.deepEqual(actual.hovered, expected.hovered);
  assert.deepEqual(actual.membershipCounts, expected.membershipCounts);
  assert.deepEqual(actual.membershipOffsets, expected.membershipOffsets);
  assert.deepEqual(actual.selectedCounts, expected.selectedCounts);
  assert.deepEqual(actual.sourceIndices, expected.sourceIndices);
}
const wasmBubble = wasmSession?.build({
  ...heatRequest,
  mode: 'bubble',
});
const typescriptBubble = buildFastScatterWebgpuBubbleAggregation(wasmColumns, {
  ...heatRequest,
  mode: 'bubble',
});
assert.equal(wasmBubble?.kind, 'bubble');
if (wasmBubble?.kind === 'bubble') {
  const actual = wasmBubble.subplots[0]!;
  const expected = typescriptBubble.subplots[0]!;
  assert.deepEqual(actual.centerX, expected.centerX);
  assert.deepEqual(actual.centerY, expected.centerY);
  assert.deepEqual(actual.counts, expected.counts);
  assert.deepEqual(actual.hovered, expected.hovered);
  assert.deepEqual(actual.membershipCounts, expected.membershipCounts);
  assert.deepEqual(actual.membershipOffsets, expected.membershipOffsets);
  assert.deepEqual(actual.selectedCounts, expected.selectedCounts);
  assert.deepEqual(actual.sourceIndices, expected.sourceIndices);
}
assert.equal(wasmSession?.getDiagnostics().backend, 'rust-wasm');
assert.equal(wasmSession?.getDiagnostics().zeroCopyBuilds, true);
assert.equal(wasmSession?.getDiagnostics().buildCount, 2);

const orderedCount = 2_048;
const orderedX = new Float32Array(orderedCount);
const orderedY = new Uint16Array(orderedCount);
const xOrder = new Uint32Array(orderedCount);
const orderedSourceIndex = new Uint32Array(orderedCount);
for (let sortedIndex = 0; sortedIndex < orderedCount; sortedIndex += 1) {
  const pointIndex = (sortedIndex * 5) % orderedCount;
  xOrder[sortedIndex] = pointIndex;
  orderedX[pointIndex] = Math.floor(sortedIndex / 4);
  orderedY[pointIndex] = (sortedIndex * 37) % 997;
  orderedSourceIndex[pointIndex] = orderedCount - pointIndex - 1;
}
const orderedColumns: FastScatterPointColumns = {
  ids: Array.from({ length: orderedCount }, (_, index) => String(index)),
  sourceIndex: orderedSourceIndex,
  x: orderedX,
  xOrder,
  y: { value: orderedY },
};
const orderedSession = FastScatterWebgpuWasmAggregationSession.create(
  orderedColumns,
  { xLabel: 'x', plots: [{ id: 'value', yKey: 'value' }] },
  true,
);
const orderedRequest = {
  heatBinPx: 13,
  hoverSourceIndex: 17,
  mode: 'heatmap' as const,
  selectedSourceIndices: new Uint32Array([0, 17, 1_024]),
  subplots: [{
    plotHeightPx: 217,
    plotId: 'value',
    plotWidthPx: 431,
    yKey: 'value',
    yRange: { min: 996, max: 0 },
  }],
  xRange: { min: 500, max: 10 },
};
const orderedWasmHeat = orderedSession?.build(orderedRequest);
const orderedTypescriptHeat = buildFastScatterAggregation(orderedColumns, orderedRequest);
assert.equal(orderedWasmHeat?.kind, 'heatmap');
if (orderedWasmHeat?.kind === 'heatmap' && orderedTypescriptHeat.kind === 'heatmap') {
  const actual = orderedWasmHeat.subplots[0]!;
  const expected = orderedTypescriptHeat.subplots[0]!;
  assert.deepEqual(actual.counts, expected.counts);
  assert.deepEqual(actual.hovered, expected.hovered);
  assert.deepEqual(actual.membershipOffsets, expected.membershipOffsets);
  assert.deepEqual(actual.selectedCounts, expected.selectedCounts);
  assert.deepEqual(actual.sourceIndices, expected.sourceIndices);
}

const rendererSource = readFileSync(
  resolve(sourceRoot, 'core/renderer.ts'),
  'utf8',
);
assert.match(rendererSource, /for await \(const page of packedStyles\.createPages\(\)\)/u);
assert.doesNotMatch(rendererSource, /await device\.queue\.onSubmittedWorkDone\(\)/u);
assert.match(rendererSource, /mappedAtCreation: true/u);
assert.match(rendererSource, /mapStyleBuffers/u);
assert.match(rendererSource, /FAST_SCATTER_WEBGPU_MAX_RENDERED_POINTS_PER_SUBPLOT/u);
assert.doesNotMatch(rendererSource, /SETTLED_LOD_POINTS_PER_PIXEL/u);
assert.match(rendererSource, /calculateFastScatterWebgpuLodRange/u);
assert.doesNotMatch(rendererSource, /TARGET_EXACT_CHUNK_GPU_MS/u);
assert.match(rendererSource, /workTexture/u);
assert.match(rendererSource, /createRenderPipelineAsync/u);

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(entryPath));
    else if (entry.isFile() && /\.[cm]?tsx?$/u.test(entry.name)) files.push(entryPath);
  }
  return files;
}

assert.equal(relative(repoRoot, sourceRoot), 'packages/m-charts/src/m-scatter-webgpu');
