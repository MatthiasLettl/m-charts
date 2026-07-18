import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import * as webglScatter from '../../packages/m-charts/src/m-scatter/index.ts';
import * as webgpuScatter from '../../packages/m-charts/src/m-scatter-webgpu/index.ts';
import type { FastScatterPlotOptions } from '../../packages/m-charts/src/m-scatter/index.ts';
import type { FastScatterWebgpuPlotOptions } from '../../packages/m-charts/src/m-scatter-webgpu/index.ts';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const webglEntry = resolve(repoRoot, 'packages/m-charts/src/m-scatter/index.ts');
const webgpuEntry = resolve(repoRoot, 'packages/m-charts/src/m-scatter-webgpu/index.ts');
const program = ts.createProgram([webglEntry, webgpuEntry], {
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
});
const checker = program.getTypeChecker();

function getExportNames(fileName: string): string[] {
  const sourceFile = program.getSourceFile(fileName);
  assert.notEqual(sourceFile, undefined);
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile!);
  assert.notEqual(moduleSymbol, undefined);
  return checker.getExportsOfModule(moduleSymbol!).map((symbol) => symbol.name).sort();
}

const webglTypeExports = getExportNames(webglEntry);
const webgpuTypeExports = new Set(getExportNames(webgpuEntry));
assert.deepEqual(
  webglTypeExports.filter((exportName) => !webgpuTypeExports.has(exportName)),
  [],
  'the WebGPU entry point must expose every WebGL scatter type and value export',
);

assert.deepEqual(
  Object.keys(webglScatter).filter((exportName) => !(exportName in webgpuScatter)),
  [],
  'the WebGPU entry point must expose every WebGL scatter runtime export',
);

const webgpuModule = checker.getSymbolAtLocation(program.getSourceFile(webgpuEntry)!);
const webgpuUpdateOptionsSymbol = checker
  .getExportsOfModule(webgpuModule!)
  .find((symbol) => symbol.name === 'FastScatterWebgpuPlotUpdateOptions');
assert.notEqual(webgpuUpdateOptionsSymbol, undefined);
const webgpuUpdateOptionNames = new Set(
  checker.getDeclaredTypeOfSymbol(webgpuUpdateOptionsSymbol!).getProperties().map(
    (property) => property.name,
  ),
);
for (const creationOnlyOption of [
  'aggregationBackend',
  'indexedStyle',
  'packedStyles',
  'requestTimestampQuery',
]) {
  assert.equal(webgpuUpdateOptionNames.has(creationOnlyOption), false);
}
assert.equal(
  webgpuScatter.createFastScatterPlot,
  webgpuScatter.createFastScatterWebgpuPlot,
);
assert.equal(
  webgpuScatter.createScatterPlot,
  webgpuScatter.createFastScatterWebgpuPlot,
);

function acceptWebgpuOptions(options: FastScatterWebgpuPlotOptions): void {
  void options;
}
acceptWebgpuOptions(null as unknown as FastScatterPlotOptions);

console.log('scatter WebGPU compatibility contract tests passed');
