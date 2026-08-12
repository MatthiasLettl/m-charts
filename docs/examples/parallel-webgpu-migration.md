# Parallel Coordinates WebGL2-To-WebGPU Source-Copy Migration

This example starts from an existing WebGL2 parallel-coordinate integration.
Keep the copied `plot-engine`, `m-parallel/core`, and `m-parallel/engine`
folders, then add:

```text
packages/m-charts/src/plot-engine-webgpu -> src/vendor/m-charts/plot-engine-webgpu
packages/m-charts/src/m-parallel-webgpu/core -> src/vendor/m-charts/m-parallel-webgpu/core
packages/m-charts/src/m-parallel-webgpu/engine -> src/vendor/m-charts/m-parallel-webgpu/engine
packages/m-charts/src/m-parallel-webgpu/adapters -> src/vendor/m-charts/m-parallel-webgpu/adapters # live streams only
```

The shared `plot-engine-webgpu` copy includes the embedded selection WASM
binary. Add `@webgpu/types` to the host TypeScript configuration when its DOM
declarations do not include WebGPU.

For a WebGPU-only switch, keep parallel data/core imports and change the
factory import:

```diff
- import { createParallelPlot } from './vendor/m-charts/m-parallel/engine/index.js';
+ import { createParallelPlot } from './vendor/m-charts/m-parallel-webgpu/engine/index.js';
```

The same buffers, options, bindings, commands, events, overlays, selection and
inspection payloads, themes, shared CSS hooks, keyboard shortcuts, and
controlled updates remain valid. Await `plot.interactive` for the first
displayed frame or `plot.ready` for the first complete settled frame.

After that renderer migration, switch an all-at-once WebGPU plot from
`buffers` to typed batches plus stable full-stream domains:

```ts
import {
  createParallelWebgpuStreamingPlot,
} from './vendor/m-charts/m-parallel-webgpu/adapters/index.js';

const { buffers: _buffers, ...streamOptions } = options;
const plot = await createParallelWebgpuStreamingPlot(host, {
  ...streamOptions,
  dataSource: {
    batches, // AsyncIterable<{ columns: ParallelFastColumns, packedPage? }>
    domainsByAxis,
    expectedCount,
  },
});
plot.use(createDefaultParallelBindings());

try {
  await plot.streaming.done;
} catch (error) {
  // The loaded prefix remains interactive until it is disposed.
  console.error('Parallel stream stopped.', error);
}
```

Every batch must keep the same axis order and consistently include or omit
`packedPage`. Prepared pages append directly to resident GPU data; unknown
counts grow capacity geometrically and rebuild only when a capacity boundary is
crossed. Sources without packed pages use geometrically growing replacement
prefixes. Current axis viewports and exact brush selection are refreshed as new
rows arrive. `expectedCount` is optional and validated when present. Use
`signal`, `plot.streaming.abort()`, or `plot.dispose()` to cancel, and restart
the source before attempting WebGL2 fallback after a consumed stream fails.

For an HTTP server-stream producer, decode `response.body` incrementally and
map each decoded record batch to `ParallelWebgpuStreamBatch`; do not call
`response.json()`. The repository's
[server-function demonstration](../server-function-streaming.md) shows this
complete path with a hard-capped Vercel Function shared by all three plots.

The following version retains WebGL2 for clients or datasets that cannot start
WebGPU:

```ts
import { diagnoseWebgpuSupport } from './vendor/m-charts/plot-engine-webgpu/core/index.js';
import {
  createDefaultParallelBindings,
  createParallelPlot as createWebglParallelPlot,
  type ParallelPlotOptions,
} from './vendor/m-charts/m-parallel/engine/index.js';
import {
  createParallelPlot as createWebgpuParallelPlot,
} from './vendor/m-charts/m-parallel-webgpu/engine/index.js';

async function createSupportedParallel(
  host: HTMLDivElement,
  options: ParallelPlotOptions,
) {
  const support = await diagnoseWebgpuSupport();

  if (support.adapterAvailable) {
    let webgpuPlot: ReturnType<typeof createWebgpuParallelPlot> | undefined;
    try {
      webgpuPlot = createWebgpuParallelPlot(host, options);
      await webgpuPlot.interactive;
      await webgpuPlot.ready;
      return webgpuPlot;
    } catch (error) {
      webgpuPlot?.dispose();
      console.warn('WebGPU parallel startup failed; using WebGL2.', error);
    }
  }

  return createWebglParallelPlot(host, options);
}

export async function mountParallel(
  host: HTMLDivElement,
  options: ParallelPlotOptions,
): Promise<() => void> {
  const plot = await createSupportedParallel(host, options);
  const bindings = plot.use(createDefaultParallelBindings({
    inputElement: host.parentElement ?? host,
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

Use buffers built by `createParallelBuffers` when the same option object may
fall back to WebGL2. `createParallelWebgpuBuffers` deliberately omits expanded
WebGL line/segment buffers and is for WebGPU-only integrations.

WebGPU adds six creation-only options: `aggregationBackend`, `binResolution`,
`directSegmentLimit`, `renderMode`, `representativeRecordLimit`, and
`requestTimestampQuery`. Recreate the WebGPU plot to change any of them;
continue using `plot.update(...)` for shared mutable parallel options. The
WebGL2-only `forceWebglUnavailable` and `rendererFactory` fields are accepted
and ignored so one shared option object can be passed to either factory. A
custom `hoverRendererFactory` remains active, and `preserveDrawingBuffer` is
forwarded to that hover renderer even though it does not configure the WebGPU
surface.

Test the intended product policy in both conditions:

- WebGPU succeeds and `interactive`/`ready` resolve.
- WebGPU is unavailable or startup rejects and WebGL2 renders after cleanup.
- Axis brushes preserve exact selection filters, counts, and source indices.
- Shift-hover inspection, opacity shortcuts, overlays, preselection, themes,
  and controlled updates behave consistently across both backends.
- Device-loss/restoration and renderer metrics reach both option callbacks and
  typed `plot.on(...)` subscriptions.
