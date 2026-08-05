import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import * as webglParallel from '../../packages/m-charts/src/m-parallel/index.ts';
import * as webgpuParallel from '../../packages/m-charts/src/m-parallel-webgpu/index.ts';
import type { ParallelFastPlotOptions } from '../../packages/m-charts/src/m-parallel/index.ts';
import type { ParallelWebgpuPlotOptions } from '../../packages/m-charts/src/m-parallel-webgpu/index.ts';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const webglEntry = resolve(repoRoot, 'packages/m-charts/src/m-parallel/index.ts');
const webgpuEntry = resolve(
  repoRoot,
  'packages/m-charts/src/m-parallel-webgpu/index.ts',
);
const program = ts.createProgram([webglEntry, webgpuEntry], {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
});
const checker = program.getTypeChecker();

function exportNames(fileName: string): string[] {
  const source = program.getSourceFile(fileName);
  assert.notEqual(source, undefined);
  const symbol = checker.getSymbolAtLocation(source!);
  assert.notEqual(symbol, undefined);
  return checker.getExportsOfModule(symbol!).map((entry) => entry.name).sort();
}

const webgpuExports = new Set(exportNames(webgpuEntry));
assert.deepEqual(
  exportNames(webglEntry).filter((name) => !webgpuExports.has(name)),
  [],
  'the WebGPU parallel entry point must remain a WebGL compatibility superset',
);
assert.deepEqual(
  Object.keys(webglParallel).filter((name) => !(name in webgpuParallel)),
  [],
);
assert.equal(
  webgpuParallel.createParallelPlot,
  webgpuParallel.createParallelWebgpuPlot,
);
assert.equal(
  webgpuParallel.createParallelFastPlot,
  webgpuParallel.createParallelWebgpuPlot,
);

function acceptsWebgpuOptions(options: ParallelWebgpuPlotOptions): void {
  void options;
}
acceptsWebgpuOptions(null as unknown as ParallelFastPlotOptions);

console.log('parallel WebGPU compatibility contract tests passed');
