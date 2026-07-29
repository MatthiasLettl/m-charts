import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import * as webglHistogram from '../../packages/m-charts/src/m-histogram/index.ts';
import * as webgpuHistogram from '../../packages/m-charts/src/m-histogram-webgpu/index.ts';
import type { HistogramPlotOptions } from '../../packages/m-charts/src/m-histogram/index.ts';
import type {
  HistogramWebgpuPlotOptions,
} from '../../packages/m-charts/src/m-histogram-webgpu/index.ts';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const webglEntry = resolve(repoRoot, 'packages/m-charts/src/m-histogram/index.ts');
const webgpuEntry = resolve(repoRoot, 'packages/m-charts/src/m-histogram-webgpu/index.ts');
const program = ts.createProgram([webglEntry, webgpuEntry], {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
});
const checker = program.getTypeChecker();

function exportsFor(fileName: string): string[] {
  const source = program.getSourceFile(fileName);
  assert.notEqual(source, undefined);
  const symbol = checker.getSymbolAtLocation(source!);
  assert.notEqual(symbol, undefined);
  return checker.getExportsOfModule(symbol!).map((entry) => entry.name).sort();
}

const webgpuTypes = new Set(exportsFor(webgpuEntry));
assert.deepEqual(
  exportsFor(webglEntry).filter((name) => !webgpuTypes.has(name)),
  [],
  'the WebGPU histogram entry point must be a compatibility superset',
);
assert.deepEqual(
  Object.keys(webglHistogram).filter((name) => !(name in webgpuHistogram)),
  [],
);
assert.equal(
  webgpuHistogram.createHistogramPlot,
  webgpuHistogram.createHistogramWebgpuPlot,
);

function acceptsWebgpuOptions(options: HistogramWebgpuPlotOptions): void {
  void options;
}
acceptsWebgpuOptions(null as unknown as HistogramPlotOptions);

const sharedEngine = readFileSync(
  resolve(repoRoot, 'packages/m-charts/src/m-histogram/engine/createHistogramEngine.ts'),
  'utf8',
);
assert.doesNotMatch(sharedEngine, /WebGL|WebGPU|createWebGl|Webgl/u);

console.log('histogram WebGPU compatibility tests passed');
