import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  ParallelFastColumns,
} from '../../packages/m-charts/src/m-parallel/core/index.ts';
import {
  createParallelFastPlot,
  createDefaultParallelBindings,
  createParallelDomBrushHitTest,
} from '../../packages/m-charts/src/m-parallel/engine/index.ts';
import { createParallelFastBuffers } from '../../packages/m-charts/src/m-parallel/core/index.ts';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const parallelFastRoot = resolve(repoRoot, 'packages/m-charts/src/m-parallel');
const parallelCoreRoot = resolve(repoRoot, 'packages/m-charts/src/m-parallel/core');
const parallelEngineRoot = resolve(repoRoot, 'packages/m-charts/src/m-parallel/engine');
const plotEngineRoot = resolve(repoRoot, 'packages/m-charts/src/plot-engine');
const sourceFiles = listSourceFiles(parallelFastRoot);
const frameworkNeutralSourceFiles = [
  ...listSourceFiles(plotEngineRoot),
  ...listSourceFiles(parallelCoreRoot),
  ...listSourceFiles(parallelEngineRoot),
];
const forbiddenPatterns = [
  /import\.meta\.env/,
  /process\.env/,
  /from\s+['"].*\/(?:data|routes|state|theme)\//,
  /import\s+['"].*\/(?:data|routes|state|theme)\//,
];
const forbiddenFrameworkPatterns = [
  /from\s+['"]react(?:\/[^'"]*)?['"]/,
  /import\s+['"]react(?:\/[^'"]*)?['"]/,
  /from\s+['"]react-router(?:-dom)?(?:\/[^'"]*)?['"]/,
  /import\s+['"]react-router(?:-dom)?(?:\/[^'"]*)?['"]/,
  /from\s+['"][^.'"][^'"]*['"]/,
  /import\s+['"][^.'"][^'"]*['"]/,
  ...forbiddenPatterns,
];

for (const filePath of sourceFiles) {
  const source = readFileSync(filePath, 'utf8');

  for (const pattern of forbiddenPatterns) {
    assert.equal(
      pattern.test(source),
      false,
      `${relative(repoRoot, filePath)} must not import environment setup or app-owned modules`,
    );
  }
}

for (const filePath of frameworkNeutralSourceFiles) {
  const source = readFileSync(filePath, 'utf8');

  for (const pattern of forbiddenFrameworkPatterns) {
    assert.equal(
      pattern.test(source),
      false,
      `${relative(repoRoot, filePath)} must remain framework-neutral and app-independent`,
    );
  }
}

const columns: ParallelFastColumns = {
  axisOrder: ['a', 'b', 'c'],
  color: ['#112233', '#44556680', '#778899'],
  ids: ['one', 'two', 'three'],
  opacity: new Float32Array([1, 0.5, 0.25]),
  preselectedSourceIndices: new Uint32Array([1]),
  valuesByAxis: {
    a: new Float32Array([1, 2, 3]),
    b: new Float32Array([10, 20, 30]),
    c: new Float32Array([7, 5, 9]),
  },
};
const buffers = createParallelFastBuffers(columns, { includeWebglSegmentBuffers: true });
assert.equal(buffers.axisCount, 3);
assert.equal(buffers.webglSegmentBuffers?.segmentCount, 6);
assert.deepEqual(Array.from(buffers.styleBuffers?.color ?? []), [
  0x11,
  0x22,
  0x33,
  0xff,
  0x44,
  0x55,
  0x66,
  0x40,
  0x77,
  0x88,
  0x99,
  0x40,
]);
assert.deepEqual(Array.from(buffers.styleBuffers?.opacity ?? []), [1, 0.5, 0.25]);
assert.equal(buffers.styleBuffers?.styledRecordCount, 3);
assert.deepEqual(Array.from(buffers.webglSegmentBuffers?.sourceIndicesByVertex ?? []), [
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
]);
assert.throws(
  () =>
    createParallelFastBuffers({
      axisOrder: ['missing'],
      ids: ['one'],
      valuesByAxis: {},
    }),
  /missing typed values/u,
);
assert.throws(
  () =>
    createParallelFastBuffers({
      axisOrder: ['a'],
      color: ['#112233'],
      ids: ['one', 'two'],
      valuesByAxis: { a: new Float32Array([1, 2]) },
    }),
  /color style buffer has 1 values for 2 records/u,
);
assert.throws(
  () =>
    createParallelFastBuffers({
      axisOrder: ['a'],
      ids: ['one'],
      opacity: [1.5],
      valuesByAxis: { a: new Float32Array([1]) },
    }),
  /opacity style buffer at row 0 must be between 0 and 1/u,
);
const missingBuffers = createParallelFastBuffers({
  axisOrder: ['missing'],
  ids: ['one'],
  valuesByAxis: { missing: new Float32Array([Number.NaN]) },
});
assert.equal(Number.isNaN(missingBuffers.rawValuesByAxis.missing[0]), true);

assert.equal(typeof createParallelFastPlot, 'function');
assert.equal(typeof createDefaultParallelBindings, 'function');
assert.equal(typeof createParallelDomBrushHitTest, 'function');

function listSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
    } else if (entry.isFile() && /\.[cm]?tsx?$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

console.log('parallel-fast boundary tests passed');
