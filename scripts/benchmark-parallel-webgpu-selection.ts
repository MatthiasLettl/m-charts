import assert from 'node:assert/strict';

import {
  createParallelWebgpuBuffers,
  selectParallelRecordIdsByBrushes,
  type ParallelFastColumns,
} from '../packages/m-charts/src/m-parallel/index.ts';
import {
  ParallelWebgpuWasmSelectionSession,
} from '../packages/m-charts/src/m-parallel-webgpu/index.ts';
import { selectParallelRecordsFromCandidateMask } from '../packages/m-charts/src/m-parallel-webgpu/core/selectionCandidates.ts';

const pointCount = parsePointCount(process.argv.slice(2));
const first = new Float32Array(pointCount);
const second = new Float32Array(pointCount);
const third = new Float32Array(pointCount);
const fourth = new Float32Array(pointCount);
for (let index = 0; index < pointCount; index += 1) {
  first[index] = index % 1000;
  second[index] = (index * 17) % 2000;
  third[index] = (index * 31) % 4000;
  fourth[index] = (index * 47) % 8000;
}
const columns: ParallelFastColumns = {
  axes: ['first', 'second', 'third', 'fourth'].map((key) => ({
    key,
    kind: 'numeric' as const,
  })),
  axisOrder: ['first', 'second', 'third', 'fourth'],
  ids: new Array<string>(pointCount),
  valuesByAxis: { first, fourth, second, third },
};
const build = time(() => createParallelWebgpuBuffers(columns));
const brushes = {
  first: [{ max: 200, min: 100 }, { max: 800, min: 700 }],
  fourth: { max: 6000, min: 2000 },
  second: { max: 1500, min: 500 },
};
const typescript = time(() =>
  selectParallelRecordIdsByBrushes(build.result, brushes),
);
const candidateMask = new Uint32Array(Math.ceil(pointCount / 32));
for (const sourceIndex of typescript.result.sourceIndices) {
  candidateMask[sourceIndex >>> 5] |= 1 << (sourceIndex & 31);
}
const candidateFinalization = time(() =>
  selectParallelRecordsFromCandidateMask(build.result, brushes, candidateMask),
);
assert.deepEqual(
  [...candidateFinalization.result.sourceIndices],
  [...typescript.result.sourceIndices],
);
const sessionBuild = time(() =>
  ParallelWebgpuWasmSelectionSession.create(build.result),
);
const wasm = sessionBuild.result === null
  ? null
  : time(() => sessionBuild.result!.select(brushes));
if (wasm !== null) {
  assert.deepEqual(
    [...wasm.result.sourceIndices],
    [...typescript.result.sourceIndices],
  );
}
console.log(JSON.stringify({
  axisCount: build.result.axisCount,
  bufferBuildMs: build.ms,
  compactCpuBytes:
    pointCount * build.result.axisCount *
    (Float32Array.BYTES_PER_ELEMENT * 2),
  candidateFinalizationMs: candidateFinalization.ms,
  pointCount,
  selectedCount: typescript.result.selectedCount,
  typescriptSelectionMs: typescript.ms,
  wasmSelectionMs: wasm?.ms ?? null,
  wasmSessionBuildMs: sessionBuild.ms,
  wasmSessionResidentBytes: sessionBuild.result?.residentBytes ?? null,
}, null, 2));

function parsePointCount(args: readonly string[]): number {
  const raw = args.find((argument) => argument.startsWith('--points='))?.slice(9);
  const value = raw === undefined ? 1_000_000 : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 25_000_000) {
    throw new Error('--points must be between 1 and 25,000,000.');
  }
  return value;
}

function time<T>(callback: () => T): { ms: number; result: T } {
  const startedAt = performance.now();
  const result = callback();
  return { ms: performance.now() - startedAt, result };
}
