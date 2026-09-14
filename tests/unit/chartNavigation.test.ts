import assert from 'node:assert/strict';
import {
  chartTarget,
  readRendererPreference,
  resolveDemoRenderer,
} from '../../apps/demo/src/state/chartNavigation.ts';

// Existing URLs remain the navigation contract; unsupported state cannot leak.
const fallback = new URL(
  chartTarget(
    'scatter',
    'webgl2',
    '?theme=dark&tables=multi&webgpuData=stream-function&points=25000000&webgpuManifest=/private.json',
  ),
  'http://demo',
);
assert.equal(fallback.pathname, '/m-scatter');
assert.equal(fallback.searchParams.get('theme'), 'dark');
assert.equal(fallback.searchParams.get('tables'), 'multi');
assert.equal(fallback.searchParams.get('routeNotice'), 'stream-unavailable');
assert.equal(fallback.searchParams.has('points'), false);
assert.equal(fallback.searchParams.has('webgpuManifest'), false);
assert.equal(
  new URL(
    chartTarget('histogram', 'webgl2', '?histMode=bar'),
    'http://demo',
  ).searchParams.get('histMode'),
  'bar',
);
assert.equal(
  new URL(
    chartTarget('parallel', 'webgpu', '?histMode=bar'),
    'http://demo',
  ).searchParams.has('histMode'),
  false,
);
assert.equal(await resolveDemoRenderer('webgpu'), 'webgpu');
assert.equal(await resolveDemoRenderer('webgl2'), 'webgl2');
assert.equal(readRendererPreference(), 'auto');
assert.equal(await resolveDemoRenderer('auto'), 'webgl2'); // No GPU in the unit runtime.
console.log('chart route navigation tests passed');
