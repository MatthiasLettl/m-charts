import assert from 'node:assert/strict';

import { ParallelWebgpuRenderer } from '../../packages/m-charts/src/m-parallel-webgpu/core/renderer.ts';
import { packParallelWebgpuRefinedViewportValues } from '../../packages/m-charts/src/m-parallel-webgpu/core/refinedValues.ts';
import type { ParallelAxisViewports } from '../../packages/m-charts/src/m-parallel/index.ts';

const buffers = {
  axisCount: 4,
  axisOrder: ['a', 'b', 'c', 'd'],
  domainsByAxis: Object.fromEntries(['a', 'b', 'c', 'd'].map((axis) => [axis, { min: 0, max: 10, span: 10 }])),
  rawValuesByAxis: {
    a: new Float64Array([0, 4, 10, Number.NaN]),
    b: new Float64Array([1, 3, 7, 9]),
    c: new Float64Array([2, 4, 6, 8]),
    d: new Float64Array([0, 5, 10, Number.NaN]),
  },
  recordCount: 4,
};
const sourceIndices = new Uint32Array([0, 1, 2, 3]);
const original = packParallelWebgpuRefinedViewportValues(buffers, sourceIndices, {});
const uploads: Float32Array[] = [];
const valuesBuffer = {};
const page = { representativeOnly: true, representativeSourceIndices: sourceIndices, valuesBuffer, count: 4 };
const pages = [page];
let finishGpuWork: (() => void) | undefined;

// Exercise the renderer's viewport, upload and density scheduling logic without
// a browser/GPU. Rendering and shader compilation are covered by browser checks.
const renderer = Object.assign(Object.create(ParallelWebgpuRenderer.prototype), {
  buffers,
  axisViewports: {},
  axisViewportVersion: 0,
  pendingViewportPairRange: null,
  staleDensityPairs: new Map<number, number>(),
  densityVisible: true,
  aggregationRequested: false,
  selectedSourceIndices: new Uint32Array(0),
  preselectedSourceIndices: new Uint32Array(0),
  options: {},
  diagnostics: { renderMode: 'hybrid', binResolution: 32, binCount: 3 * 35 ** 2 },
  gpu: { directPages: pages, staticDirectPages: pages, pages: [], binBuffer: {} },
  context: {
    device: {
      queue: {
        writeBuffer: (target: unknown, _offset: number, values: Float32Array) => {
          if (target === valuesBuffer) uploads.push(values.slice());
        },
        submit: () => undefined,
        onSubmittedWorkDone: () => new Promise<void>((resolve) => { finishGpuWork = resolve; }),
      },
      createCommandEncoder: () => ({
        beginComputePass: () => ({ setPipeline: () => undefined, end: () => undefined }),
        finish: () => ({}),
      }),
    },
  },
  writeAxisConfigs: () => undefined,
  draw: () => undefined,
}) as {
  updateAxisViewports(viewports: ParallelAxisViewports, options: { phase: 'preview' }): void;
  drawDensity(pass: { draw(...args: number[]): void }, firstMode: number, modeCount: number): number;
  aggregate(selection: boolean, range: { start: number; count: number }): Promise<void>;
  densityVisible: boolean;
  staleDensityPairs: Map<number, number>;
  gpu: { directPages: typeof pages };
};

renderer.updateAxisViewports({ d: { min: 4, max: 6 } }, { phase: 'preview' });
assert.equal(renderer.densityVisible, true, 'zoom must not blank density on untouched pairs');
assert.equal(renderer.gpu.directPages, pages, 'zoom retains the representative page');
assert.deepEqual([...sourceIndices], [0, 1, 2, 3], 'outside and missing rows remain represented');
assert.equal(uploads[0]!.length, original.length);
for (let row = 0; row < 4; row += 1) {
  for (let axis = 0; axis < 3; axis += 1) {
    assert.equal(uploads[0]![row * 4 + axis], original[row * 4 + axis], 'untouched coordinates remain identical');
  }
}
assert.equal(uploads[0]![3], -2, 'below-range rows reach the overflow rail');
assert.equal(uploads[0]![7], 0.5);
assert.equal(uploads[0]![11], 3, 'above-range rows reach the overflow rail');
assert.ok(Number.isNaN(uploads[0]![15]), 'missing values retain their own lane');

const draws: number[][] = [];
renderer.drawDensity({ draw: (...args) => { draws.push(args); } }, 0, 1);
assert.deepEqual(draws, [[2, 2 * 35 ** 2, 0, 0]], 'both untouched density pairs remain drawn');
draws.length = 0;
renderer.drawDensity({ draw: (...args) => { draws.push(args); } }, 1, 5);
assert.deepEqual(draws, Array.from({ length: 5 }, (_, mode) => [
  2, 2 * 35 ** 2, 0, (mode + 1) * 3 * 35 ** 2,
]), 'selected and preselected density also preserve untouched pairs');

const firstPass = renderer.aggregate(false, { start: 2, count: 1 });
renderer.updateAxisViewports({ a: { min: 3, max: 7 }, d: { min: 4, max: 6 } }, { phase: 'preview' });
finishGpuWork!();
await firstPass;
assert.deepEqual([...renderer.staleDensityPairs.keys()], [0], 'a later zoom on another axis does not strand completed density');

const secondPass = renderer.aggregate(false, { start: 0, count: 1 });
renderer.updateAxisViewports({ a: { min: 4, max: 6 }, d: { min: 4, max: 6 } }, { phase: 'preview' });
finishGpuWork!();
await secondPass;
assert.deepEqual([...renderer.staleDensityPairs.keys()], [0], 'an older pass cannot publish density for a newer viewport');

renderer.updateAxisViewports({}, { phase: 'preview' });
assert.deepEqual(uploads.at(-1), original, 'reset restores every representative coordinate');
const resetPass = renderer.aggregate(false, { start: 0, count: 3 });
finishGpuWork!();
await resetPass;
assert.equal(renderer.staleDensityPairs.size, 0);
assert.equal(renderer.densityVisible, true);

console.log('parallel WebGPU viewport stability tests passed');
