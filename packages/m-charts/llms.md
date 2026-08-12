# m-charts Integration Guide

This file is the detailed integration reference for agents and humans using the
`m-charts` package in another application. It documents the reusable WebGL2 and
WebGPU plot library in this repository. WebGL2 powers scatter, histogram, and
parallel-coordinate engines; WebGPU is an alternative point, bubble, and
heat-map scatter renderer, histogram renderer, and pairwise-density parallel
renderer over the same respective public contracts.

`m-charts` is not published to npm yet, and `npm install m-charts` is not a
supported consumer path. The current public usage path is source-copy
integration: copy the relevant `packages/m-charts/src` plot-engine and chart
logic into the host application, then rewrite imports to the copied local module
paths.

The package imports below describe the local workspace/demo build surface and
the intended package boundary for a future package release:

```ts
import { createEmitter } from 'm-charts/plot-engine';
import { createScatterPlot } from 'm-charts/m-scatter';
import { createScatterPlot as createWebgpuScatterPlot } from 'm-charts/m-scatter-webgpu';
import { createHistogramPlot } from 'm-charts/m-histogram';
import { createHistogramPlot as createWebgpuHistogramPlot } from 'm-charts/m-histogram-webgpu';
import { createParallelPlot } from 'm-charts/m-parallel';
import { createParallelPlot as createWebgpuParallelPlot } from 'm-charts/m-parallel-webgpu';
```

The demo routes in `apps/demo` are integration examples, not the library API.
Routes own React state, URL state, side panels, exports, popovers, diagnostics,
generated data loading, and host-specific product policy.

## Source Layout

Reusable package source lives under:

```text
packages/m-charts/src/plot-engine/core
packages/m-charts/src/plot-engine-webgpu/core
packages/m-charts/src/m-scatter/core
packages/m-charts/src/m-scatter/engine
packages/m-charts/src/m-scatter-webgpu/core
packages/m-charts/src/m-scatter-webgpu/engine
packages/m-charts/src/m-histogram/core
packages/m-charts/src/m-histogram/engine
packages/m-charts/src/m-histogram-webgpu/core
packages/m-charts/src/m-histogram-webgpu/engine
packages/m-charts/src/m-parallel/core
packages/m-charts/src/m-parallel/engine
packages/m-charts/src/m-parallel-webgpu/core
packages/m-charts/src/m-parallel-webgpu/engine
```

Optional package helpers live under visualization `adapters`, `react`,
`testing`, and scatter `workers` subtrees. Keep demo routes, generated data,
benchmark scripts, and e2e hooks outside reusable library code.

## Migration From Direct Source Imports

The package preserves the public custom-plot API as far as possible. Existing
users of the previous direct-source layout should mainly replace import paths:

```text
src/plot-engine/... -> packages/m-charts/src/plot-engine/...
src/scatter/...     -> packages/m-charts/src/m-scatter/...
src/parallel/...    -> packages/m-charts/src/m-parallel/...
src/histogram/...   -> packages/m-charts/src/m-histogram/...
```

Inside this monorepo, prefer package imports from `m-charts/*`. For external
source-copy integrations, rewrite those imports to the copied local module
paths. Compatibility aliases are also available for `m-charts/scatter`,
`m-charts/parallel`, and `m-charts/histogram` in local workspace builds.

## Migrating Existing WebGL2 Scatter To WebGPU

Treat WebGPU as a renderer switch, not a new chart contract. Keep the existing
scatter columns, spec, viewport, options, bindings, commands, events, overlays,
callback payloads, controlled updates, and shared CSS hooks.

For a workspace package consumer, retain the factory name and change only the
entry point:

```diff
- import { createScatterPlot } from 'm-charts/m-scatter';
+ import { createScatterPlot } from 'm-charts/m-scatter-webgpu';
```

For the supported external source-copy path:

1. Keep `plot-engine`, `m-scatter/core`, and `m-scatter/engine`.
2. Add `plot-engine-webgpu`, `m-scatter-webgpu/core`, and
  `m-scatter-webgpu/engine`; add `m-scatter-webgpu/adapters` for known-count
  record streams or unknown-count live typed-batch streams.
3. Keep data/core imports from `m-scatter/core` and change the factory import
   from `m-scatter/engine/index.js` to
   `m-scatter-webgpu/engine/index.js`.
4. Add `@webgpu/types` when host TypeScript DOM declarations lack WebGPU.
5. Await `plot.interactive` for the first displayed frame or `plot.ready` for
   the first complete settled frame, and handle rejection.
6. If WebGL2 fallback is product policy, call `diagnoseWebgpuSupport()`, attempt
   WebGPU, dispose a failed partial WebGPU instance, then create the original
   WebGL2 scatter in the same host. Feature detection alone does not cover
   dataset-specific device limits, allocation, or shader failures.

The WebGL2-only creation fields `forceWebglUnavailable`,
`preserveDrawingBuffer`, and `rendererFactory` are accepted and ignored by the
WebGPU factory. WebGPU adds the creation-only `aggregationBackend`,
`indexedStyle`, `packedStyles`, and `requestTimestampQuery` options; recreate
the plot to change them. The command surface is retained, including
renderer-owned `playEasterEgg()` playback on both backends. The full human guide
and copy-ready fallback example are in
`docs/source-copy-integration.md` and
`docs/examples/scatter-webgpu-migration.md`.

## Migrating Existing WebGL2 Histogram To WebGPU

Treat WebGPU histogram as a renderer and raw-aggregation backend switch. Keep
the histogram columns or bar aggregation, spec, viewport/bin-size state,
options, bindings, commands, events, overlays, callbacks, controlled updates,
and shared CSS hooks.

For a workspace package consumer:

```diff
- import { createHistogramPlot } from 'm-charts/m-histogram';
+ import { createHistogramPlot } from 'm-charts/m-histogram-webgpu';
```

For source-copy integrations:

1. Keep `plot-engine`, `m-histogram/core`, and `m-histogram/engine`.
2. Add `plot-engine-webgpu`, `m-histogram-webgpu/core`, and
   `m-histogram-webgpu/engine`.
3. Keep utility/data imports from `m-histogram/core` and change the factory
   import to `m-histogram-webgpu/engine/index.js`.
4. Add `@webgpu/types` when host TypeScript DOM declarations lack WebGPU.
5. Await `plot.ready`, handle rejection, and dispose failed instances.
6. If WebGL2 fallback is product policy, diagnose WebGPU, attempt startup, then
   create the original WebGL2 histogram only after failed WebGPU cleanup.

The WebGL2-only `forceWebglUnavailable`, `preserveDrawingBuffer`, and
`rendererFactory` fields are accepted and ignored. WebGPU adds the
creation-only `aggregationBackend` and `requestTimestampQuery` options.
`aggregationBackend` accepts `auto`, `rust-wasm`, or `typescript`; the first
two prefer exact Rust/WASM aggregation for supported typed columns and use the
exact TypeScript builder for unsupported shapes. Exact membership
materialization stays in Rust/WASM for supported inputs. Pre-aggregated bar
mode does not run raw aggregation.

For a live typed source, use `createHistogramWebgpuStreamingPlot` and replace
`columns`/`spec` with `dataSource: { batches, spec }`. Async batches contain
`{ columns: HistogramColumns }`. The first non-empty batch creates the plot;
later geometrically growing prefixes and the final prefix are aggregated
exactly while interaction stays attached.
Optional `expectedCount`/`initialCapacity`, `viewportPolicy`, progress,
cancellation, `streaming.done`, and `streaming.getColumns()` match the WebGPU
scatter lifecycle.

The full human guide and copy-ready fallback example are in
`packages/m-charts/HISTOGRAM_WEBGPU.md`,
`docs/source-copy-integration.md`, and
`docs/examples/histogram-webgpu-migration.md`.

## Migrating Existing WebGL2 Parallel Coordinates To WebGPU

Keep `ParallelBuffers`, bindings, commands, brush/selection events, overlays,
themes, inspection payloads, and controlled updates. Change the factory entry:

```diff
- import { createParallelPlot } from 'm-charts/m-parallel';
+ import { createParallelPlot } from 'm-charts/m-parallel-webgpu';
```

For source-copy integrations, retain `plot-engine`, `m-parallel/core`, and
`m-parallel/engine`; add `plot-engine-webgpu`, `m-parallel-webgpu/core`, and
`m-parallel-webgpu/engine`. Await `plot.interactive` or `plot.ready`, handle
rejection, and dispose before creating a WebGL2 fallback.
Use regular parallel buffers for a dual-backend fallback; compact
`createParallelWebgpuBuffers` output intentionally omits WebGL line/segment
expansion. The copy-ready example is
`docs/examples/parallel-webgpu-migration.md`.

The WebGPU entry is an export/type superset. Its creation-only options are
`aggregationBackend`, `binResolution`, `directSegmentLimit`, `renderMode`,
`representativeRecordLimit`, and `requestTimestampQuery`.
`createParallelWebgpuBuffers` omits line-series/WebGL expansion for large
WebGPU-only data, reuses compact raw/style views, and derives normalized CPU
values on demand. Its optional second argument accepts exact prepared domains,
missing counts, trusted encoded typed columns, and an asynchronous packed-page
source. Demo page decoding uses that source to fuse and stream work from a
worker. Large inputs store two
16-bit normalized values per GPU word and keep compact RGBA4444 density styles
resident. Viewport aggregation therefore avoids repeated CPU repacking and GPU
uploads while retaining RGBA8 for the bounded representative styles. The
full-population density path remains 16-bit, while committed hybrid refinement
reads back only bounded source indices and uploads raw-derived,
viewport-relative Float32 detail coordinates. Refined direct lines and GPU
hover therefore share the exact overlay geometry at deep zoom without a
full-column CPU scan.
For hybrid rendering, `interactive` resolves after the exact-style
representative frame and `ready` after the full-population density frame.
Device loss/restoration and renderer metrics retain the shared typed engine
event and option-callback paths.

For live data, use `createParallelWebgpuStreamingPlot` and replace `buffers`
with `dataSource: { batches, domainsByAxis }`; batches contain
`{ columns: ParallelFastColumns, packedPage? }`. `packedPage` carries optional
GPU-ready `{ start, count, values, densityStyles }` arrays. Prepared full-stream domains keep all
previously visible lines stable. The adapter preserves brushes and axis
viewports, retains CPU columns as segmented views, appends packed pages to
resident GPU storage, and increments only the incoming page's density
contribution while capacity is available. Unknown capacity grows geometrically;
non-packed sources use geometrically growing replacement prefixes. Progress,
abort, `streaming.done`, and
`streaming.getBuffers()` follow the scatter streaming shape.

Every source row contributes to pairwise adjacent-axis screen bins. Density
stores count and quantized premultiplied color statistics; selected and
preselected bins are independent uniform-color overlays. Direct mode draws all
lines for small data, while large data combines density with deterministic
exact-style representatives. Representatives prioritize per-axis extrema and
categorical coverage, retain local category/extrema coverage across
source-order blocks, and use pseudo-randomized bucket sampling for the
remaining bounded capacity. A two-pass GPU reduction resolves hover against
all records in direct/density-only modes and against the currently drawn
population in hybrid mode, mapping the winner back to its public source index.
Hybrid hover uses a two-pixel exact-detail fast path, then a coalesced
full-population GPU fallback for density-only and overflow segments. Hit tests
at an axis include both adjacent pairs, and the winning compact candidate is
revalidated against raw viewport geometry before inspection is published.
Committed hybrid viewports fuse a bounded GPU compaction into the affected-pair
density pass. Records inside every active viewport are deterministically
strided while dense; once the qualified count fits the representative limit,
stride one renders every qualifying line. Preview continues to use the static
representatives. The completed pass performs only a bounded source-index
readback and detail-coordinate upload, so no full-data CPU scan or second
full-data GPU pass blocks gestures.

Axis viewports are independent of brushes. Left-drag a brush-like vertical box
to zoom the nearest axis only; middle-drag pans that one axis, middle-click
undoes, and `resetAxisViewports()` restores domains. Pointer drags update only
the lightweight overlay and commit the viewport once on release, avoiding live
line/density recomputation. A commit recomputes only density pairs adjacent to
axes whose viewport changed. Programmatic previews can still emit
`axisviewportpreview`; committed gestures emit `axisviewportchange`.
Out-of-viewport values route to fixed above/below rails, distinct from the
neutral missing-value rail. Hosts can use
`ParallelBuffers.missingValueCountByAxis` to show missing-value affordances
only where they apply; keeping all rail coordinates reserved avoids layout
movement when zoom state changes.
The demo persists committed parallel viewports as
`pf.<axis>.min`/`pf.<axis>.max` and restores them through the existing
`axisViewports` option; previews do not write the URL. Hover projection uses
display-space interpolation so rail-to-axis markers stay on rendered lines.

The GPU pass provides immediate membership/density. Exact public source-index
selection uses Rust/Wasm through two million rows when its retained typed copy
is bounded, then uses the source-column implementation for larger data rather
than duplicating a large dataset in Wasm. See
`packages/m-charts/PARALLEL_WEBGPU.md`.

## Architecture Mental Model

The isolated `m-scatter-webgpu` package imports the public scatter contract and
engine, supplies a WebGPU renderer factory, and adds `interactive` and `ready`
promises plus
WebGPU diagnostics. It supports point, bubble, and heat-map modes. Commands, events, overlays,
bindings, selection payloads, hover, measurement, and marker behavior remain
the scatter contract (markers remain point-only). Bubble mode retains exact
duplicate counts in a bounded one-million-aggregate LOD per subplot. Heat-map
mode uploads populated cells only and uses packed typed membership for complete
cell hover and selection. Sorted-X aggregate modes default to an embedded
Rust/WASM resident-memory session: source columns copy once, repeated builds
and result views are zero-copy, and `aggregationBackend`/`aggregationWasm`
diagnostics expose setup, build, binary, and resident-memory details. The exact
TypeScript builders are the automatic compatibility fallback. The WebGPU plot
option `aggregationBackend?: 'auto' | 'rust-wasm' | 'typescript'` permits
explicit profiling; diagnostics expose the requested value as
`aggregationBackendPreference` and the implementation that ran as
`aggregationBackend`.
`indexedStyle: true` procedurally derives styles from
point indices when style columns are absent, without per-point style storage;
GPU resources and lifecycle live under
`plot-engine-webgpu` and `m-scatter-webgpu`.
`packedStyles` accepts 4-byte style records directly. Existing 8-byte and legacy
12-byte pages declare their stride for bounded conversion. The paged demo uses
this path with byte-sized categorical/boolean Y columns, scaled 16-bit signals,
and generated X storage. Its 1M/10M/25M pages are generated in a Web Worker and
persisted in versioned IndexedDB storage by default in development and
production; size changes reload the document to release the previous large
allocations, and `?webgpuData=http` enables the diagnostic HTTP page loader.
Immutable coordinate and packed-style buffers are
filled while mapped and unmapped once, avoiding expanded CPU style arrays,
repeated `writeBuffer` staging copies, and queue fences during large-dataset
initialization.
The 25M path uses viewport-relative integer X origins, a 1.5x native-resolution
interaction cache, immediate cached viewport previews, and a settled LOD capped
at one million rendered points per subplot. The LOD renders all visible points
through that threshold and otherwise chooses one deterministic,
source-ordered real point from each contiguous source bucket, preserves that
point's packed style, and reconstructs the skipped bucket's alpha coverage.
Sampling is globally bucket-aligned so nearby settled viewports do not reshuffle
unchanged buckets. When the sorted-X visible range fits the point budget the
stride becomes one and the settled view is exact. Hover considers only the
rendered representatives, and selected overlays intersect the exact selection
with the same sample so both refine with the base points on zoom. Selection
payloads and filters remain exact. High-density views additionally draw
source-ordered must-keep indices produced during compact-hover indexing: all
values for byte-categorical blocks with at most 16 values, numeric Y minima and
maxima, and the largest styled point in each 4,096-point block. This guarantees
the strongest defined categorical, numeric-extrema, and size outliers while the
base sample preserves distribution texture. `settledExact`,
`settledPointCoverage`, `lodPointCount`, `lodPointBudget`, `lodStride`, and
`overviewRepresentativeCount` expose the active tradeoff.

`m-charts/m-scatter-webgpu` is an export/type superset of
`m-charts/m-scatter`: an existing integration can retain
`createFastScatterPlot` or `createScatterPlot` and change only the import path.
The same option object is accepted, including ignored WebGL2 creation fields.
The WebGPU-only `aggregationBackend`, `indexedStyle`, `packedStyles`, and
`requestTimestampQuery` fields are creation-only and are intentionally excluded
from the WebGPU instance's `update` type. Shared host/canvas CSS classes remain
present alongside WebGPU-specific classes. WebGPU initialization, device loss,
recovery, and recovery failure feed the shared render-state, context, and
metrics events; the promise fields remain the more precise startup gates.

Compact hover visits the eligible block nearest the pointer first and expands
outward in sorted-X order. It stops only when the closest possible X distance
of every unvisited eligible block is greater than the exact best 2D distance,
so categorical hover remains exact without scanning the full pixel-radius
window. Point-size changes bypass cached image morphology and render the bounded
settled pass directly; route URL writes are idle-debounced.
The optional `m-scatter-webgpu/adapters` layer provides live append through
`createFastScatterWebgpuStreamingPlot`. It creates the plot after the first
typed-column batch, writes later ranges into persistent GPU buffers, and grows
CPU and GPU capacity geometrically when the final count is unknown. Known
`expectedCount` streams preallocate both stores unless `initialCapacity`
explicitly requests a smaller GPU allocation. `expectedCount` is an optional
allocation hint, not a correctness requirement.
The automatic growing-domain viewport stops following after the first user
viewport interaction. Completion settles the full loaded population; abort or
transport failure rejects `streaming.done` and also settles the retained prefix.
`createFastScatterWebgpuStreamSourceFromRecordBatches`
bridges existing incremental JSON/application record sources; the older
known-count materializing loader remains compatible.
The demo's `?webgpuData=stream-function` path exercises the same bridge against
the real `/api/webgpu-stream` Vercel Function. The response is fixed at 5,000
records, uses protocol/count headers and `no-store`, and is mapped to scatter,
histogram, and parallel typed streams without calling `response.json()`. Large
demo datasets never use the Function. Full protocol and deployment details are
in `docs/server-function-streaming.md`.

The WebGPU demo route accepts the same `tables=multi` URL mode as the WebGL2
scatter route. Its `points` parameter changes only the primary table; a fixed
build-generated 1,000-record secondary-table sidecar supplies the shared and
secondary-only columns without loading the full mixed-table fixture.
The route exposes dataset-size and single-/multiple-table controls, with
sampling and table-composition notes in a collapsed **Dataset details**
disclosure.
Dataset-size, table-mode, X-axis-column, and X-value/index changes use
full-document navigation to avoid retaining both old and new large WebGPU
resource sets. X-axis changes reset stale viewport URL ranges.

The custom plot packages use three layers.

1. `packages/m-charts/src/plot-engine/core`
   Shared, chart-agnostic browser primitives: disposables, typed event emitters,
   normalized DOM pointer/wheel/key input, brush metadata, resize and WebGL2
   lifecycle helpers, geometry, metrics, and RAF scheduling.

   `packages/m-charts/src/plot-engine-webgpu/core` adds WebGPU adapter/device
   lifecycle, support diagnostics, limit snapshots, and timestamp profiling.

2. `packages/m-charts/src/<viz>/core`
   Framework-free visualization logic: typed input contracts, typed-array buffer
   builders, domains, transforms, layout, formatting, hover/inspection lookup,
   selection math, aggregation, and backend-specific renderer helpers.

3. `packages/m-charts/src/<viz>/engine`
   The reusable plot API: creates canvas elements inside a host DOM element,
   owns backend-neutral renderer lifecycle, exposes `plot.commands`, emits typed events through
   `plot.on(...)`, reconciles controlled host state through `plot.update(...)`,
   stores serializable overlay descriptors, supports optional bindings through
   `plot.use(...)`, and disposes DOM/renderer resources. Scatter's WebGL2 and
   WebGPU factories inject separate backend adapters into this shared engine;
   neither renderer is imported by the common engine implementation.

Host applications should treat the engine as an imperative rendering island.
React or another host framework owns data loading, app state, URL/search params,
panel rows, exports, popovers, keyboard policy, overlay rendering, persistence,
and backend query translation.

General contract:

- `plot.update(partialOptions)` is controlled host-state reconciliation. It is
  silent by default and is the right path for React props, restored URL state,
  external selections, style/theme changes, and renderer options.
- `plot.commands.*` is the semantic action API. Default bindings and custom host
  interactions call commands; commands emit events when observers need to react.
- `plot.on(event, handler)` is the typed observation API. Events carry compact
  typed arrays, source indices, brush ranges, filters, viewport phases, reasons,
  and provenance. Materialize records or export text lazily in the host.
- `plot.use(binding)` attaches optional input or integration bindings. The
  default bindings are examples of reusable policy, not hard-coded global input.
- Overlay events carry plain descriptors. Render them in React/SVG/DOM/canvas or
  replace them entirely in another product.

## Package Source Boundaries

The reusable library surface is the package export map plus the framework-neutral
`core` and `engine` source trees. Demo routes are useful examples, but they
are not part of the package API.

Required reusable source groups:

```text
packages/m-charts/src/plot-engine/core
packages/m-charts/src/m-scatter/core
packages/m-charts/src/m-scatter/engine
packages/m-charts/src/m-histogram/core
packages/m-charts/src/m-histogram/engine
packages/m-charts/src/m-parallel/core
packages/m-charts/src/m-parallel/engine
```

WebGPU scatter additionally requires:

```text
packages/m-charts/src/plot-engine-webgpu/core
packages/m-charts/src/m-scatter-webgpu/core
packages/m-charts/src/m-scatter-webgpu/engine
```

Optional helpers:

```text
packages/m-charts/src/m-scatter/react/overlays.tsx
packages/m-charts/src/m-scatter-webgpu/adapters
packages/m-charts/src/<viz>/react/colorRules.ts
packages/m-charts/src/m-scatter/workers
packages/m-charts/src/<viz>/adapters
packages/m-charts/src/<viz>/testing
```

Do not treat demo routes, overview pages, app data loaders, generated datasets,
benchmark scripts, e2e hooks, or local environment files as reusable library
code.

## API Documentation Status

This guide is intended to be usable as the integration reference
for another app. It documents the reusable engine boundary, option shapes,
callbacks, command signatures, event payloads, binding options, selection/filter
handoffs, overlays, and visualization-specific setup examples. The exported
TypeScript types in the package remain the exact compile-time source of
truth; when a type changes, update this guide in the same change.

The most important source files for API verification are:

```text
packages/m-charts/src/<viz>/engine/types.ts
packages/m-charts/src/<viz>/engine/*Commands.ts
packages/m-charts/src/<viz>/engine/*Events.ts
packages/m-charts/src/<viz>/engine/default*Bindings.ts
packages/m-charts/src/<viz>/engine/*Overlays.ts
packages/m-charts/src/<viz>/core/types.ts
packages/m-charts/src/<viz>/core/index.ts
```

## Common Engine API

Each visualization exposes the same host-facing shape:

```ts
interface PlotInstance extends Disposable {
  readonly commands: PlotCommands;
  readonly hostElement: HTMLElement;
  dispose(): void;
  on<K extends EventName>(
    event: K,
    handler: (payload: Events[K]) => void,
  ): Unsubscribe;
  update(options: Partial<PlotOptions>): void;
  use(binding: Binding): Disposable;
}

type Binding =
  | ((plot: PlotInstance) => Disposable | (() => void) | void)
  | { attach(plot: PlotInstance): Disposable | (() => void) | void };
```

Scatter and histogram instances also expose `canvas` and `overlayElement`.
Parallel exposes canvases through commands because it owns a base canvas and a
hover canvas. `update(...)` is for controlled state from the host and should not
be treated as a user intent callback. Commands are semantic actions; they return
computed results where useful and emit typed events when observers need to
react. `on(...)` returns an unsubscribe function. `use(...)` normalizes a
function binding or object binding and returns a disposable.

Callbacks such as `onViewportChange` and `onSelectionChange` are convenience
bridges into the renderer/controller. Prefer `plot.on(...)` in a product shell
when several concerns need to observe the same event. If both callback props and
event subscriptions are used, keep callback work idempotent because both paths
can observe the same semantic transition.

Brush events share this base shape:

```ts
type BrushPhase = 'start' | 'preview' | 'commit' | 'cancel';
type BrushShape = 'rectangle' | 'lasso' | 'axis-range';
type BrushInteractionSource = 'pointer' | 'keyboard' | 'command' | 'route' | 'test-hook';
type BrushDefaultAction = 'zoom' | 'select' | 'none';

interface InputModifiers {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

interface BrushEventBase<TTarget, TRange, TDefaultAction extends string> {
  cssGeometry?:
    | { shape: 'rectangle'; rect: { xCssPx: number; yCssPx: number; widthCssPx: number; heightCssPx: number } }
    | { shape: 'lasso'; points: readonly { xCssPx: number; yCssPx: number }[] }
    | { shape: 'axis-range'; axisCssPx?: number; rangeCssPx?: { min: number; max: number } };
  defaultAction: TDefaultAction;
  modifiers: InputModifiers;
  phase: BrushPhase;
  range?: TRange;
  resolveSourceIndices?: () => Uint32Array | null;
  shape: BrushShape;
  source: BrushInteractionSource;
  target: TTarget;
}
```

Use `defaultAction: 'none'` for host-owned observation flows such as draft
popovers.
Those events describe an observed gesture; they must not implicitly mutate plot
selection. Use `resolveSourceIndices` only when a host explicitly needs
materialized records for export or panel state.

## React Host Pattern

Use a host `div` ref, create the engine in an effect, subscribe to events, attach
bindings, push state back through `update`, and dispose on unmount.
The concrete example below uses the WebGL2 scatter entry point.

```tsx
import { useEffect, useRef, useState } from 'react';
import {
  createDefaultScatterBindings,
  createScatterPlot,
  type ScatterOverlayDescriptor,
  type ScatterPlotInstance,
} from 'm-charts/m-scatter';
import type {
  ScatterDisplayColumns,
  FastScatterPlotSpec,
  FastScatterViewport,
} from 'm-charts/m-scatter';

export function ScatterHost({
  columns,
  spec,
  viewport,
}: {
  columns: ScatterDisplayColumns;
  spec: FastScatterPlotSpec;
  viewport: FastScatterViewport;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<ScatterPlotInstance | null>(null);
  const [selectedSourceIndices, setSelectedSourceIndices] = useState(
    () => new Uint32Array(0),
  );
  const [overlays, setOverlays] = useState<readonly ScatterOverlayDescriptor[]>([]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const plot = createScatterPlot(host, {
      axisMode: 'xy',
      columns,
      mode: 'pan',
      selectedSourceIndices,
      spec,
      viewport,
    });
    const binding = plot.use(createDefaultScatterBindings({
      easterEgg: { sequence: 'future' },
      inputElement: host.parentElement ?? host,
      suppressContextMenu: true,
    }));
    const unsubscribeSelection = plot.on('selectionchange', (event) => {
      setSelectedSourceIndices(event.sourceIndices);
    });
    const unsubscribeViewport = plot.on('viewportchange', (event) => {
      if (event.phase === 'commit') {
        // Store URL/history state in the app here, then feed it back by update.
      }
    });
    const unsubscribeOverlay = plot.on('overlaychange', (event) => {
      setOverlays(event.overlays);
    });
    plotRef.current = plot;

    return () => {
      unsubscribeOverlay();
      unsubscribeViewport();
      unsubscribeSelection();
      binding.dispose();
      plotRef.current = null;
      plot.dispose();
    };
  }, []);

  useEffect(() => {
    plotRef.current?.update({ columns, selectedSourceIndices, spec, viewport });
  }, [columns, selectedSourceIndices, spec, viewport]);

  return (
    <div style={{ height: 720, minWidth: 0, position: 'relative' }}>
      <div ref={hostRef} style={{ height: '100%', position: 'relative' }} />
      <MyScatterOverlay descriptors={overlays} />
    </div>
  );
}
```

The host element must have stable nonzero dimensions. Engines use
`ResizeObserver`; call `plot.commands.resize()` only for layout changes the
observer cannot detect.
`MyScatterOverlay` stands for any host-owned overlay renderer; React hosts can
use `packages/m-charts/src/m-scatter/react/overlays.tsx` as an example, and non-React hosts can
render the same descriptors into SVG, DOM, or canvas.
The example feeds `columns` and `spec` through `update` because those props are
controlled by the host. If a product treats data/spec changes as a new plot
identity instead, dispose and recreate the engine on those identity changes.
For WebGPU, switch the imports and instance type to `m-scatter-webgpu`, observe
`interactive`/`ready` rejection inside the effect, and dispose before any
WebGL2 fallback. The example's Easter-egg binding works unchanged with either
renderer.

## Default Interaction Summary

This is the reference checklist for reimplementing or replacing the reusable
default bindings in another app. These interactions are owned by
`createDefaultScatterBindings`, `createDefaultHistogramBindings`, and
`createDefaultParallelBindings`; renderers do not listen to DOM input directly.

Binding scope:

- Scatter and histogram listen on `inputElement` when supplied, otherwise on
  the plot host's parent element or host element. They also use window listeners
  to finish active drags after the pointer leaves the element and to track held
  `Shift`/`Space`.
- Parallel listens on `inputElement` when supplied, otherwise on the host. It
  can also listen on a separate `keyboardTarget`; use `ignoreKeyboardTarget`
  and `shortcutGate` to keep shortcuts out of text inputs, popovers, or inactive
  route panels.
- `Space` lasso mode in scatter/histogram is ignored for editable targets
  (`input`, `select`, `textarea`, or `contenteditable`). `Q`, `Escape`, and the
  parallel opacity keys are not ignored by the binding itself, so host apps that
  need focus policy should attach the binding to a scoped input surface or add a
  custom gate/wrapper.

Scatter:

- Left drag in a subplot without `Shift`: rectangle zoom. The default axis mode
  is direction-inferred, so horizontal boxes zoom X and vertical boxes zoom Y.
- `Alt` + `Shift` + left drag in a subplot: force combined X/Y rectangle zoom.
- Left drag in the X navigator: pan the shared X viewport window; dragging near
  a navigator edge resizes that window.
- Wheel with no `Alt`/`Shift`/`Ctrl`: request point-size adjustment, or heatmap
  bin-size adjustment in heatmap mode. The host persists the requested value.
- `Alt` + wheel zooms X, `Shift` + wheel zooms Y, and `Ctrl` + wheel zooms X/Y.
  Shift-wheel can use horizontal wheel delta when vertical delta is zero. Zoom
  deltas are accumulated once per animation frame; viewport events use
  `phase: 'preview'` during the burst and emit one `phase: 'commit'` after idle.
- Middle drag pans X/Y. Middle click with no meaningful movement emits
  `viewportundorequest` with source `pointer`.
- `Q` emits the same `viewportundorequest` with source `keyboard`.
- Right drag without `Shift`: rectangle selection.
- `Space` + right drag, or route state `mode: 'lasso'`: lasso selection.
- `Ctrl` with rectangle or lasso selection appends; otherwise selection
  replaces. Subtract selection is not part of the reusable API.
- A right-click without a real rectangle cancels without changing selection.
- Holding `Shift` while moving the pointer performs temporary point/aggregate
  inspection. Releasing `Shift`, blur, or moving without `Shift` clears the
  transient hover.
- `Shift` + right drag starts a measurement guide from the hovered point or
  aggregate and clears it on release/cancel.
- Point mode left double-click on a point: toggle source-index anchored vertical
  marker. Aggregate hits do not toggle markers. Markers survive pan, zoom,
  focused subplot changes, and X value/index changes; non-finite subplots are
  skipped.
- When `easterEgg` is configured on the binding, typing the sequence, default
  `future`, calls `playEasterEgg`. Repeated, prevented, modified, or editable
  target key events are ignored by that sequence handler.
- `Escape` clears committed selection and point markers.

Histogram:

- Left drag in a subplot without `Shift`: rectangle zoom. The default axis mode
  is direction-inferred, so horizontal boxes zoom X and vertical boxes zoom Y.
- `Alt` + `Shift` + left drag in a subplot: force combined X/Y rectangle zoom.
- Wheel with no axis modifier in raw continuous histogram mode: emit
  `binsizeadjustrequest` for the hovered subplot. The host persists/debounces
  the requested bin size and calls `plot.commands.setBinSizes(...)`.
- `Alt` + wheel zooms X, `Shift` + wheel zooms Y, and `Ctrl` + wheel zooms X/Y.
  Shift-wheel can use horizontal wheel delta when vertical delta is zero.
- Middle drag pans X/Y. Middle click with no meaningful movement emits
  `viewportundorequest` with source `pointer`.
- `Q` emits the same `viewportundorequest` with source `keyboard`.
- Right drag without `Shift`: rectangle bin selection.
- `Space` + right drag, or route state `mode: 'lasso'`: lasso bin selection.
- `Ctrl` with rectangle or lasso selection appends; otherwise selection
  replaces. Subtract selection is not part of the reusable API.
- A right-click without a real rectangle cancels without changing selection.
- Holding `Shift` while moving the pointer performs temporary bin inspection.
  Releasing `Shift`, blur, or moving without `Shift` clears the transient hover.
- `Shift` + right drag starts a measurement guide from the hovered bin and
  clears it on release/cancel.
- `Escape` clears committed selection and committed-selection overlays.

Parallel coordinates:

- Right drag on an axis: create or replace a brush interval on that axis.
- `Ctrl` + right drag: append another interval on that axis.
- Drag an existing brush band with right button: move it.
- Drag brush min/max handles with right button: resize it.
- Right double-click an existing brush: remove it.
- Pointer brush previews update the brush overlay without recalculating line
  membership; selection is evaluated when the pointer is released and the
  brush commits. This keeps WebGPU density rendering aligned with the WebGL2
  interaction timing.
- WebGPU brush commits reuse existing background density and run a dedicated
  selected-bin/membership pass. Exact public source indices validate the
  compact GPU candidate mask against raw values instead of rescanning every
  record. Selected-only bins render without the original series color beneath
  the stronger committed-selection overlay. While selection is active,
  remaining density retains 62% opacity with mild desaturation, exact-color
  representatives retain 42%, dense selected bundles use a clean bright-yellow
  line, and only sparse selected bins receive a subtle contrasting halo.
- Holding `Shift` while moving the pointer inspects the nearest source line
  through the hover overlay. Background lines are not dimmed or redrawn by
  hover. Inspection clears on `Shift` release or pointer leave unless
  `inspection.explicitHoverModeActive()` says hover mode is active.
- `Escape` clears active brushes only when brushes exist; repeated Escape is
  ignored.
- `,` or `-`: request line opacity decrease. `.` or `+`: request increase.
  `0`: request reset.
- Parallel shortcut handling ignores events that are already prevented, gated
  off, rejected by `ignoreKeyboardTarget`, or modified with `Alt`, `Ctrl`, or
  `Meta`.
- Parallel brushing and brush removal require `brushHitTest` in
  `createDefaultParallelBindings`. `createParallelDomBrushHitTest()` works with
  the demo app's DOM axis overlay; custom hosts can inject their own SVG/canvas hit
  test. Without a hit test, inspection and keyboard shortcuts still work.

Selection kinds are currently `replace` and `append`. Subtract selection is not
part of the reusable API.

## Example Route Parity Checklist

Default bindings only translate normalized input into commands and events. To
make another app behave like the demo routes, wire the route-owned
pieces around the engine:

- Attach default bindings with a scoped `inputElement` and context-menu
  suppression where right-drag selection is used.
- Subscribe to `overlaychange` and render descriptors in a host overlay layer;
  do not scrape overlay DOM to recover interaction state.
- Subscribe to `selectionchange`, store compact selected source indices or bin
  descriptors, and materialize IDs/rows/export text lazily outside pointer
  handlers.
- Subscribe to `hoverchange`/`measurementchange` for scatter and histogram, and
  `inspectionchange` for parallel. Render host-owned panels/labels from event
  payloads plus the original buffers/metadata.
- Subscribe to adjustment request events and persist the result in host state:
  scatter `pointsizeadjustrequest`/`heatmapbinsizeadjustrequest`, histogram
  `binsizeadjustrequest`, and parallel `lineopacityadjustrequest`.
- Subscribe to `viewportundorequest` for scatter and histogram if the product
  wants the demo app's middle-click/`Q` URL or viewport undo behavior.
- Keep mode, axis mode, focused subplot, viewport, bin sizes, line opacity,
  color/style buffers, selected indices, hover/inspection, measurement, and
  overlays as host state when those features are product-visible; reconcile
  controlled changes back with `plot.update(...)`.
- For parallel, render or otherwise own the axis guides/brush handles and pass
  a matching `brushHitTest`; without it, pointer brushing and brush-handle
  removal cannot work even though inspection and keyboard shortcuts still can.

## Breaking Out Of Defaults

You can skip default bindings entirely and call commands from your own input
system:

```ts
plot.commands.selectRectangle({
  bounds: { x: { min: 0, max: 10 }, y: { min: 5, max: 20 }, yKey: 'temperature' },
  kind: 'replace',
  plotId: 'temperature',
});

plot.commands.requestViewportUndo('keyboard');
plot.commands.clearSelection();
plot.update({ mode: 'lasso' });
```

You can also supplement defaults with custom bindings:

```ts
import type { ScatterBinding, ScatterPlotInstance } from 'm-charts/m-scatter';

export function createKeyboardBinding(): ScatterBinding {
  return (plot: ScatterPlotInstance) => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        plot.update({ viewport: createFullDatasetViewport() });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  };
}

plot.use(createDefaultScatterBindings());
plot.use(createKeyboardBinding());
```

Scatter and histogram defaults accept `rectangleBrushGestures`; parallel accepts
`axisBrushGestures`. These map specific gestures to observation-only
`defaultAction: 'none'` events, which is the extension point for product-owned
draft flows. Observation brushes must not implicitly move
records into selection state.

Gesture override modifier matching is exact. Omitted modifier keys are treated
as `false`, so `{ modifiers: { ctrlKey: true } }` matches Ctrl-only and not
Ctrl+Shift, Ctrl+Alt, or Meta-modified drags. Add separate override entries for
every supported modifier combination.

For scatter and histogram rectangle gestures, `axisMode: 'auto'` or an omitted
`axisMode` keeps the default direction-inferred rectangle projection. Internally
that starts from `xy` and then projects thin horizontal drags to X-only and thin
vertical drags to Y-only. Set an explicit axis mode when the host policy needs a
stable shape:

- `axisMode: 'x'`: full-height X/value band.
- `axisMode: 'y'`: full-width Y/count band.
- `axisMode: 'xy'`: fixed drawn X/Y rectangle with both axes preserved.

Observation gestures are host policy. When a host configures a gesture with
`defaultAction: 'none'`, listen for `brushcommit`, read the brush payload, and
decide in host code whether to open a draft UI, update data, or ignore it.
Observation brushes should not implicitly mutate selection state.

## Event Payload Handoff

Use brush events for interaction observation and draft UI. Use
`selectionchange.filters` for durable backend/query filter rules after a
selection action commits. Do not infer query predicates by scraping overlay DOM
or by reverse-engineering selected IDs.

Common brush payload fields:

```ts
{
  phase: 'start' | 'preview' | 'commit' | 'cancel',
  shape: 'rectangle' | 'lasso' | 'axis-range',
  defaultAction: 'zoom' | 'select' | 'none',
  modifiers: { altKey: boolean, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean },
  source: 'pointer' | 'keyboard' | 'command' | 'route' | 'test-hook',
  target: object,
  range?: object,
  cssGeometry?: object,
  resolveSourceIndices?: () => Uint32Array | null,
}
```

Scatter brush targets include `plotId`, `yKey`, `parameterKey`, `xParameterKey?`,
and the configured rectangle `axisMode`. Scatter brush ranges may include `x`,
`y`, and projected `parameter`; `parameter` is the X range for `axisMode: 'x'`
and the active Y range for `axisMode: 'y'` or `'xy'`.

Histogram brush targets include `subplotId` and `parameterKey`. Histogram brush
ranges may include rendered `x`, count-axis `y`, value-axis `value`, and
`bins` for intersected bin descriptors. Observation brushes with
`defaultAction: 'none'` are the host-owned handoff when the app needs
bin-aligned ranges.

Parallel brush events use `shape: 'axis-range'` and include `activeBrushes`,
`brushIntervals`, `reason`, `target.parameterKey`, `target.axisRangeIndex`, and
`range.intervals`. The primary interval is also exposed as `range.value` when
available.

Selection filter payloads are the query-builder handoff:

```ts
type Range = { max: number, min: number };
type Source = { datasetKey?: string, tableKey?: string, fieldKey?: string };

// Scatter selectionchange.filters[]
{
  shape: 'rectangle' | 'lasso',
  plotId: string,
  yKey: string,
  parameterKey: string,
  ranges: { x: Range, y: Range, parameter: Range },
  dimensions: [
    { axis: 'x', parameterKey: string, range: Range, valueType: string, source?: Source, values?: readonly unknown[] },
    { axis: 'y', parameterKey: string, range: Range, valueType: string, source?: Source, values?: readonly unknown[] },
  ],
  points?: readonly { x: number, y: number }[],
  source?: Source,
}

// Histogram selectionchange.filters[]
{
  shape: 'rectangle' | 'lasso' | 'programmatic',
  subplotId: string,
  parameterKey: string,
  ranges: { value: Range, x: Range, y?: Range },
  binDescriptors: readonly HistogramBinDescriptor[],
  dimensions: [
    { axis: 'value', parameterKey: string, range: Range, valueType: string, source?: Source, values?: readonly unknown[] },
  ],
  points?: readonly { x: number, y: number }[],
  source?: Source,
}

// Parallel selectionchange.filters[]
{
  axisRangeIndex: number,
  parameterKey: string,
  range: Range,
  valueType: string,
  values?: readonly { encoded: number, label: string, value: boolean | number | string }[],
  source?: Source,
}
```

Categorical and boolean filters expand encoded ranges into `values` so hosts can
build semantic include/exclude rules. Lasso filters also carry polygon points
plus bounding ranges so products can choose exact polygon semantics or cheaper
range predicates.

## Provenance Setup And Lookup

Optional provenance has the same shape across plot families:

```ts
type Source = { datasetKey?: string; tableKey?: string; fieldKey?: string };
```

Configure it on the plotted parameter metadata, not in route sidebars:

```ts
// Scatter through schema encoding:
const schemaColumn = {
  key: 'latency',
  axisType: 'numeric',
  source: { datasetKey: 'run-42', tableKey: 'requests', fieldKey: 'latency_ms' },
};

// Scatter without schema encoding:
const columnsWithProvenance = {
  ...columns,
  axisByColumn: {
    ...columns.axisByColumn,
    latency: {
      columnKey: 'latency',
      domain: { min: 0, max: 500 },
      kind: 'numeric',
      parameterName: 'latency',
      source: { datasetKey: 'run-42', tableKey: 'requests', fieldKey: 'latency_ms' },
      title: 'Latency',
      unit: 'ms',
    },
  },
};

// Histogram:
const parameter = {
  key: 'latency',
  kind: 'numeric',
  label: 'Latency',
  source: { datasetKey: 'run-42', tableKey: 'requests', fieldKey: 'latency_ms' },
};

// Parallel:
const axis = {
  key: 'latency',
  kind: 'numeric',
  label: 'Latency',
  source: { datasetKey: 'run-42', tableKey: 'requests', fieldKey: 'latency_ms' },
};
```

Retrieval rules:

- Subplot-to-parameter mapping is configured by `spec.plots[].id`/`yKey` for
  scatter, `spec.subplots[].id`/`parameterKey` for histogram, and axis `key` for
  parallel.
- Selection filters echo configured provenance on `filter.source` and on each
  `filter.dimensions[].source` where applicable.
- Scatter brush events carry `target.plotId`, `target.yKey`, and
  `target.parameterKey`; map those keys back to `spec.plots` and
  `columns.axisByColumn` when host UI needs source-aware labels or backend field
  keys.
- Histogram brush events carry `target.subplotId` and `target.parameterKey`;
  map `subplotId` through `spec.subplots[]` and then read the matching
  `spec.parameters[].source`.
- Parallel brush events carry `target.parameterKey`; map that key back to
  `buffers.axisMetadataByAxis` or the original axis spec for provenance.
- Scatter hover and measurement events identify the active source record and
  plotted field through `point.plotId`, `point.yKey`, `point.record?`, and the
  display fields derived from `columns.axisByColumn`. Use that metadata for
  custom hover UI instead of guessing from subplot labels.
- Histogram hover and measurement refs include `bin.source` when known, either
  from `HistogramParameterSpec.source` or from a single known bin table.
- Parallel inspection/hover identifies records; use the hovered axis or
  inspection context plus axis metadata for source-aware labels.

## Scatter Reference

WebGL2 entry point:

```ts
import {
  createDefaultScatterBindings,
  createScatterPlot,
} from 'm-charts/m-scatter';
import {
  createScatterBuffers,
  createDefaultScatterViewport,
  calculateScatterDomain,
  encodeScatterSchemaRows,
  FAST_SCATTER_SHAPE_CODES,
} from 'm-charts/m-scatter';
```

WebGPU-compatible entry point:

```ts
import {
  createDefaultScatterBindings,
  createScatterPlot,
  type FastScatterWebgpuPlotOptions,
  type FastScatterWebgpuPlotInstance,
} from 'm-charts/m-scatter-webgpu';
```

The WebGPU entry point is an export/type superset of the WebGL2 scatter entry
point. Both use the shared contracts below; WebGPU adds asynchronous startup and
diagnostics rather than a separate interaction API.

Core capabilities:

- Multiple stacked XY subplots sharing one X column.
- Numeric, categorical, boolean, and nanosecond datetime axis metadata.
- Point, bubble, and heatmap visualization modes.
- Per-record color, opacity, size, rotation, and shape in point mode.
- Shape codes from `FAST_SCATTER_SHAPE_CODES`: circle, rectangle/square,
  triangle, pin, and arrow.
- Selection by rectangle or lasso with source indices and query-ready filters.
- Hover, measurement, point markers, navigator, focused subplot, out-of-range
  markers, point-size adjustment requests, heatmap bin-size requests, metrics,
  render-state events, and WebGL2 context or WebGPU device lifecycle events.

Minimal data shape:

```ts
const columns: ScatterDisplayColumns = {
  ids: ['row-0', 'row-1'],
  x: new Float32Array([0, 1]),
  xKey: 'time',
  y: {
    temperature: new Float32Array([18.5, 19.2]),
    pressure: new Float32Array([1002, 1005]),
  },
  color: new Uint8Array([
    37, 99, 235, 255,
    220, 38, 38, 255,
  ]),
  colorFormat: 'rgba8',
  opacity: new Float32Array([1, 0.75]),
  size: new Float32Array([4, 6]),
  rotationDegrees: new Float32Array([0, 45]),
  shape: new Uint8Array([0, 2]),
  sourceIndex: new Uint32Array([0, 1]),
};

const spec = {
  xLabel: 'Time',
  plots: [
    { id: 'temperature', label: 'Temperature', yKey: 'temperature' },
    { id: 'pressure', label: 'Pressure', yKey: 'pressure' },
  ],
};

const viewport = {
  x: { min: 0, max: 1 },
  yByPlot: {
    temperature: { min: 15, max: 25 },
    pressure: { min: 990, max: 1010 },
  },
};
```

Full reusable scatter input contract:

```ts
type FastScatterTypedNumericArray =
  Float32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array;
type FastScatterColorArray = Uint8Array | Uint32Array;
type FastScatterVisualizationMode = 'points' | 'bubble' | 'heatmap';
type FastScatterInteractionMode = 'zoom' | 'pan' | 'select' | 'lasso' | 'hover' | 'measure';
type FastScatterAxisMode = 'x' | 'y' | 'xy';
type FastScatterShapeCode = 0 | 1 | 2 | 3 | 4;

interface FastScatterRange {
  min: number;
  max: number;
}

interface FastScatterViewport {
  x: FastScatterRange;
  yByPlot: Readonly<Record<string, FastScatterRange>>;
}

interface FastScatterPointColumns {
  ids: readonly string[];
  x: FastScatterTypedNumericArray;
  xKey?: string;
  xOrder?: Uint32Array;
  y: Readonly<Record<string, FastScatterTypedNumericArray>>;
  color?: FastScatterColorArray;
  colorFormat?: 'rgba8' | 'rgba32';
  opacity?: Float32Array;
  size?: Float32Array;
  rotation?: Float32Array;
  rotationDegrees?: Float32Array;
  rotationRadians?: Float32Array;
  shape?: Uint8Array;
  recordIdentityBySourceIndex?: readonly FastScatterRecordIdentity[];
  sourceIndex?: Uint32Array;
  tableBySourceIndex?: readonly string[];
}

interface FastScatterRecordIdentity {
  datasetKey?: string;
  id: string;
  sourceIndex: number;
  table: string;
  tableKey?: string;
}

interface FastScatterPlotSpec {
  xLabel: string;
  plots: readonly { id: string; label: string; yKey: string }[];
}
```

`ids.length`, `x.length`, every `y[key].length`, and all optional style arrays
must describe the same source-order record set. `sourceIndex` maps display rows
back to host data; omit it only when source order and display order are
identical. `xOrder` is an optional sorted order helper. Keep records sorted by
nondecreasing X where possible because hover, selection, and aggregation paths
can take advantage of sorted data.

Important `createScatterPlot` options:

- Required: `columns`, `spec`, `viewport`, `mode`, `axisMode`.
- Interaction/config: `mode: 'zoom' | 'pan' | 'select' | 'lasso' | 'hover' |
  'measure'`, `axisMode: 'x' | 'y' | 'xy'`, `focusedPlotId`.
- Rendering: `visualizationMode: 'points' | 'bubble' | 'heatmap'`,
  `renderingMode`, `opacityScale`, `pointSizeScale`, `heatmapBinSizePx`,
  `heatmapPalette`, `theme`, `aggregation`.
- State: `selectedSourceIndices`, `hoverSourceIndex`.
- Lifecycle/classes: `canvasClassName`, `canvasLabel`, `hostClassName`,
  `overlayClassName`, `navigatorCssPx`, `preserveDrawingBuffer`,
  `rendererFactory`, `forceWebglUnavailable`.
- Callbacks: `onViewportChange`, `onSelectionChange`, `onHoverChange`,
  `onMeasurementChange`, `onMetrics`.

Those are the shared/WebGL2 options. The WebGPU factory accepts the same object,
ignores WebGL2-only creation fields, and adds:

```ts
interface FastScatterWebgpuPlotOptions extends FastScatterPlotOptions {
  aggregationBackend?: 'auto' | 'rust-wasm' | 'typescript';
  indexedStyle?: boolean;
  packedStyles?: FastScatterWebgpuPackedStyles;
  requestTimestampQuery?: boolean;
}

interface FastScatterWebgpuPlotInstance extends FastScatterPlotInstance {
  readonly interactive: Promise<void>;
  readonly ready: Promise<void>;
  getWebgpuDiagnostics(): FastScatterWebgpuDiagnostics;
}
```

All four WebGPU-only options are creation-only and excluded from the WebGPU
instance's `update` type. `interactive` resolves after the first displayed
frame; `ready` resolves after the first complete settled frame. Both reject on
WebGPU startup failure. `getWebgpuDiagnostics()` reports readiness, active and
requested aggregation backends, device/timestamp support, resident/cache
memory, LOD exactness/coverage, and submitted/coalesced work.

Full option and callback shape:

```ts
interface FastScatterPlotOptions {
  columns: FastScatterPointColumns;
  focusedPlotId?: string | null;
  spec: FastScatterPlotSpec;
  viewport: FastScatterViewport;
  mode: FastScatterInteractionMode;
  axisMode: FastScatterAxisMode;
  renderingMode?: FastScatterRenderingMode;
  opacityScale?: number;
  pointSizeScale?: number;
  theme?: FastScatterTheme;
  visualizationMode?: 'points' | 'bubble' | 'heatmap';
  heatmapBinSizePx?: number;
  heatmapPalette?: 'mono' | 'viridis' | 'magma' | 'turbo';
  aggregation?: FastScatterAggregationSet | null;
  selectedSourceIndices?: Uint32Array;
  hoverSourceIndex?: number | null;
  onViewportChange?: (
    viewport: FastScatterViewport,
    reason: FastScatterViewportChangeReason,
    phase: 'preview' | 'commit',
  ) => void;
  onSelectionChange?: (selection: FastScatterSelectionEvent) => void;
  onHoverChange?: (hover: FastScatterHoverEvent | null) => void;
  onMeasurementChange?: (measurement: FastScatterMeasurementEvent | null) => void;
  onMetrics?: (metrics: FastScatterMetricsEvent) => void;
  canvasClassName?: string;
  canvasLabel?: string;
  forceWebglUnavailable?: boolean;
  hostClassName?: string;
  navigatorCssPx?: number;
  overlayClassName?: string;
  preserveDrawingBuffer?: boolean;
  rendererFactory?: FastScatterRendererFactory;
}
```

Style ranges:

- Opacity values are `0..1`.
- Size values are `0..24`.
- Rotation values can be supplied as degrees or radians.
- Color can be `rgba8` (`Uint8Array`, 4 bytes per point) or `rgba32`
  (`Uint32Array`).
- Bubble mode intentionally ignores per-record point styling and uses
  `theme.bubbleColor` as a uniform fill.

Scatter symbol and point styling config:

```ts
import { FAST_SCATTER_SHAPE_CODES, createScatterBuffers } from 'm-charts/m-scatter';

FAST_SCATTER_SHAPE_CODES;
// { circle: 0, rectangle: 1, triangle: 2, pin: 3, arrow: 4 }

const columns = createScatterBuffers(records, {
  yAccessors: {
    temperature: (record) => record.temperature,
    pressure: (record) => record.pressure,
  },
  styleLimits: {
    opacity: { min: 0, max: 1 },
    rotationDegrees: { min: 0, max: 360 },
    size: { min: 0, max: 24 },
  },
});
```

`createScatterBuffers(...)` accepts source records with `id`, `x`, optional
`color` as a hex string, optional `opacity`, optional `size`, optional
`rotation` in degrees, and optional `shape` as either a shape name or numeric
code. It returns typed columns ready for the engine, including `color:
Uint8Array`, `colorFormat: 'rgba8'`, `opacity`, `size`, `rotationDegrees`,
`rotationRadians`, `rotation` as the radians alias, `shape`, `sourceIndex`, and
build metrics.

When building columns yourself:

```ts
const pointCount = columns.x.length;
columns.shape = new Uint8Array([
  FAST_SCATTER_SHAPE_CODES.circle,
  FAST_SCATTER_SHAPE_CODES.rectangle,
  FAST_SCATTER_SHAPE_CODES.triangle,
  FAST_SCATTER_SHAPE_CODES.pin,
  FAST_SCATTER_SHAPE_CODES.arrow,
]);
columns.size = new Float32Array(pointCount); // CSS px before pointSizeScale.
columns.rotationDegrees = new Float32Array(pointCount); // host-readable.
columns.rotationRadians = new Float32Array(pointCount); // renderer-readable.
columns.rotation = columns.rotationRadians;
columns.opacity = new Float32Array(pointCount); // 0..1.
```

If `shape` is omitted, all points render as circles. If `size` is omitted, the
renderer uses `4` CSS px. If `rotation` is omitted, glyphs use `0` degrees. Pin
and triangle markers have a visual center different from their bounding-box
center; the engine accounts for that when drawing point-mode marker guides.
Point styling applies only to `visualizationMode: 'points'`. In bubble and
heatmap modes, pass aggregation data and use theme/palette options instead.

Scatter bubble and heatmap aggregation config:

```ts
import {
  buildFastScatterAggregation,
  buildFastScatterBubbleAggregation,
  buildFastScatterHeatmapAggregation,
} from 'm-charts/m-scatter';

const subplots = spec.plots.map((plot) => ({
  plotHeightPx: 220,
  plotId: plot.id,
  plotWidthPx: 960,
  yKey: plot.yKey,
  yRange: viewport.yByPlot[plot.id],
}));

const bubbleAggregation = buildFastScatterBubbleAggregation(columns, {
  mode: 'bubble',
  xRange: viewport.x,
  subplots,
  selectedSourceIndices,
  hoverSourceIndex,
});

const heatmapAggregation = buildFastScatterHeatmapAggregation(columns, {
  mode: 'heatmap',
  heatBinPx: 18,
  xRange: viewport.x,
  subplots,
  selectedSourceIndices,
  hoverSourceIndex,
});

plot.update({
  aggregation: heatmapAggregation,
  heatmapBinSizePx: 18,
  heatmapPalette: 'viridis',
  visualizationMode: 'heatmap',
});
```

Aggregation request and result shape:

```ts
interface FastScatterAggregationSubplotRequest {
  plotHeightPx: number;
  plotId: string;
  plotWidthPx: number;
  yKey: string;
  yRange: FastScatterRange;
}

type FastScatterAggregationRequest =
  | {
      mode: 'bubble';
      hoverSourceIndex?: number | null;
      selectedSourceIndices?: Uint32Array;
      subplots: readonly FastScatterAggregationSubplotRequest[];
      xRange: FastScatterRange;
    }
  | {
      mode: 'heatmap';
      heatBinPx: number;
      hoverSourceIndex?: number | null;
      selectedSourceIndices?: Uint32Array;
      subplots: readonly FastScatterAggregationSubplotRequest[];
      xRange: FastScatterRange;
    };

type FastScatterAggregationSet =
  | {
      kind: 'bubble';
      metrics: { aggregateBuildMs: number; resultBytes: number };
      pointCount: number;
      subplots: readonly FastScatterBubbleSubplotAggregation[];
      totalAggregateCount: number;
    }
  | {
      kind: 'heatmap';
      metrics: { aggregateBuildMs: number; resultBytes: number };
      pointCount: number;
      subplots: readonly FastScatterHeatmapSubplotAggregation[];
      totalCellCount: number;
      totalPopulatedCellCount: number;
    };
```

Bubble aggregation keeps one aggregate per occupied pixel-space bucket and
stores `centerX`, `centerY`, `counts`, representative color, selected/hover
flags, and membership offsets/counts per subplot. Heatmap aggregation stores a
regular cell grid with `xBinCount`, `yBinCount`, axis ranges, populated-cell
counts, selected/hover flags, and membership offsets/counts. Use
`materializeFastScatterBubbleSourceIndices(...)` or
`materializeFastScatterHeatmapCellSourceIndices(...)` only when the host needs
records for a panel/export. Rebuild aggregation when viewport, subplot pixel
size, selected indices, hover source, heat bin size, or plotted columns change.

Important commands:

- Lifecycle/snapshots: `render`, `resize`, `getCanvas`, `getHostElement`,
  `getOverlayElement`, `getRenderSnapshot`, `getStateSnapshot`.
- Geometry: `getPlotRectAtPoint`, `getPlotXKey`, `getPlotYKey`,
  `getNavigatorRect`, `getNavigatorWindowPixels`.
- Viewport: `setViewport`, `zoomAtPointer`, `zoomToRectangle`, `panFromDrag`,
  `dragNavigator`, `requestViewportUndo`.
- Selection: `selectRectangle`, `selectLasso`, `clearSelection`.
- Hover/measurement/markers: `hoverAtPoint`, `clearHover`,
  `setHoverSourceIndex`, `setMeasurement`, `togglePointMarker`,
  `clearPointMarkers`.
- Overlays/cursor: `setOverlays`, `clearOverlays`, `getOverlays`,
  `setCursorState`, `setActivePlot`.
- Adjustment requests: `requestPointSizeAdjust`,
  `requestHeatmapBinSizeAdjust`.
- Aggregation: `getAggregation`.
- Easter egg: `playEasterEgg`.

Scatter command signatures:

```ts
interface FastScatterPlotCommands {
  clearHover(reason?: 'binding' | 'command' | 'pointer' | 'programmatic'): void;
  clearPointMarkers(): void;
  clearSelection(kind?: 'replace' | 'append'): FastScatterSelectionEvent | null;
  clearOverlays(kind?: FastScatterOverlayKind): void;
  getAggregation(): FastScatterAggregationSet | null;
  getCanvas(): HTMLCanvasElement;
  getHostElement(): HTMLElement;
  getOverlayElement(): HTMLDivElement;
  getOverlays(): readonly FastScatterOverlayDescriptor[];
  getPlotRectAtPoint(pointerCssX: number, pointerCssY: number): FastScatterPlotRect | null;
  getPlotXKey(): string | null;
  getPlotYKey(plotId: string): string | null;
  getNavigatorRect(): FastScatterPlotRect | null;
  getNavigatorWindowPixels(widthCssPx: number): { leftCssPx: number; widthCssPx: number };
  getRenderSnapshot(): FastScatterRenderSnapshot;
  getStateSnapshot(): FastScatterStateSnapshot;
  emitBrushEvent(event: FastScatterBrushEvent): void;
  playEasterEgg(options?: FastScatterEasterEggPlaybackOptions): boolean;
  render(): void;
  requestHeatmapBinSizeAdjust(request: {
    delta: number;
    heatmapBinSizePx?: number;
    palette?: FastScatterHeatmapPalette;
    source?: 'command' | 'keyboard' | 'wheel';
  }): void;
  requestPointSizeAdjust(request: {
    delta: number;
    mode?: FastScatterVisualizationMode;
    pointSizeScale?: number;
    source?: 'command' | 'keyboard' | 'wheel';
  }): void;
  requestViewportUndo(source?: 'command' | 'keyboard' | 'pointer'): void;
  resize(): void;
  setActivePlot(plotId: string | null, reason?: 'binding' | 'command' | 'pointer' | 'programmatic'): void;
  setCursorState(cursor: FastScatterCursorState, reason?: 'binding' | 'command' | 'pointer' | 'programmatic'): void;
  setHoverSourceIndex(sourceIndex: number | null): void;
  setOverlays(overlays: readonly FastScatterOverlayDescriptor[], reason?: 'replace' | 'set'): void;
  togglePointMarker(request: { sourceIndex: number }): boolean;
  setViewport(
    viewport: FastScatterViewport,
    reason?: FastScatterViewportChangeReason,
    phase?: 'preview' | 'commit',
  ): void;
  panFromDrag(request: {
    axisMode: FastScatterAxisMode;
    currentPointerCssX: number;
    currentPointerCssY: number;
    plotId: string;
    startPointerCssX: number;
    startPointerCssY: number;
    startViewport: FastScatterViewport;
    updateCount?: number;
  }): FastScatterDragPanResult | null;
  hoverAtPoint(request: {
    pointerCssX: number;
    pointerCssY: number;
    source: 'measure' | 'shift-hover';
  }): FastScatterHoverEvent | null;
  dragNavigator(request: {
    currentPointerCssX: number;
    edge: 'max' | 'min' | null;
    startPointerCssX: number;
    startWindow: FastScatterRange;
    updateCount?: number;
    widthCssPx: number;
  }): FastScatterRange | null;
  setMeasurement(measurement: FastScatterMeasurementEvent | null): void;
  selectLasso(request: {
    kind?: 'replace' | 'append';
    pixelPoints?: readonly { xCssPx: number; yCssPx: number }[];
    plotId: string;
    points: readonly FastScatterSelectionPoint[];
    yKey: string;
  }): FastScatterSelectionEvent | null;
  selectRectangle(request: {
    bounds: {
      x: { max: number; min: number };
      y: { max: number; min: number; yKey: string };
    };
    kind?: 'replace' | 'append';
    plotId: string;
  }): FastScatterSelectionEvent | null;
  zoomToRectangle(request: {
    axisMode: FastScatterAxisMode;
    axisModeStrategy?: FastScatterRectangleZoomAxisModeStrategy;
    currentPointerCssX: number;
    currentPointerCssY: number;
    plotRect: FastScatterPlotRect;
    startPointerCssX: number;
    startPointerCssY: number;
    startedAt?: number;
  }): FastScatterRectangleZoomResult | null;
  zoomAtPointer(request: {
    axisMode: FastScatterAxisMode;
    deltaMode: number;
    deltaX?: number;
    deltaY: number;
    pointerCssX: number;
    pointerCssY: number;
  }): FastScatterWheelZoomResult | null;
}
```

Scatter default binding option shape:

```ts
interface DefaultScatterBindingsOptions {
  easterEgg?: false | (FastScatterEasterEggPlaybackOptions & { sequence?: string });
  inputElement?: HTMLElement;
  rectangleBrushGestures?: readonly {
    axisMode?: 'x' | 'y' | 'xy' | 'auto';
    button: 0 | 2;
    defaultAction: 'none' | 'zoom';
    modifiers?: Partial<InputModifiers>;
  }[];
  suppressContextMenu?: boolean;
}
```

`inputElement` scopes pointer, wheel, and keyboard listeners. If omitted, the
binding uses the plot host's parent element or the host itself. Use
`rectangleBrushGestures` to add product-specific left/right rectangle gestures
without changing renderer code. A gesture with `defaultAction: 'none'` emits
brush events and overlays but does not select or zoom.

### Scatter Easter Egg Setup

To match the demo app's m-scatter route, enable the default typed sequence when
attaching scatter bindings:

```ts
plot.use(
  createDefaultScatterBindings({
    easterEgg: { sequence: 'future' },
    inputElement: host.parentElement ?? host,
    suppressContextMenu: true,
  }),
);
```

With either the WebGL2 `m-scatter` renderer or the WebGPU
`m-scatter-webgpu` renderer, `sequence` is the typed keyboard trigger:
typing `future` while
the plot interaction surface or configured `inputElement` is focused calls
`plot.commands.playEasterEgg()`. The built-in renderer-owned playback
temporarily replaces only the first rendered subplot, draws GPU points that
form `Future`, uses per-character rainbow colors by default, draws the word in
normalized subplot coordinates so it remains visible after zooming, panning, or
selecting records, then restores normal rendering automatically. It does not
mutate loaded columns, viewport, selection, hover, measurement, or overlays.

The default binding ignores easter-egg keys for repeated keydown events,
already-prevented events, `Ctrl`/`Alt`/`Meta` modified events, and editable
targets such as inputs, textareas, selects, and contenteditable nodes. Choose a
sequence that does not overlap host-owned plain-key shortcuts; if custom
bindings use letters from the sequence, those handlers should prevent default
first or the host should pick a different easter-egg sequence.

Default playback settings are renderer-owned defaults: word `Future`, sequence
`future`, point size `5`, enter `720ms`, hold `3000ms`, exit `720ms`, and
character stagger `130ms`. Disable the shortcut with `easterEgg: false`, or pass
playback overrides through the binding:

```ts
plot.use(
  createDefaultScatterBindings({
    easterEgg: {
      sequence: 'future',
      holdDurationMs: 1500,
      pointSizePx: 6,
      color: [255, 255, 255, 235],
    },
  }),
);
```

Hosts can also bypass keyboard bindings and start playback directly with
`plot.commands.playEasterEgg(options)`. Passing `color` makes all characters
uniform; omit it to keep the default rainbow palette.

Events:

- `renderstate`, `renderstatechange`, `metrics`
- `viewportchange`
- `selectionchange`
- `hoverchange`, `measurementchange`
- `brushstart`, `brushpreview`, `brushcommit`, `brushcancel`
- `overlaychange`, `activeplotchange`, `cursorchange`
- `pointsizeadjustrequest`, `heatmapbinsizeadjustrequest`
- `viewportundorequest`
- `contextlost`, `contextrestored`

Scatter `selectionchange` emits `sourceIndices`, `selectedCount`, `sampleIds`,
`kind`, `tool`, `viewport`, and `filters`. Filters describe plotted X/Y
dimensions, selected ranges, optional lasso points, categorical/boolean values,
and optional provenance `source: { datasetKey?, tableKey?, fieldKey? }`.
Translate filters into backend queries in the host; do not scrape overlay DOM.

Scatter event payload details:

```ts
interface FastScatterViewportChangeEvent {
  phase: 'preview' | 'commit';
  reason: 'initial' | 'reset' | 'wheel' | 'drag' | 'rectangle-zoom' | 'navigator' | 'programmatic';
  viewport: FastScatterViewport;
}

interface FastScatterSelectionEvent {
  filters: readonly FastScatterSelectionFilter[];
  sourceIndices: Uint32Array;
  selectedCount: number;
  kind: 'replace' | 'append';
  tool: 'rectangle' | 'lasso' | 'programmatic';
  durationMs?: number;
  plotId?: string;
  sampleIds?: readonly string[];
  viewport: FastScatterViewport;
}

interface FastScatterSelectionFilter {
  dimensions: readonly {
    axis: 'x' | 'y';
    parameterKey: string;
    range: FastScatterRange;
    source?: { datasetKey?: string; tableKey?: string; fieldKey?: string };
    valueType: 'numeric' | 'categorical' | 'boolean' | 'datetime-ns' | 'unknown';
    values?: readonly { encoded: number; label: string; value: boolean | number | string }[];
  }[];
  parameterKey: string;
  plotId: string;
  ranges: { parameter: FastScatterRange; x: FastScatterRange; y: FastScatterRange };
  shape: 'lasso' | 'rectangle';
  points?: readonly { x: number; y: number }[];
  source?: { datasetKey?: string; tableKey?: string; fieldKey?: string };
  yKey: string;
}

interface FastScatterHoverEvent {
  aggregate?: {
    count: number;
    kind: 'bubble' | 'heatmap';
    membership?: FastScatterAggregationMembershipSpan;
    sampleIds?: readonly string[];
    xLabel: string;
    yLabel: string;
  };
  point: { sourceIndex: number; id: string; x: number; y: number; plotId: string; yKey: string };
  canvasPoint: { canvasX: number; canvasY: number };
  candidateCount: number;
  distancePx: number;
  durationMs: number;
  pinned: boolean;
  source: 'measure' | 'programmatic' | 'shift-hover';
  sourcePointIndex: number;
}

interface FastScatterMeasurementEvent {
  current: FastScatterMeasurementReference | null;
  reference: FastScatterMeasurementReference;
}

interface FastScatterBrushEvent extends BrushEventBase<
  { axisMode: 'x' | 'y' | 'xy'; xParameterKey?: string; parameterKey: string; plotId: string; yKey: string },
  { parameter?: FastScatterRange; x?: FastScatterRange; y?: FastScatterRange },
  'none' | 'select' | 'zoom'
> {}
```

Adjustment request events are host handoffs, not automatic state changes.
`pointsizeadjustrequest` carries `{ delta, mode, pointSizeScale?, source }`.
`heatmapbinsizeadjustrequest` carries
`{ delta, heatmapBinSizePx?, palette?, source }`. Apply the app's step policy,
persist the result if needed, then call `plot.update(...)`.

## Histogram Reference

Entry points:

```ts
import {
  createDefaultHistogramBindings,
  createHistogramPlot,
} from 'm-charts/m-histogram';
import {
  buildHistogramAggregation,
  createDefaultHistogramViewport,
  normalizeHistogramBarSeries,
} from 'm-charts/m-histogram';
import {
  createHistogramPlot as createWebgpuHistogramPlot,
  type HistogramWebgpuPlotInstance,
} from 'm-charts/m-histogram-webgpu';
```

`m-histogram-webgpu` is an export/type superset of `m-histogram`. Existing
integrations retain the same options, bindings, commands, events, callbacks,
overlays, and update behavior after changing the import. The WebGPU instance
adds `interactive`, `ready`, and `getWebgpuDiagnostics()`. Its creation-only
options are:

```ts
aggregationBackend?: 'auto' | 'rust-wasm' | 'typescript';
requestTimestampQuery?: boolean;
```

`auto` is the default. Rust/WASM handles exact raw aggregation for typed
continuous columns, sequentially encoded unsigned-integer categorical/boolean
columns, and packed `Uint32Array` rgba32 colors with explicit domains. It builds
persistent sorted row-order indexes for continuous parameters, binary-searches
visible candidates during viewport/bin-size changes, reuses unchanged subplot
results, and materializes exact source membership without changing backend.
String columns, inferred domains, non-sequential categories, and rgba8 colors
use the exact TypeScript compatibility builder. Pre-aggregated `bar` mode
bypasses raw aggregation. WebGPU renders every normalized bin and stack segment;
unlike dense scatter points, histogram bars are never sampled or reduced.

Core capabilities:

- Multiple stacked histogram subplots.
- Raw per-record histogram mode and pre-aggregated bar mode.
- Numeric, datetime-ns, categorical, and boolean parameters.
- Continuous visible-range aggregation with requested vs effective bin-size
  diagnostics and visible-bin guardrails.
- Color-stacked bars through raw `columns.color` or bar `colorStack`.
- Rectangle/lasso bin selection, hover, measurement, focused subplot,
  out-of-range indicators, bin-size adjustment requests, and deferred source
  index materialization.

Raw data shape:

```ts
const columns: HistogramColumns = {
  ids: ['row-0', 'row-1', 'row-2'],
  sourceIndex: new Uint32Array([0, 1, 2]),
  valuesByParameter: {
    latency: new Float32Array([12, 20, 35]),
    status: ['ok', 'warn', 'ok'],
  },
};

const spec: HistogramPlotSpec = {
  mode: 'histogram',
  parameters: [
    { key: 'latency', kind: 'numeric', label: 'Latency', unit: 'ms' },
    {
      key: 'status',
      kind: 'categorical',
      label: 'Status',
      categories: [
        { encoded: 0, label: 'ok', value: 'ok' },
        { encoded: 1, label: 'warn', value: 'warn' },
      ],
    },
  ],
  subplots: [
    { id: 'latency', label: 'Latency', parameterKey: 'latency' },
    { id: 'status', label: 'Status', parameterKey: 'status' },
  ],
};
```

Bar-mode data shape:

```ts
const aggregation = normalizeHistogramBarSeries({
  parameterKey: 'latency',
  subplotId: 'latency',
  bins: [
    {
      min: 0,
      max: 50,
      colorStack: [
        { color: 0x2563ebff, count: 12 },
        { color: 0xdc2626ff, count: 3 },
      ],
      sourceIndices: new Uint32Array([0, 2, 4]),
      totalCount: 15,
    },
  ],
});
```

Full reusable histogram input contract:

```ts
type HistogramParameterKind = 'numeric' | 'datetime-ns' | 'categorical' | 'boolean';
type HistogramDataMode = 'histogram' | 'bar';
type HistogramBinSizeMode = 'continuous' | 'fixed-category';

interface HistogramRange {
  max: number;
  min: number;
}

interface HistogramParameterSpec {
  categories?: readonly { encoded: number; label: string; order?: number; value: boolean | number | string }[];
  datetimeOriginNs?: string;
  domain?: HistogramRange;
  key: string;
  kind: HistogramParameterKind;
  label: string;
  source?: { datasetKey?: string; tableKey?: string; fieldKey?: string };
  sourceTables?: readonly string[];
  unit?: string;
}

interface HistogramPlotSpec {
  mode: HistogramDataMode;
  parameters: readonly HistogramParameterSpec[];
  subplots: readonly { id: string; label: string; parameterKey: string }[];
}

interface HistogramColumns {
  color?: Uint8Array | Uint32Array;
  colorFormat?: 'rgba8' | 'rgba32';
  displayFields?: readonly { key: string; label: string }[];
  ids: readonly string[];
  parameters?: readonly HistogramParameterSpec[];
  recordIdentityBySourceIndex?: readonly { id: string; sourceIndex: number; table?: string }[];
  sourceIndex?: Uint32Array;
  tableBySourceIndex?: readonly string[];
  valuesByParameter: Readonly<
    Record<string, Float32Array | Float64Array | readonly (bigint | boolean | number | string | null | undefined)[]>
  >;
}

interface HistogramViewport {
  subplotById: Readonly<Record<string, { x: HistogramRange; y: HistogramRange }>>;
}

interface HistogramBinSizeState {
  adjustment?: 'none' | 'increase' | 'decrease' | 'set';
  binSize: number;
  mode: HistogramBinSizeMode;
  parameterKey: string;
  subplotId: string;
}
```

Raw histogram mode uses `columns` and computes visible bins from the current
viewport and `binSizes`. Bar mode uses `aggregation` directly, usually from
`normalizeHistogramBarSeries(...)`; source-index membership is optional in bar
mode and may be unavailable for query-only aggregate bins.

Important `createHistogramPlot` options:

- Required: `spec`.
- Data: `columns`, `aggregation`, `binSizes`.
- Interaction/config: `mode: 'zoom' | 'pan' | 'select' | 'lasso' | 'hover' |
  'measure'`, `axisMode: 'x' | 'y' | 'xy'`, `focusedSubplotId`.
- State/rendering: `viewport`, `selectedSourceIndices`, `hoverSourceIndex`,
  `theme`.
- Lifecycle/classes: `canvasClassName`, `canvasLabel`, `hostClassName`,
  `overlayClassName`, `preserveDrawingBuffer`, `rendererFactory`,
  `forceWebglUnavailable`.
- Callbacks: `onViewportChange`, `onSelectionChange`, `onHoverChange`,
  `onMeasurementChange`, `onMetrics`.

Full option and callback shape:

```ts
interface HistogramPlotOptions {
  spec: HistogramPlotSpec;
  columns?: HistogramColumns;
  aggregation?: HistogramAggregationSet;
  binSizes?: readonly HistogramBinSizeState[];
  viewport?: HistogramViewport;
  mode?: 'zoom' | 'pan' | 'select' | 'lasso' | 'hover' | 'measure';
  axisMode?: 'x' | 'xy' | 'y';
  focusedSubplotId?: string | null;
  selectedSourceIndices?: Uint32Array | readonly number[];
  hoverSourceIndex?: number | null;
  theme?: HistogramRendererTheme;
  onViewportChange?: (
    viewport: HistogramViewport,
    reason: 'initial' | 'reset' | 'wheel' | 'drag' | 'rectangle-zoom' | 'programmatic',
    phase: 'preview' | 'commit',
  ) => void;
  onSelectionChange?: (event: HistogramSelectionEvent) => void;
  onHoverChange?: (event: HistogramHoverEvent | null) => void;
  onMeasurementChange?: (event: HistogramMeasurementEvent | null) => void;
  onMetrics?: (event: HistogramMetricsEvent) => void;
  canvasClassName?: string;
  canvasLabel?: string;
  forceWebglUnavailable?: boolean;
  hostClassName?: string;
  overlayClassName?: string;
  preserveDrawingBuffer?: boolean;
  rendererFactory?: HistogramRendererFactory;
}
```

Important commands:

- Lifecycle/snapshots: `render`, `resize`, `getCanvas`, `getHostElement`,
  `getOverlayElement`, `getRenderSnapshot`, `getStateSnapshot`.
- Geometry/queries: `getPlotRectAtPoint`, `getBinAtPoint`,
  `queryBinsInRectangle`, `queryBinsInLasso`.
- Viewport: `setViewport`, `zoomAtPointer`, `zoomToRectangle`, `panFromDrag`,
  `requestViewportUndo`.
- Selection/materialization: `selectRectangle`, `selectLasso`, `selectBins`,
  `clearSelection`, `materializeSelectionSourceIndices`,
  `materializeVisibleMembership`.
- Bin sizing: `requestBinSizeAdjust`, `setBinSizes`.
- Hover/measurement: `hoverAtPoint`, `clearHover`, `setMeasurement`.
- Overlays/cursor: `setOverlays`, `clearOverlays`, `getOverlays`,
  `setCursorState`, `setActivePlot`.

Histogram command signatures:

```ts
interface HistogramPlotCommands {
  clearHover(reason?: 'binding' | 'command' | 'pointer' | 'programmatic'): void;
  clearOverlays(kind?: HistogramOverlayKind): void;
  clearSelection(kind?: 'replace' | 'append'): HistogramSelectionEvent | null;
  getBinAtPoint(pointerCssX: number, pointerCssY: number): HistogramBinHit | null;
  getCanvas(): HTMLCanvasElement;
  getHostElement(): HTMLElement;
  getOverlayElement(): HTMLDivElement;
  getOverlays(): readonly HistogramOverlayDescriptor[];
  getPlotRectAtPoint(pointerCssX: number, pointerCssY: number): HistogramPlotRect | null;
  getRenderSnapshot(): HistogramRenderSnapshot;
  getStateSnapshot(): HistogramStateSnapshot;
  emitBrushEvent(event: HistogramBrushEvent): void;
  hoverAtPoint(request: {
    pinned?: boolean;
    pointerCssX: number;
    pointerCssY: number;
    source: 'measure' | 'shift-hover';
  }): HistogramHoverEvent | null;
  panFromDrag(request: {
    axisMode?: 'x' | 'xy' | 'y';
    currentPointerCssX: number;
    currentPointerCssY: number;
    startPointerCssX: number;
    startPointerCssY: number;
    startViewport: HistogramViewport;
    subplotId: string;
    updateCount?: number;
  }): HistogramDragPanResult | null;
  materializeSelectionSourceIndices(): HistogramSelectionEvent | null;
  materializeVisibleMembership(): HistogramAggregationSet | null;
  queryBinsInLasso(request: {
    points: readonly { x: number; y: number }[];
    subplotId?: string;
  }): HistogramSelectionResult | null;
  queryBinsInRectangle(request: {
    bounds: HistogramPixelBounds;
    subplotId?: string;
  }): HistogramSelectionResult | null;
  render(): HistogramRendererRenderMetrics | null;
  requestBinSizeAdjust(request: {
    binSize?: HistogramBinSizeState;
    delta: number;
    source?: 'command' | 'keyboard' | 'wheel';
    subplotId?: string;
  }): void;
  requestViewportUndo(source?: 'command' | 'keyboard' | 'pointer'): void;
  resize(): void;
  selectBins(request: {
    binDescriptors?: readonly HistogramBinDescriptor[];
    binIndices?: readonly number[];
    kind?: 'replace' | 'append';
    sourceIndices?: Uint32Array | readonly number[];
    subplotId?: string;
  }): HistogramSelectionEvent | null;
  selectLasso(request: {
    kind?: 'replace' | 'append';
    points: readonly { x: number; y: number }[];
    subplotId?: string;
  }): HistogramSelectionEvent | null;
  selectRectangle(request: {
    bounds: HistogramPixelBounds;
    kind?: 'replace' | 'append';
    subplotId?: string;
  }): HistogramSelectionEvent | null;
  setBinSizes(request: {
    binSizes: readonly HistogramBinSizeState[];
    materializeMembership?: boolean;
  }): HistogramAggregationSet | null;
  setActivePlot(plotId: string | null, reason?: 'binding' | 'command' | 'pointer' | 'programmatic'): void;
  setCursorState(cursor: HistogramCursorState, reason?: 'binding' | 'command' | 'pointer' | 'programmatic'): void;
  setMeasurement(measurement: HistogramMeasurementEvent | null): void;
  setOverlays(overlays: readonly HistogramOverlayDescriptor[], reason?: 'replace' | 'set'): void;
  setViewport(
    viewport: HistogramViewport,
    reason?: HistogramViewportChangeReason,
    phase?: 'preview' | 'commit',
  ): void;
  zoomAtPointer(request: {
    axisMode?: 'x' | 'xy' | 'y';
    deltaMode: number;
    deltaY: number;
    pointerCssX: number;
    pointerCssY: number;
  }): HistogramWheelZoomResult | null;
  zoomToRectangle(request: {
    axisMode?: 'x' | 'xy' | 'y';
    axisModeStrategy?: HistogramRectangleZoomAxisModeStrategy;
    currentPointerCssX: number;
    currentPointerCssY: number;
    plotRect: HistogramPlotRect;
    startPointerCssX: number;
    startPointerCssY: number;
    startedAt?: number;
  }): HistogramRectangleZoomResult | null;
}
```

Events:

- `renderstate`, `renderstatechange`, `metrics`
- `viewportchange`
- `selectionchange`
- `hoverchange`, `measurementchange`
- `brushstart`, `brushpreview`, `brushcommit`, `brushcancel`
- `overlaychange`, `activeplotchange`, `cursorchange`
- `binsizeadjustrequest`
- `viewportundorequest`
- `contextlost`, `contextrestored`

Histogram `selectionchange` emits selected bin descriptors, `sourceIndices`,
`sourceIndicesAvailable`, `sourceIndicesStatus`, `selectedBinCount`,
`selectedSourceCount`, and query-ready `filters`. Source indices may be
`pending` after large rectangle/lasso selection; call
`plot.commands.materializeSelectionSourceIndices()` only for export or panel
materialization.

Histogram default binding option shape:

```ts
interface DefaultHistogramBindingsOptions {
  inputElement?: HTMLElement;
  rectangleBrushGestures?: readonly {
    axisMode?: 'x' | 'y' | 'xy' | 'auto';
    button: 0 | 2;
    defaultAction: 'none' | 'zoom';
    modifiers?: Partial<InputModifiers>;
  }[];
  suppressContextMenu?: boolean;
}
```

Histogram event payload details:

```ts
interface HistogramSelectionEvent {
  binDescriptors: readonly HistogramBinDescriptor[];
  durationMs?: number;
  filters: readonly HistogramSelectionFilter[];
  kind: 'replace' | 'append';
  sampleIds?: readonly string[];
  selectedBinCount: number;
  selectedSourceCount: number;
  sourceIndices: Uint32Array;
  sourceIndicesAvailable: boolean;
  sourceIndicesStatus?: 'available' | 'pending' | 'unavailable';
  subplotId?: string;
  tool: 'rectangle' | 'lasso' | 'programmatic';
  viewport: HistogramViewport;
}

interface HistogramBinDescriptor {
  category?: { encoded: number; label: string; order?: number; value: boolean | number | string };
  center: number;
  index: number;
  metadata?: Readonly<Record<string, unknown>>;
  max: number;
  min: number;
  parameterKey: string;
  source?: string;
  subplotId: string;
  table?: string;
}

interface HistogramSelectionFilter {
  binDescriptors: readonly HistogramBinDescriptor[];
  dimensions: readonly {
    axis: 'value';
    parameterKey: string;
    range: HistogramRange;
    source?: { datasetKey?: string; tableKey?: string; fieldKey?: string };
    valueType: HistogramParameterKind | 'unknown';
    values?: readonly { encoded: number; label: string; value: boolean | number | string }[];
  }[];
  parameterKey: string;
  points?: readonly { x: number; y: number }[];
  ranges: { value: HistogramRange; x: HistogramRange; y?: HistogramRange };
  shape: 'lasso' | 'programmatic' | 'rectangle';
  source?: { datasetKey?: string; tableKey?: string; fieldKey?: string };
  subplotId: string;
}

interface HistogramBrushEvent extends BrushEventBase<
  { parameterKey: string; subplotId: string },
  {
    bins?: readonly HistogramBinDescriptor[];
    value?: HistogramRange;
    x?: HistogramRange;
    y?: HistogramRange;
  },
  'none' | 'select' | 'zoom'
> {}
```

Recommended raw bin-size flow:

```ts
plot.on('binsizeadjustrequest', (event) => {
  if (event.subplotId === undefined || event.binSize?.mode !== 'continuous') {
    return;
  }
  queueDebouncedBinSizeUpdate(event.subplotId, event.delta);
});

function applyQueuedBinSize(binSizes: readonly HistogramBinSizeState[]) {
  plot.commands.setBinSizes({ binSizes, materializeMembership: false });
  // After the wheel burst settles:
  plot.commands.materializeVisibleMembership();
}
```

Continuous histograms should preserve the user-requested bin size in app/URL
state and read `continuousBinResolution` from aggregation output to understand
effective bin size, visible bin count, warning, and clamping status.

## Parallel Coordinates Reference

Entry points:

```ts
import {
  createDefaultParallelBindings,
  createParallelDomBrushHitTest,
  createParallelPlot,
} from 'm-charts/m-parallel';
import {
  createParallelPlotBuffers,
  createParallelHoverIndex,
  formatParallelFastRecordAxisValue,
} from 'm-charts/m-parallel';
```

Core capabilities:

- WebGL2 segment rendering for parallel-coordinate records.
- Numeric, categorical, boolean, and datetime-ns axes.
- Per-record line color and opacity.
- Selected and preselected overlays.
- Axis brush intervals with OR semantics within one axis and AND semantics
  across brushed axes.
- Hover/inspection through an optional hover index.
- Missing-axis routing below the normal plot band for multi-table data.
- Host-rendered axis brush and inspection overlays.

Data shape:

```ts
const buffers = createParallelPlotBuffers({
  axisOrder: ['latency', 'throughput', 'healthy'],
  axes: [
    { key: 'latency', kind: 'numeric', label: 'Latency', unit: 'ms' },
    { key: 'throughput', kind: 'numeric', label: 'Throughput' },
    { key: 'healthy', kind: 'boolean', label: 'Healthy' },
  ],
  ids: ['row-0', 'row-1'],
  color: ['#2563eb', '#dc2626'],
  colorFormat: 'hex',
  opacity: new Float32Array([1, 0.7]),
  valuesByAxis: {
    latency: new Float32Array([12, 20]),
    throughput: new Float32Array([900, 840]),
    healthy: [true, false],
  },
}, {
  includeWebglSegmentBuffers: true,
});
```

Full reusable parallel input contract:

```ts
type ParallelFastAxisKind = 'numeric' | 'categorical' | 'boolean' | 'datetime-ns';
type ParallelFastAxisKey = string;
type ParallelParameter = string;

interface ParallelFastAxisSpec {
  categories?: readonly { label?: string; order?: number; value: boolean | number | string }[];
  kind?: ParallelFastAxisKind;
  key: ParallelFastAxisKey;
  label?: string;
  source?: { datasetKey?: string; tableKey?: string; fieldKey?: string };
  unit?: string;
}

interface ParallelFastColumns {
  axisOrder: readonly ParallelFastAxisKey[];
  axes?: readonly ParallelFastAxisSpec[];
  color?: Uint8Array | readonly (`#${string}` | string | null | undefined)[];
  colorFormat?: 'rgba8' | 'hex';
  ids: readonly string[];
  opacity?: Float32Array | Float64Array | readonly (number | null | undefined)[];
  preselectedSourceIndices?: Uint32Array;
  recordIdentityBySourceIndex?: readonly { id: string; sourceIndex: number; table: string }[];
  tableBySourceIndex?: readonly string[];
  valuesByAxis: Readonly<
    Record<ParallelFastAxisKey, Float32Array | Float64Array | readonly (bigint | boolean | number | string | null | undefined)[]>
  >;
}

interface ParallelBuffers {
  axisCount: number;
  axisMetadataByAxis?: Readonly<Record<ParallelParameter, ParallelFastAxisMetadata>>;
  axisOrder: readonly ParallelParameter[];
  domainsByAxis: Record<ParallelParameter, { max: number; min: number; span: number }>;
  ids: readonly string[];
  normalizedValuesByAxis: Record<ParallelParameter, Float32Array>;
  preselectedCount: number;
  preselectedSourceIndices: Uint32Array;
  rawValuesByAxis: Record<ParallelParameter, Float64Array>;
  recordIdentityBySourceIndex?: readonly { id: string; sourceIndex: number; table: string }[];
  recordCount: number;
  styleBuffers?: { color: Uint8Array; colorFormat: 'rgba8'; opacity: Float32Array; styledRecordCount: number };
  webglSegmentBuffers?: ParallelWebglSegmentBuffers;
}

type ParallelBrushIntervals = Partial<
  Record<ParallelParameter, { min: number; max: number } | readonly { min: number; max: number }[] | null | undefined>
>;
```

`createParallelPlotBuffers(...)` encodes numeric, categorical, boolean, and
datetime axes into raw and normalized typed arrays. Pass
`includeWebglSegmentBuffers: true` for active WebGL rendering in copied apps.
Brush intervals use raw display values in each axis domain. Multiple intervals
on one axis are ORed; intervals across axes are ANDed.

Important `createParallelPlot` options:

- Required: `buffers`.
- State/rendering: `brushIntervals`, `inspection`, `selectedSourceIndices`,
  `preselectedSourceIndices`, `preselectedOverlayEnabled`, `lineOpacityScale`,
  `theme`.
- Lifecycle/classes: `baseCanvasClassName`, `baseCanvasLabel`,
  `hoverCanvasClassName`, `hostClassName`, `preserveDrawingBuffer`,
  `rendererFactory`, `hoverRendererFactory`, `forceWebglUnavailable`.
- Behavior: `selectedVisualUpdateDelayMs`.
- Callback: `onMetrics`.

Full option shape:

```ts
interface ParallelFastPlotOptions {
  buffers: ParallelBuffers;
  brushIntervals?: ParallelBrushIntervals;
  inspection?: ParallelFastInspectionState | null;
  selectedSourceIndices?: Uint32Array;
  preselectedSourceIndices?: Uint32Array;
  preselectedOverlayEnabled?: boolean;
  lineOpacityScale?: number;
  theme?: ParallelFastTheme;
  selectedVisualUpdateDelayMs?: number;
  onMetrics?: (event: ParallelFastRendererMetricsEvent) => void;
  baseCanvasClassName?: string;
  baseCanvasLabel?: string;
  forceWebglUnavailable?: boolean;
  hostClassName?: string;
  hoverCanvasClassName?: string;
  hoverRendererFactory?: ParallelFastHoverRendererFactory;
  preserveDrawingBuffer?: boolean;
  rendererFactory?: ParallelFastRendererFactory;
}
```

Important commands:

- Lifecycle/snapshots: `render`, `resize`, `getCanvas`, `getHoverCanvas`,
  `getHostElement`, `getRenderSnapshot`, `getStateSnapshot`.
- Brush/selection: `previewBrushIntervals`, `commitBrushIntervals`,
  `removeBrushInterval`, `clearBrushes`, `setSelectedSourceIndices`,
  `setPreselectedSourceIndices`.
- Inspection/hover: `setInspection`, `clearInspection`, `setHoverSourceIndex`,
  `setHoverState`, `drawHover`.
- Style/theme: `requestLineOpacityAdjustment`, `updateLineOpacityScale`,
  `updateTheme`.
- Overlays: `setOverlays`, `clearOverlays`, `getOverlays`.
- Low-level: `emitBrushEvent`.

Parallel command signatures:

```ts
interface ParallelFastPlotCommands {
  getCanvas(): HTMLCanvasElement;
  getHoverCanvas(): HTMLCanvasElement;
  getHostElement(): HTMLElement;
  getOverlays(): readonly ParallelFastOverlayDescriptor[];
  getRenderSnapshot(): ParallelFastRenderSnapshot;
  getStateSnapshot(): ParallelFastStateSnapshot;
  clearBrushes(options?: ParallelFastBrushCommandOptions): void;
  clearInspection(options?: ParallelFastInspectionCommandOptions): void;
  clearOverlays(kind?: ParallelFastOverlayKind): void;
  commitBrushIntervals(
    brushIntervals: ParallelBrushIntervals,
    options?: ParallelFastBrushCommandOptions,
  ): void;
  drawHover(): ParallelWebgl2HoverDrawMetrics | null;
  emitBrushEvent(event: ParallelFastBrushEvent): void;
  previewBrushIntervals(
    brushIntervals: ParallelBrushIntervals,
    options?: ParallelFastBrushCommandOptions,
  ): void;
  render(): void;
  requestLineOpacityAdjustment(
    adjustment: 'decrease' | 'increase' | 'reset',
    options?: { source?: BrushInteractionSource },
  ): void;
  removeBrushInterval(
    axis: ParallelParameter,
    axisRangeIndex: number,
    options?: ParallelFastBrushCommandOptions,
  ): void;
  resize(): void;
  setHoverSourceIndex(sourceIndex: number | null): ParallelWebgl2HoverUpdateMetrics | null;
  setHoverState(state: { dimBackground: boolean; sourceIndex: number | null }): ParallelWebgl2HoverUpdateMetrics | null;
  setInspection(
    inspection: ParallelFastInspectionState | null,
    options?: ParallelFastInspectionCommandOptions,
  ): void;
  setOverlays(overlays: readonly ParallelFastOverlayDescriptor[], reason?: 'replace' | 'set'): void;
  setPreselectedSourceIndices(sourceIndices: Uint32Array): void;
  setSelectedSourceIndices(sourceIndices: Uint32Array, options?: { source?: BrushInteractionSource }): void;
  updateLineOpacityScale(lineOpacityScale: number): ParallelWebgl2RendererDrawMetrics | null;
  updateTheme(theme: ParallelFastTheme | undefined): {
    base: ParallelWebgl2RendererDrawMetrics | null;
    hover: ParallelWebgl2HoverDrawMetrics | null;
  };
}

interface ParallelFastBrushCommandOptions {
  modifiers?: InputModifiers;
  reason?: 'clear' | 'create' | 'move' | 'remove' | 'resize-max' | 'resize-min' | 'set';
  source?: BrushInteractionSource;
}

interface ParallelFastInspectionCommandOptions {
  lookupSource?: 'fallback' | 'index' | 'none';
  resolveMs?: number | null;
  source?: BrushInteractionSource;
}
```

Events:

- `renderstate`, `renderstatechange`, `metrics`
- `brushpreview`, `brushcommit`, `brushchange`
- `selectionchange`
- `inspectionchange`, `hovervisualchange`
- `overlaychange`
- `lineopacityadjustrequest`
- `contextlost`, `contextrestored`, `dispose`

Parallel default binding option shape:

```ts
type ParallelFastBrushDragKind = 'create' | 'max' | 'min' | 'move';

interface ParallelFastBrushHit {
  axis: ParallelParameter;
  axisBounds: { height: number; top: number };
  axisRangeIndex?: number;
  kind: ParallelFastBrushDragKind;
}

type ParallelFastBrushHitTest = (
  event: NormalizedPointerEvent,
  plot: ParallelFastPlotInstance,
) => ParallelFastBrushHit | null;

interface DefaultParallelBindingsOptions {
  axisHitTest?: ParallelFastBrushHitTest | null; // deprecated alias.
  brushHitTest?: ParallelFastBrushHitTest | null;
  axisBrushGestures?: readonly {
    button: 0 | 2;
    defaultAction: 'none';
    modifiers?: Partial<InputModifiers>;
  }[];
  coordinateTarget?: HTMLElement;
  ignoreKeyboardTarget?: (target: EventTarget | null) => boolean;
  inputAdapter?: DomInputAdapter;
  inputElement?: HTMLElement;
  inspection?: {
    explicitHoverModeActive?: () => boolean;
    getHoverIndex?: () => ParallelHoverIndex | null;
    maxDistancePx?: number;
    smallDatasetFallbackRecordLimit?: number;
  };
  keyboardTarget?: EventTarget;
  shortcutGate?: () => boolean;
}
```

Parallel default bindings need a `brushHitTest` when the host wants pointer
brushing because axis guides and brush handles are host-rendered DOM/SVG. Use
`createParallelDomBrushHitTest(...)` only if the host uses the same data
attributes and class names as the demo app's axis overlay. `inspection.getHoverIndex`
should return a cached `createParallelHoverIndex(buffers)` result for large
datasets; without it the binding uses a small-dataset fallback up to
`smallDatasetFallbackRecordLimit`.

Parallel event payload details:

```ts
interface ParallelFastBrushEvent extends BrushEventBase<
  { axis: ParallelParameter | null; axisRangeIndex: number | null; parameterKey: ParallelParameter | null },
  {
    intervals: readonly { axis: ParallelParameter; axisRangeIndex: number; parameterKey: ParallelParameter; min: number; max: number }[];
    value?: { min: number; max: number };
  },
  'none' | 'select'
> {
  activeBrushes: readonly { axisRangeIndex: number; parameter: ParallelParameter; min: number; max: number }[];
  brushIntervals: ParallelBrushIntervals;
  phase: 'preview' | 'commit';
  reason: 'clear' | 'create' | 'move' | 'remove' | 'resize-max' | 'resize-min' | 'set';
  modifiers: InputModifiers;
  source: BrushInteractionSource;
}

interface ParallelFastSelectionChangeEvent {
  activeBrushes: readonly { axisRangeIndex: number; parameter: ParallelParameter; min: number; max: number }[];
  brushIntervals: ParallelBrushIntervals;
  computeMs: number;
  filters: readonly ParallelFastSelectionFilter[];
  reason: 'clear' | 'create' | 'move' | 'remove' | 'resize-max' | 'resize-min' | 'set';
  selectedCount: number;
  source: BrushInteractionSource;
  sourceIndexCreationMs: number | null;
  sourceIndices: Uint32Array;
}

interface ParallelFastSelectionFilter {
  axisRangeIndex: number;
  parameterKey: ParallelParameter;
  range: { max: number; min: number };
  source?: { datasetKey?: string; tableKey?: string; fieldKey?: string };
  valueType: ParallelFastAxisKind | 'unknown';
  values?: readonly { encoded: number; label: string; value: boolean | number | string }[];
}

interface ParallelFastInspectionChangeEvent {
  inspection: ParallelFastInspectionState | null;
  lookupSource: 'fallback' | 'index' | 'none';
  resolveMs: number | null;
  source: BrushInteractionSource;
}

interface ParallelFastInspectionState {
  activeAxis: ParallelParameter;
  activeAxisValue: number;
  distancePx: number;
  id: string;
  normalizedAxisValue: number;
  projectedAxisPosition: number;
  projectedNormalizedValue: number;
  record?: { id: string; sourceIndex: number; table: string };
  recordIndex: number;
  segmentEndAxis: ParallelParameter;
  segmentStartAxis: ParallelParameter;
  source: 'e2e-inspect-record' | 'local-nearest-segment';
}
```

Important update semantics:

- `plot.update({ inspection })` is silent controlled inspection state. Use
  `plot.commands.setInspection(...)` when observers should receive
  `inspectionchange`.
- `plot.update({ brushIntervals })` is the parallel exception: it is treated as
  a committed brush update and emits brush/selection events.
- `commands.previewBrushIntervals(...)` is the lightweight path for drag
  previews and avoids full selection computation.

Parallel `selectionchange` emits `sourceIndices`, `selectedCount`,
`activeBrushes`, `brushIntervals`, `reason`, compute timings, and `filters`.
Each filter contains `parameterKey`, `axisRangeIndex`, `range`, `valueType`,
optional categorical/boolean `values`, and optional provenance `source`.

Parallel default binding setup usually needs a host-owned axis overlay:

```ts
const hoverIndex = createParallelHoverIndex(buffers);

plot.use(createDefaultParallelBindings({
  brushHitTest: createParallelDomBrushHitTest(),
  coordinateTarget: host,
  inputElement: shell.parentElement ?? shell,
  keyboardTarget: window,
  inspection: {
    getHoverIndex: () => hoverIndex,
    maxDistancePx: 28,
    smallDatasetFallbackRecordLimit: 20_000,
  },
}));
```

Rendering hovered/inspected line values for every parallel axis:

```ts
plot.on('inspectionchange', ({ inspection }) => {
  if (inspection === null) {
    setInspectionLabels([]);
    return;
  }

  const labels = buffers.axisOrder.flatMap((axis, axisIndex) => {
    const normalizedValue =
      buffers.normalizedValuesByAxis[axis]?.[inspection.recordIndex] ?? Number.NaN;

    // Missing axes in multi-table data route below the plot band; do not render
    // a normal crossing label for those non-finite axis values.
    if (!Number.isFinite(normalizedValue)) {
      return [];
    }

    const metadata = buffers.axisMetadataByAxis?.[axis];
    return [{
      axis,
      axisIndex,
      axisLabel: metadata?.label ?? axis,
      isActive: axis === inspection.activeAxis,
      recordId: inspection.id,
      table: inspection.record?.table,
      valueText: formatParallelFastRecordAxisValue(
        buffers,
        axis,
        inspection.recordIndex,
      ),
      xPercent:
        buffers.axisCount <= 1 ? 50 : (axisIndex / (buffers.axisCount - 1)) * 100,
      yPercent: (1 - normalizedValue) * 100,
    }];
  });

  setInspectionLabels(labels);
});
```

`inspection.activeAxisValue` is the raw value for the axis that produced the
nearest-line hit. For display text, prefer
`formatParallelFastRecordAxisValue(buffers, axis, inspection.recordIndex)`
because it handles numeric units, categorical labels, booleans, datetime-ns
per-record values, and missing values consistently with the route. Use
`buffers.normalizedValuesByAxis[axis][recordIndex]` only for rendered crossing
positions.

## Overlay Descriptor Reference

Scatter overlay kinds:

- `rectangle-zoom`
- `color-rule-brush`
- `rectangle-selection`
- `lasso`
- `committed-selection`
- `hover-guide`
- `measurement-guide`
- `cursor-tooltip`
- `navigator`
- `out-of-range-markers`
- `point-marker`

Histogram overlay kinds:

- `rectangle-zoom`
- `color-rule-brush`
- `rectangle-selection`
- `lasso`
- `committed-selection`
- `hover-guide`
- `measurement-guide`
- `cursor-tooltip`
- `custom`

Parallel overlay kinds:

- `axis-brush`
- `color-rule-brush`
- `inspection`

Listen to `overlaychange`, store descriptors in host state, and render them in
an overlay layer. Selection persistence should come from renderer styling driven
by selected source indices or selected bin/brush state, not from leaving
rectangle/lasso geometry on screen after commit.

All overlay descriptors have at least `id` and `kind`. Common descriptor shapes:

- Scatter and histogram rectangle overlays (`rectangle-zoom`,
  `rectangle-selection`, `color-rule-brush`) carry `rect` in CSS pixels.
  Histogram rectangle overlays may also carry `subplotId` and `binDescriptors`.
- Scatter and histogram `lasso` overlays carry CSS `points`.
- Scatter and histogram `committed-selection` overlays carry committed
  rectangle/lasso `shapes`; hosts normally clear or ignore those after styling
  reflects selection state.
- Scatter `hover-guide`, `cursor-tooltip`, and `point-marker` overlays carry
  CSS anchors/line positions. `navigator` carries `domain`, `window`,
  `windowLabel`, `rect`, and `viewportRect`. `out-of-range-markers` carries
  precomputed marker descriptors.
- Histogram `hover-guide` and `cursor-tooltip` carry a `bin` descriptor when a
  bin is known. `measurement-guide` carries current/reference canvas points.
  `custom` is reserved for host-specific descriptors.
- Parallel `axis-brush` and `color-rule-brush` carry `activeBrushes` and
  `brushIntervals`; `inspection` carries the current inspection payload.

`createParallelDomBrushHitTest()` is optional and tied to the default/demo DOM
axis overlay class contract. It looks for `.parallel-fast-axis-guide`,
`.parallel-fast-axis-brush`, `.parallel-fast-axis-brush-handle-min`,
`.parallel-fast-axis-brush-handle-max`, and `.parallel-fast-axis-brush-band`.
The axis guide must expose `data-axis`, and existing brush wrappers should
expose `data-axis-range-index` so move, resize, and right double-click removal
resolve the intended interval. Hosts that render axes in canvas, SVG, or
different DOM classes should provide their own `brushHitTest` instead of using
those class names blindly.

## Query And Provenance Handoff

Selection events are the backend-query handoff. Do not rebuild query ranges from
DOM overlays. Use `event.filters`.

Scatter filters describe the plotted X/Y dimensions for rectangle/lasso
selection. Histogram filters describe value/bin predicates. Parallel filters
describe active axis intervals. Categorical and boolean dimensions include
expanded `values` terms. Lasso filters include polygon points plus bounding
ranges.

All plots can echo optional provenance as `source: { datasetKey?, tableKey?,
fieldKey? }`. See "Provenance Setup And Lookup" for configuration and callback
lookup rules. The plot library carries provenance through events but does not
interpret it.

## Performance Guidance

- Keep hot-path data in typed arrays.
- Pass source indices through events; materialize row objects, IDs, panel data,
  and export text lazily in the app.
- Avoid recreating engines for viewport, selection, hover, style-scale, or
  overlay changes; use commands and `update`.
- Keep the host element at a stable size to avoid repeated canvas resizes.
- Coalesce pointer-preview work through default bindings or equivalent RAF
  scheduling.
- Scatter records should be sorted by nondecreasing X where possible; hover,
  selection, summary, and visible calculations use that ordering.
- For multi-million-point hover, create a reusable two-dimensional typed-array
  index with `createFastScatterHoverIndex(columns, { yKeys })` and pass it as
  `hoverIndex`. It remains valid across zoom/pan and preserves synchronous
  `hoverAtPoint` results; omitting it uses the sorted-X fallback.
- Histogram raw continuous bin-size changes should be debounced and can defer
  source-index membership materialization until export or settled UI state.
  The WebGPU Rust/WASM provider indexes continuous values once, visits only the
  visible candidate window on repeated builds, and reuses unchanged subplots.
- Parallel should build `webglSegmentBuffers` once with
  `includeWebglSegmentBuffers: true` and reuse buffers during interaction.
- Worker code is optional for scatter. Use `FastScatterAggregationController`
  or `FastScatterSelectionController` only when profiling shows main-thread
  aggregation or selection blocks interaction, provide host-owned module worker
  factories, dispose externally instantiated controllers, and keep the same
  command/event API.

## Validation In This Repo

Useful focused checks after changing reusable code or this guide:

```sh
pnpm typecheck
pnpm lint
pnpm lint:rust
pnpm check:aggregation-wasm
pnpm exec tsx tests/unit/scatterFastCoreBoundary.test.ts
pnpm exec tsx tests/unit/scatterFastEngine.test.ts
pnpm exec tsx tests/unit/scatterFastEngineBindings.test.ts
pnpm exec tsx tests/unit/histogramFastBoundary.test.ts
pnpm exec tsx tests/unit/histogramFastEngine.test.ts
pnpm exec tsx tests/unit/histogramFastEngineBindings.test.ts
pnpm exec tsx tests/unit/parallelFastBoundary.test.ts
pnpm exec tsx tests/unit/parallelFastColorRules.test.ts
pnpm test:unit
```

Boundary tests protect reusable `core` and `engine` layers from imports of React
routes, route state, app data modules, and demo-only fixtures.
