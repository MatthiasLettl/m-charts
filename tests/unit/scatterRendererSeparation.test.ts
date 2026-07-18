import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  FastScatterRendererOptions,
  FastScatterWebglRendererOptions,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';
import type { FastScatterWebgpuRendererOptions } from '../../packages/m-charts/src/m-scatter-webgpu/core/index.ts';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sharedEngineSource = readFileSync(
  resolve(repoRoot, 'packages/m-charts/src/m-scatter/engine/createScatterEngine.ts'),
  'utf8',
);
const webglFactorySource = readFileSync(
  resolve(repoRoot, 'packages/m-charts/src/m-scatter/engine/createScatterPlot.ts'),
  'utf8',
);
const webgpuTypesSource = readFileSync(
  resolve(repoRoot, 'packages/m-charts/src/m-scatter-webgpu/core/types.ts'),
  'utf8',
);

assert.doesNotMatch(sharedEngineSource, /WebGL|WebGPU|createWebGl|FastScatterWebgl/u);
assert.match(webglFactorySource, /createFastScatterEngine/u);
assert.match(webglFactorySource, /FastScatterWebglRenderer/u);
assert.doesNotMatch(webgpuTypesSource, /FastScatterWebglRendererOptions/u);
assert.match(webgpuTypesSource, /FastScatterRendererOptions/u);

function acceptNeutralRendererOptions(options: FastScatterRendererOptions): void {
  void options;
}
acceptNeutralRendererOptions(null as unknown as FastScatterWebglRendererOptions);
acceptNeutralRendererOptions(null as unknown as FastScatterWebgpuRendererOptions);

console.log('scatter renderer separation tests passed');
