# Scatter WebGPU

`m-scatter-webgpu` is an alternative renderer over the same public scatter
contract, designed for larger resident datasets and bounded GPU work rather
than a different interaction model. It preserves the `m-scatter` columns,
viewport, styling, commands, events, bindings, overlays, and interaction
semantics while leaving the WebGL2 renderer and its routes unchanged.

Settled point views render every visible point through one million points per
subplot. Denser views render a deterministic sample capped at one million
representatives per subplot; zooming to at most one million visible points
returns to an exact stride-one view. Rectangle/lasso selection and their
payloads still evaluate the complete CPU data. Hover and the selected GPU
overlay follow the rendered sample, so those visual layers refine with the
point view rather than displaying every selected or hoverable source point in a
sampled overview.

Point, bubble, and heat-map visualization modes share the same factory and
controlled `visualizationMode` option. Bubble/heat-map hover, measurement,
selection, wheel adjustment, palette, bin-size, point-size, and theme behavior
matches the WebGL2 scatter.

## Import And Lifecycle

The package import below is the local workspace/future package boundary.
`m-charts` is not published to npm yet; external consumers currently use the
source-copy path described below.

```ts
import {
  calculateScatterDomain,
  createDefaultScatterBindings,
  createDefaultScatterViewport,
  createFastScatterPlot,
} from 'm-charts/m-scatter-webgpu';

const plot = createFastScatterPlot(host, {
  aggregationBackend: 'auto',
  axisMode: 'xy',
  columns,
  indexedStyle: false,
  mode: 'pan',
  spec,
  viewport: createDefaultScatterViewport(
    calculateScatterDomain(columns, spec),
  ),
});

plot.use(createDefaultScatterBindings());
await plot.interactive;
await plot.ready;
```

The WebGPU entry point is a superset of the `m-scatter` entry point. Existing
WebGL2 imports can therefore switch the module path while retaining the same
factory name, option object, bindings, overlay helpers, commands, events, and
callback payload types:

```diff
- import { createFastScatterPlot } from 'm-charts/m-scatter';
+ import { createFastScatterPlot } from 'm-charts/m-scatter-webgpu';
```

Existing source-copy consumers keep `m-scatter/core` and the shared scatter
contract, add `plot-engine-webgpu`, `m-scatter-webgpu/core`, and
`m-scatter-webgpu/engine`, then change the factory import:

```diff
- import { createFastScatterPlot } from './vendor/m-charts/m-scatter/engine/index.js';
+ import { createFastScatterPlot } from './vendor/m-charts/m-scatter-webgpu/engine/index.js';
```

Use the engine barrel in framework-neutral copied hosts. The top-level
`m-scatter-webgpu/index.ts` re-exports the full `m-scatter` barrel, including
optional React helpers. See the
[source-copy migration and WebGL2 fallback guide](../../docs/source-copy-integration.md#migrating-an-existing-webgl2-scatter)
and its [copy-ready example](../../docs/examples/scatter-webgpu-migration.md).

The WebGL2 creation-only fields `forceWebglUnavailable`,
`preserveDrawingBuffer`, and `rendererFactory` are accepted and ignored by the
WebGPU factory so a shared option object does not require conditional cleanup.
WebGPU adds four creation-only fields: `aggregationBackend`, `indexedStyle`,
`packedStyles`, and `requestTimestampQuery`. Recreate the plot to change any of
those four; `plot.update(...)` remains for the shared mutable scatter options.

Creation remains synchronous so it fits the existing scatter lifecycle.
`plot.interactive` resolves after the first displayed frame. `plot.ready`
resolves after the first complete settled frame; inspect `settledExact` to
distinguish a stride-one view from a sampled high-density view.
Both reject
with a useful WebGPU availability, limit, allocation, or shader error.
The shared `renderstate`/`renderstatechange` events enter `ready` when the first
interactive WebGPU frame is available and enter `error` if initialization or
recovery fails. Device loss and successful recovery emit the same
`contextlost`, `contextrestored`, and `metrics` events used by WebGL2.

## Availability And Fallback

WebGPU requires a secure context and an adapter/device whose limits can hold the
requested dataset. `diagnoseWebgpuSupport()` from `plot-engine-webgpu` reports
whether `navigator.gpu` and an adapter are available, but callers must still
handle `plot.interactive` or `plot.ready` rejection because dataset limits,
allocation, device, and shader failures occur after basic feature detection.

Products that still support WebGL2-only clients can retain both factories,
attempt WebGPU, dispose the partial WebGPU instance if startup rejects, and then
create the original WebGL2 scatter in the same host. Products that require
WebGPU can instead surface the rejection as an initialization error. Fallback is
host policy; the library does not silently change renderers.

Add `@webgpu/types` to TypeScript builds whose DOM declarations do not yet
include WebGPU globals. This affects type checking only and does not enable
WebGPU at runtime.

`aggregationBackend` is a WebGPU-only creation option passed to
`createFastScatterPlot(...)` or `createScatterPlot(...)`; it is not an option on
the WebGL2 `m-scatter` factory and it does not affect point mode. It accepts
`auto` (the default), `rust-wasm`, or `typescript`. Both `auto` and `rust-wasm`
prefer the resident Rust/WebAssembly builder for supported sorted-X bubble and
heat-map inputs. `rust-wasm` is a preference rather than a strict requirement:
unsupported inputs or initialization/build failures use the exact TypeScript
builder. Choose `typescript` to bypass WebAssembly explicitly. Recreate the
WebGPU plot to change this creation-time choice.
`getWebgpuDiagnostics()` reports readiness, point count, selected count,
timestamp-query support, resident upload/cache bytes, cache readiness, and
submitted/coalesced frame counts. Compare `aggregationBackendPreference` with
the active `aggregationBackend` to detect fallback.

## Rendering Design

- `Float64Array` axes are normalized into GPU `f32` storage buffers using a
  per-axis offset and scale. Existing `Float32Array` values upload directly,
  while byte-valued axes remain byte-packed. This avoids redundant 10M-row
  conversion passes without changing the public CPU columns.
- Each point's color, opacity, shape, signed rotation, and size are packed into
  one 32-bit GPU record using RGB565, 4-bit opacity, 6-bit rotation, and 3-bit
  size quantization. Every point remains independently styled. Existing 8-byte
  and legacy 12-byte packed inputs are converted during bounded upload.
- Packed styles larger than one storage-binding limit use two physical GPU
  buffers, avoiding oversized single allocations while preserving source order.
- Callers with an already packed `Uint32Array` can pass `packedStyles`; the
  renderer uploads those records directly instead of retaining expanded style
  columns and repacking them during initialization.
- Datasets without per-point style columns bind one shared 4-byte default
  style record instead of allocating a record for every point.
- `indexedStyle: true` makes a style-free dataset derive deterministic color,
  opacity, shape, rotation, and size variation from each point index in WGSL.
  It adds no per-point CPU or GPU style allocation and is ignored when style
  columns are present.
- Large coordinate and style buffers upload in bounded chunks instead of using
  one large mapped-at-creation allocation.
- Glyphs use a four-vertex triangle strip and WGSL shape tests for circle,
  rectangle, triangle, pin, and arrow styling.
- Pipeline constants specialize point storage and style modes;
  byte/16-bit/f32 Y, generated/general X, and style modes;
  a resident rotation lookup removes repeated trigonometry for real per-point
  rotation values.
- Sorted X data uses binary-search instance bounds, so zoomed views draw only
  the visible X span. Unsorted inputs retain correct shader culling.
- Selections upload a one-bit membership mask, bounding 25M selection storage
  to about 3 MiB instead of 100 MiB.
- Bubble and heat-map modes use a compact 32-byte aggregate instance and one
  WebGPU draw per subplot. Aggregate buffers replace the point glyph pass; the
  original coordinate/style buffers remain shared and resident when switching
  modes.
- Bubble aggregation preserves exact duplicate `(x, y)` counts and sorted
  membership for interaction, while retaining a deterministic maximum of one
  million visible bubbles per subplot. The largest bubble is always retained.
  This bounds a mostly-unique 25M dataset to about 32 MiB of bubble instance
  storage instead of attempting a 25M-instance allocation.
- Heat-map output is bounded by the pixel-derived cell grid. Its CPU interaction
  membership uses two typed passes and one packed source-index array instead of
  millions of JavaScript arrays, while the GPU receives populated cells only.
- Bubble and heat-map aggregation use the embedded Rust/WASM backend by default
  for sorted X input. Compact source columns are copied once when an aggregate
  mode is first entered and stay resident in WASM linear memory. Later viewport,
  bin-size, and selection builds read those resident columns and expose result
  arrays as direct memory views, avoiding request serialization and per-build
  input/result copies. The exact TypeScript builders remain the automatic
  fallback when WASM or sorted-X acceleration is unavailable.
- `getWebgpuDiagnostics()` reports `aggregationBackend` and
  `aggregationWasm`, including setup/build timing, resident/setup bytes, binary
  identity, build count, active allocation bytes, and the non-shrinking linear
  memory high-water mark. Returning to point mode releases the optional WASM
  session while preserving the original point coordinate/style GPU buffers.
- One X buffer is shared across subplots. Repeated Y keys share their encoded
  GPU buffer.
- `Uint8Array` categorical and boolean Y columns remain packed at one byte per
  point. Scaled `Uint16Array` continuous columns pack two values per GPU word;
  general continuous columns retain normalized `f32` storage.
- Settled frames render every visible point through one million points per
  subplot. Denser views use a deterministic, source-ordered sample capped at
  one million representatives per subplot, including categorical, numeric
  extrema, and maximum-size must-keep representatives.
- Continuous viewport previews composite a 1.5x overscanned, native-pixel-density
  version of the last complete cache. Explicit
  preview/commit metadata replaces the former fixed settle timer, including a
  cached target preview for discrete box zoom before the next settled sample.
- Interaction submissions do not wait for queue-completion fences, and newer
  settled work coalesces while one submitted frame is outstanding.
- WebGPU timestamp queries use a nonblocking three-slot readback ring when the
  adapter exposes the optional feature.
- Device limits are checked before storage allocation, and device loss triggers
  a fresh adapter/device initialization for nonintentional losses. When a real
  styled dataset needs more than the portable storage-binding baseline, the
  renderer requests the required adapter limit and reports a precise failure if
  the adapter cannot provide it.

Coordinate and style WebGPU resources stay resident across viewport,
visualization-mode, point-size, opacity, theme, hover, and selection updates.
Aggregate instance buffers rebuild only when aggregate geometry, membership,
selection fractions, or colors change. Columns/spec replacements rebuild the
resource set asynchronously and yield periodically during large CPU encodes.
Bubble radius scale and uniform theme color are applied in WGSL, so point-size
and bubble-theme updates do not rebuild aggregation or instance storage.
Heat-map palette/theme updates recolor populated instances without rebuilding
counts or exact membership.
Hover-only state updates do not submit a new WebGPU frame because hover guides
and tooltips are rendered by the overlay layer.

## Compatibility And Interaction

The WebGPU factory structurally reuses the mature scatter engine and default
bindings. The command and event surface therefore stays the same for zoom,
pan, rectangle/lasso selection, hover inspection, measurement, point markers,
navigator control, viewport undo, cursor state, overlays, and controlled
updates.

The renderer-owned `playEasterEgg()` implementation works on WebGPU as well as
WebGL2. The default typed `future` sequence temporarily replaces the first
rendered subplot and restores it after playback.

Point markers remain point-mode-only, matching WebGL2. Bubble inspection uses
the retained aggregate LOD at high density. Heat-map rectangle/lasso selection
selects complete cells, and aggregate hover/measurement exposes the same count,
axis bounds, membership span, and sample IDs as the WebGL2 renderer.

Wheel zoom bursts emit coalesced `preview` viewport events at animation-frame
cadence and one `commit` event after the burst becomes idle. Pan and navigator
previews likewise stay on the imperative renderer path; controlled React/URL
state and diagnostic overlays publish at commit instead of invalidating the
GPU cache on every pointer event.

The generated host and canvas retain the backend-neutral
`scatter-fast-engine-host` and `scatter-fast-engine-canvas` classes in addition
to the WebGPU-specific `scatter-fast-webgpu-host` and
`scatter-fast-webgpu-canvas` classes. Existing host-owned overlays such as
hover info can keep using the shared overlay element, commands, and events.

Generated integer/overlap X columns subtract a viewport-relative integer origin
before conversion to `f32`. This preserves adjacent values through the 25M tail
instead of relying on absolute Float32 integers above 16,777,216.

The ten-million-point route supplies a compact `FastScatterHoverIndexSet`
created asynchronously with `createFastScatterCompactHoverIndex`. It stores one
quantized Y byte per point plus block occupancy masks. These values only reject
impossible candidates; surviving records still use the original CPU columns
for exact nearest-point distance and tie-breaking. The flat typed-array grid
from `createFastScatterHoverIndex` remains the faster option for smaller inputs,
and the sorted-X scan remains the compatibility fallback.

The existing selection command contract returns a complete synchronous
`Uint32Array`. Rectangle/lasso membership therefore remains exact on the CPU.
The selected overlay intersects that exact membership with the current rendered
sample on the GPU, bounding overlay work even when every source point is
selected. Hover uses the same sample membership, including per-subplot must-keep
representatives. Both the normal and selected layers refine together as zoom
reduces the visible range.

## Demo And Benchmark

- `/m-scatter-webgpu`, `?points=10000000`, and `?points=25000000` offer 1M,
  10M, and 25M deterministic datasets. On first use, the selected dataset is
  generated in a Web Worker; 250K-point coordinate and style pages are stored
  in versioned IndexedDB records and reused after reload. The route can delete
  each selected local dataset. Technical sampling and table-composition notes
  are available from the compact **Dataset details** disclosure. Switching
  dataset sizes performs a full-document navigation so the previous JavaScript
  and WebGPU resources are released before the next cached dataset is loaded.
- Changing the WebGPU route's X-axis column or switching between X values and
  X index also performs a full-document navigation. The target axis/mode stays
  URL-backed, while stale viewport ranges are cleared so the new representation
  starts from its correct default domain without overlapping old GPU resources.
- The route's **Single table** / **Multiple tables** control uses a
  full-document navigation and stores multiple-table mode as `?tables=multi`.
  That mode appends the same fixed 1,000-record secondary table generated for
  the WebGL2 mixed-table demo. Shared columns are merged with the selected
  primary size, while `secondarySignal` and `secondaryDrift` remain sparse
  secondary-only plots. `generate:data:local` emits this exact secondary table
  as a small sidecar, so the WebGPU route does not fetch or parse the 1M-record
  mixed-table JSON fixture.
- Browser and CLI generation share the same deterministic page builder. The
  compact format reconstructs the regular timestamp/overlap X column without a
  resident CPU or GPU X buffer.
- `?webgpuData=http` explicitly selects the paged HTTP loader for diagnostics.
  Browser-local generation is the default in development and production.
- The route's **Aggregation backend** selector recreates only the WebGPU plot
  instance and preserves the loaded data, viewport, selection, and styling.
  Its URL state is
  `aggregationBackend=auto|rust-wasm|typescript`, so identical bubble or
  heat-map views can be compared directly. A live status directly below the
  selector reports the implementation that is actually running and calls out
  TypeScript fallback explicitly; advanced diagnostics also show both the
  requested and active backend.
- `/m-scatter-webgpu-fixture` is the small direct-package fixture.

Generate HTTP diagnostic artifacts without constructing a JSON record array or
one monolithic binary buffer:

```sh
pnpm generate:data:webgpu
pnpm generate:data:webgpu:25m
```

The generator uses the same seeded record function and schema as the WebGL2
scatter-fast dataset. It writes 250,000-record binary pages under
`apps/demo/public/data`; generated pages are local artifacts and are ignored by
Git. Categorical/boolean Y columns use one byte per point, signal values use a
scaled 16-bit column, and the five style fields use one 32-bit record. Version 6
artifacts omit the derivable X column.
Coordinate/Y pages remain available on the CPU for exact selection and sampled
hover lookup. Separate
style pages prefetch one page ahead and stream directly into persistent GPU
style buffers. This compact layout is manifest version 6. Versions 2–5 remain
readable and are converted one bounded page at a
time; regenerate local artifacts with `pnpm generate:data:webgpu` to receive
the smaller files.

The route builds full two-dimensional hover indexes eagerly through one million
points. Larger inputs build compact exact-filter indexes with yielding passes,
avoiding three additional 32-bit point-index arrays. Paged routes also
avoid full-length table/record identity arrays; IDs and the single table name
remain lazy. GPU uploads drain after bounded groups of chunks to prevent queue
staging from accumulating a second large transient copy.

## Streaming Sources

`m-scatter-webgpu/adapters` accepts finite record streams with a known count.
The loader preallocates final typed columns once, encodes bounded batches, and
releases each input batch. This is bounded-memory ingestion, not live append
rendering: the WebGPU plot is created after all declared records have been
encoded. Existing callers can continue passing `columns`.

```ts
const source = createFastScatterJsonRecordBatchSource(file.stream(), {
  batchSize: 16_384,
  count: 10_000_000,
  idAt: (index) => `sf-${String(index).padStart(8, '0')}`,
  schema,
});

const plot = await createFastScatterWebgpuPlotFromDataSource(host, {
  axisMode: 'xy',
  dataSource: source,
  mode: 'pan',
  onStreamProgress: ({ loadedCount, totalCount }) => {
    console.log(loadedCount, totalCount);
  },
});
await plot.ready;
```

Use `File.stream()`, a streamed `fetch()` response, or an application-owned
`AsyncIterable` of record batches. Do not call `response.json()`, `file.text()`,
or `JSON.parse()` for ten-million-record inputs: doing so creates the complete
string/object graph before the bounded loader can help. The finite source must
declare its record count so typed arrays never grow and copy during ingestion.
WebGPU streams store Y values as `Float32Array` by default and can use `idAt`
to keep predictable IDs lazy. Set `numericStorage: 'float64'` or omit `idAt`
when the source requires full double precision or arbitrary materialized IDs.

Use the opt-in WebGPU smoke suite on Linux:

```sh
M_CHARTS_ENABLE_WEBGPU_E2E=1 pnpm test:e2e
```

The checked-in WASM payload is reproducible from the Rust source:

```sh
pnpm build:scatter-wasm
pnpm check:scatter-wasm
pnpm lint:rust
```

Run the dedicated benchmark on the stronger benchmark computer:

```sh
pnpm benchmark:scatter:webgpu -- --count 10000000 --frames 180 --runs 3
pnpm benchmark:scatter:webgpu -- --count 25000000 --visualization-mode bubble
pnpm benchmark:scatter:webgpu -- --count 25000000 --visualization-mode heatmap
```

Add `--max-frame-p95 16.7` when the named reference machine should enforce the
60 Hz p95 gate.

The benchmark reports cold route readiness (including the first completed settled
frame), rendered point count, upload and
cache bytes, coalesced frames, cached-frame use, viewport and point-size
submission latency, synthetic animation cadence, real wheel/pan submission
latency, refinement-contention latency, hover latency, long tasks, draw calls,
adapter diagnostics, cached/exact GPU time when supported, and median/p95/p99
animation-frame intervals, including the active rendered sample size and stride.
Aggregate-mode runs also report the Rust/WASM backend, one-time residency setup,
zero-copy build count/time, and linear-memory footprint.
