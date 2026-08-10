# Scatter WebGL2-To-WebGPU Source-Copy Migration

This example starts from an existing WebGL2 scatter integration. Keep the copied
`plot-engine`, `m-scatter/core`, and `m-scatter/engine` folders, then add:

```text
packages/m-charts/src/plot-engine-webgpu -> src/vendor/m-charts/plot-engine-webgpu
packages/m-charts/src/m-scatter-webgpu/core -> src/vendor/m-charts/m-scatter-webgpu/core
packages/m-charts/src/m-scatter-webgpu/engine -> src/vendor/m-charts/m-scatter-webgpu/engine
```

Copy `m-scatter-webgpu/adapters` for unknown- or known-count live typed batches,
streamed JSON record encoding, or the legacy preloading adapter. Add
`@webgpu/types` to the host TypeScript configuration when its DOM declarations
do not include WebGPU.

For a WebGPU-only switch, keep scatter data/core imports and change the factory
import:

```diff
- import { createScatterPlot } from './vendor/m-charts/m-scatter/engine/index.js';
+ import { createScatterPlot } from './vendor/m-charts/m-scatter-webgpu/engine/index.js';
```

The same options, bindings, commands, events, overlays, and shared CSS hooks are
compatible. Await `plot.interactive` for the first displayed frame or
`plot.ready` for the first complete settled frame.

After making that renderer switch, an HTTP JSON stream is a focused constructor
change rather than a route rewrite:

```ts
import {
  createFastScatterJsonRecordBatchSource,
  createFastScatterWebgpuStreamingPlot,
  createFastScatterWebgpuStreamSourceFromRecordBatches,
} from './vendor/m-charts/m-scatter-webgpu/adapters/index.js';

const response = await fetch('/api/points');
if (response.body === null) throw new Error('Missing response body');
const records = createFastScatterJsonRecordBatchSource(response.body, {
  schema,
});
const { columns: _columns, spec: _spec, ...streamOptions } = options;
const plot = await createFastScatterWebgpuStreamingPlot(host, {
  ...streamOptions,
  dataSource: createFastScatterWebgpuStreamSourceFromRecordBatches(records),
});
plot.use(createDefaultScatterBindings());
await plot.streaming.done;
```

Add `count` when the endpoint declares it to preallocate and validate the final
total; the live bridge also accepts unknown-length responses. The constructor
resolves after the first non-empty batch. The default growing
viewport follows incoming data until the user pans or zooms, then preserves that
interaction. Typed-batch sources may omit the final count; abort and transport
errors reject `plot.streaming.done` while retaining the loaded prefix.

The following version retains WebGL2 for clients or datasets that cannot start
WebGPU:

```ts
import { diagnoseWebgpuSupport } from './vendor/m-charts/plot-engine-webgpu/core/index.js';
import {
  createDefaultScatterBindings,
  createScatterPlot as createWebglScatterPlot,
} from './vendor/m-charts/m-scatter/engine/index.js';
import {
  createScatterPlot as createWebgpuScatterPlot,
} from './vendor/m-charts/m-scatter-webgpu/engine/index.js';

type ScatterOptions = Parameters<typeof createWebglScatterPlot>[1];

async function createSupportedScatter(
  host: HTMLDivElement,
  options: ScatterOptions,
) {
  const support = await diagnoseWebgpuSupport();

  if (support.adapterAvailable) {
    let webgpuPlot: ReturnType<typeof createWebgpuScatterPlot> | undefined;
    try {
      webgpuPlot = createWebgpuScatterPlot(host, options);
      await webgpuPlot.interactive;
      await webgpuPlot.ready;
      return webgpuPlot;
    } catch (error) {
      webgpuPlot?.dispose();
      console.warn('WebGPU scatter startup failed; using WebGL2.', error);
    }
  }

  return createWebglScatterPlot(host, options);
}

export async function mountScatter(
  host: HTMLDivElement,
  options: ScatterOptions,
): Promise<() => void> {
  const plot = await createSupportedScatter(host, options);
  const bindings = plot.use(createDefaultScatterBindings({
    inputElement: host.parentElement ?? host,
    suppressContextMenu: true,
  }));
  const unsubscribeSelection = plot.on('selectionchange', (event) => {
    console.log('selected rows', event.selectedCount, event.sourceIndices);
  });

  return () => {
    unsubscribeSelection();
    bindings.dispose();
    plot.dispose();
  };
}
```

The adapter diagnosis is intentionally followed by a startup `try`/`catch`:
feature exposure alone cannot guarantee that a particular dataset fits the
adapter's buffer/binding limits or that device and shader initialization will
succeed. Dispose a failed WebGPU instance before creating WebGL2 in the same
host.

WebGPU adds four creation-only options: `aggregationBackend`, `indexedStyle`,
`packedStyles`, and `requestTimestampQuery`. `aggregationBackend` accepts
`auto`, `rust-wasm`, or `typescript` for WebGPU bubble/heat-map aggregation; it
is not a WebGL2 option. `auto` and `rust-wasm` prefer Rust/WebAssembly with exact
TypeScript fallback, while `typescript` bypasses WebAssembly. Recreate the
WebGPU plot to change any of these options; continue using `plot.update(...)`
for shared mutable scatter options.

Test the intended product policy in both conditions:

- WebGPU succeeds and `interactive`/`ready` resolve.
- WebGPU is unavailable or startup rejects and WebGL2 renders after cleanup.
- Point, bubble, and heat-map modes preserve expected interactions, selection
  payloads, overlays, and styling.
