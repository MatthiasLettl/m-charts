# WebGPU Histogram

`m-charts/m-histogram-webgpu` is an export and type superset of
`m-charts/m-histogram`. To migrate an existing integration, keep the options,
bindings, commands, event subscriptions, callbacks, overlays, and update calls,
and change the constructor import:

```ts
import {
  createHistogramPlot,
  type HistogramWebgpuPlotInstance,
} from 'm-charts/m-histogram-webgpu';
```

The existing `m-histogram` entry point remains the WebGL2 implementation and
retains its TypeScript aggregation behavior.

## WebGPU additions

The WebGPU plot adds:

- `interactive` and `ready` promises for asynchronous device startup.
- `getWebgpuDiagnostics()` for device, upload, render, and aggregation details.
- Creation-only `aggregationBackend: 'auto' | 'rust-wasm' | 'typescript'`.
- Creation-only `requestTimestampQuery`.

The WebGL2-only `forceWebglUnavailable`, `preserveDrawingBuffer`, and
`rendererFactory` options remain accepted so applications can share an option
object between factories; the WebGPU factory ignores them. The two WebGPU-only
options are excluded from `plot.update(...)`. Recreate the plot to change
either one.

## Live typed streams

Static `columns` and pre-aggregated bars remain unchanged. Raw typed columns
can instead be delivered incrementally:

```ts
import { createHistogramWebgpuStreamingPlot } from 'm-charts/m-histogram-webgpu';

const plot = await createHistogramWebgpuStreamingPlot(host, {
  aggregationBackend: 'auto',
  dataSource: {
    batches, // AsyncIterable<{ columns: HistogramColumns }>
    expectedCount,
    spec, // prepared parameter metadata/domains for the complete stream
  },
});

await plot.interactive;
await plot.streaming.done;
```

Typed column storage grows geometrically without recopying every earlier row.
Progress is reported for each accepted batch; exact chart prefixes are
published when the loaded count doubles and once more at completion, avoiding
quadratic full-prefix aggregation while keeping ingestion and interaction
responsive. The existing WebGPU renderer uploads only the resulting bounded
bin/stack buffers. Selection and a user-modified viewport are preserved between
published prefixes. The default `viewportPolicy: 'expand'` follows
growing aggregate bounds until the user changes the viewport; use `preserve`
or provide an initial viewport to keep it fixed from startup. `expectedCount`
and `initialCapacity` are optional hints, and a supplied expected count is
validated. `plot.streaming` exposes `done`, `abort()`, `getColumns()`, and
`getProgress()`. Batch value/color storage types and optional provenance fields
must remain consistent; supplied source indices must be contiguous global row
indices.
The stream owns `aggregation`, `columns`, and `spec`; recreate the streaming
plot instead of passing those fields to `plot.update(...)`.

The repository's `?webgpuData=stream-function` demo maps the same genuinely
chunked Vercel Function response used by scatter into histogram batches and
never materializes the complete HTTP body. See the
[server-function streaming guide](../../docs/server-function-streaming.md).

The `/m-histogram-webgpu?webgpuData=stream-local` demo progressively delivers
the generated raw typed columns while all histogram interactions remain live.

`auto` is the default and selects Rust/WASM for typed continuous and unsigned
integer categorical/boolean columns with explicit parameter domains.
Sequentially encoded categories and packed `Uint32Array` rgba32 color stacks
stay on the WASM path.
It falls back to the exact TypeScript implementation for string columns,
inferred domains, non-sequential category encodings, rgba8 colors, unavailable
WASM, or selected custom source indices outside the row-index range.
Diagnostics report the active backend and fallback reason.

Raw aggregation remains exact over every source row. Setup creates a persistent
sorted row-order index for each continuous parameter. Repeated viewport and
bin-size builds binary-search that index and visit only visible candidates;
unchanged subplot results are reused. Categorical/boolean subplots retain their
exact full-column build and are reused while their inputs remain unchanged.
The renderer draws every normalized bin and color-stack segment; there is no
bar sampling or histogram LOD.
Pre-aggregated `mode: 'bar'` input bypasses raw aggregation and uses the same
rendering and interaction contract.

The `/m-histogram-webgpu` demo reuses the browser-generated, IndexedDB-backed
WebGPU scatter dataset and its 250,000-row pages. Its process-phase,
acceptance, signal-value, and per-record palette columns become three stacked
histogram subplots. It supports 1M, 10M, and 25M records, the same fixed
1,000-record secondary table in multiple-table mode, raw and pre-aggregated
input, and all three aggregation choices. Heavy changes use a full page refresh
so the previous large dataset and GPU resources can be released.

## Architecture and compatibility

The backend-neutral engine remains in `m-histogram/engine`. The WebGL2 factory
supplies the existing renderer and TypeScript aggregation provider; the WebGPU
factory supplies `HistogramWebgpuRenderer` and
`HistogramWebgpuAggregationProvider`. Neither renderer is imported into the
shared engine.

The generated host/canvas preserve `histogram-fast-engine-host` and
`histogram-fast-engine-canvas` alongside the WebGPU-specific
`histogram-fast-webgpu-host` and `histogram-fast-webgpu-canvas` classes.
Existing host-rendered axes, brushes, committed selection, hover, measurement,
tooltips, and custom overlays therefore stay backend-neutral.

The WebGPU entry point re-exports the complete `m-histogram` public surface and
keeps `createHistogramPlot` as an alias of `createHistogramWebgpuPlot`.
Compatibility tests compare both TypeScript and runtime exports. Raw and bar
mode keep the same:

- `HistogramColumns`, `HistogramPlotSpec`, aggregation, viewport, bin-size,
  theme, mode, focus, hover, and selected-source inputs.
- default/custom bindings and `plot.use(...)`;
- commands, events, callbacks, render snapshots, and overlay descriptors;
- selection filters, provenance, source-index materialization, and controlled
  updates.

The renderer- and aggregation-neutral engine extraction is also used by the
existing WebGL2 factory. Its public constructor, renderer factory field,
context lifecycle, and TypeScript aggregation behavior remain compatible.

## Source-copy migration

Keep the existing `plot-engine`, `m-histogram/core`, and
`m-histogram/engine` copies. Add:

```text
packages/m-charts/src/plot-engine-webgpu
packages/m-charts/src/m-histogram-webgpu/core
packages/m-charts/src/m-histogram-webgpu/engine
packages/m-charts/src/m-histogram-webgpu/adapters # live streams only
```

The shared WebGPU folder contains adapter/device helpers, timestamp profiling,
and the generated aggregation binary used by scatter and histogram. Keep its
relative relationship to both chart folders. Add `@webgpu/types` when the
host's DOM declarations do not include WebGPU.

Then change only the constructor import:

```diff
- import { createHistogramPlot } from './vendor/m-charts/m-histogram/engine/index.js';
+ import { createHistogramPlot } from './vendor/m-charts/m-histogram-webgpu/engine/index.js';
```

See
[the copy-ready migration and fallback example](../../docs/examples/histogram-webgpu-migration.md)
for a complete host lifecycle.

## Readiness and device lifecycle

Creation is synchronous; WebGPU startup is asynchronous. Both `interactive`
and `ready` resolve after adapter/device setup, exact instance upload, first
frame submission, and queue completion. Both reject when initialization fails.
Applications should handle rejection and dispose the failed instance.

Device loss emits the compatible `contextlost` lifecycle and changes render
state to `rendering`. Nonintentional loss attempts a fresh adapter/device
initialization, rebuilds GPU resources from the retained normalized
aggregation, and emits `contextrestored` after the recovered exact frame.
Recovery failure reports through the shared error/render-state lifecycle.

WebGPU requires a secure context and a browser/device that can return a WebGPU
adapter. `diagnoseWebgpuSupport()` can screen for basic support, but a startup
`try`/`catch` is still required because feature exposure does not guarantee
device creation, shader setup, or successful submission. A host that supports
WebGL2 fallback must dispose the partial WebGPU plot before constructing the
WebGL2 plot in the same element.

## Aggregation contract

Rust/WASM is used only when exact equivalence can be preserved. Compatible raw
input has:

- a typed `Float32Array`, `Float64Array`, `Uint8Array`, `Uint16Array`, or
  `Uint32Array` continuous value column, and an unsigned integer typed column
  for every categorical/boolean parameter;
- an explicit domain for every parameter;
- categorical/boolean values encoded sequentially in display order;
- either no color column or one packed `Uint32Array` rgba32 value per row.

The Rust result preserves TypeScript bin descriptors, continuous resolution,
populated domains, invalid/out-of-domain metrics, stack insertion order,
selected counts, hover state, and exact source-index membership. Unsupported
input falls back as a whole to the TypeScript provider. In particular, strings,
inferred domains, non-sequential categories, rgba8 colors, and out-of-row-range
custom selected source indices do not produce an approximate WASM result.

WebGPU defers raw source membership during normal viewport and bin-size
rebuilds. Selection still reports the exact sum of selected bin counts and
query-ready bin filters immediately, with an empty source-index array marked
pending. `materializeSelectionSourceIndices()` or
`materializeVisibleMembership()` asks the Rust/WASM session to produce exact
visible record IDs. Cached membership for unchanged subplots is retained.

The renderer consumes the shared normalized histogram buffers. It uses one
instanced draw when visible instances exist, and renders background, grid,
bars/stacks, selection/hover overlays, separators, and out-of-range markers
without bar reduction.

## Diagnostics and metrics

`plot.getWebgpuDiagnostics()` reports:

- `initialized`, `canvasFormat`, device buffer limits, and timestamp-query
  support;
- upload bytes and last CPU render-submission time;
- requested and active aggregation backends, build count, last build time, and
  fallback reason; and
- nested aggregation setup bytes/time, indexed-row count, rows visited by the
  latest build, reused-subplot count, and build metrics.

The existing `metrics` event continues to report init, aggregation,
buffer-upload, render, selection, and disposal phases. GPU duration is
included when `requestTimestampQuery: true` and the adapter supports the
optional feature.

## Demo and validation

- `/m-histogram-webgpu`, `?points=10000000`, and `?points=25000000` load the
  shared browser-generated paged dataset.
- `?tables=multi` adds the fixed secondary table.
- `?histMode=bar` exercises pre-aggregated stacked bars.
- `?aggregationBackend=auto|rust-wasm|typescript` recreates the plot with the
  requested backend while preserving URL-owned state.
- `/m-histogram-webgpu-fixture` is the small direct-package fixture.

Run the publication checks:

```sh
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
pnpm lint:rust
pnpm check:aggregation-wasm
```

The normal end-to-end suite verifies routing and the unavailable-WebGPU state.
Run the hardware-backed exact-frame smoke test on a WebGPU-capable Linux host:

```sh
M_CHARTS_ENABLE_WEBGPU_E2E=1 pnpm test:e2e
```

The checked-in WASM payload is reproducible from Rust source:

```sh
pnpm build:aggregation-wasm
pnpm check:aggregation-wasm
pnpm benchmark:histogram:webgpu
```

The compatibility and aggregation unit tests verify export parity, shared
engine separation, WASM/TypeScript descriptors and metrics, categorical
invalid values, colors, hover, selected counts, domains, indexed visible-row
visits, exact WASM membership, subplot reuse, and custom source-index fallback.
