# Changelog

This changelog documents the standalone `m-charts` repository, beginning with
its initial migration. Entries are ordered newest first, and released entries
should remain unchanged.

## Vercel Function Streaming Demonstration

- Added a real, opt-in `/api/webgpu-stream` Vercel Function that returns one
  chunked Web `ReadableStream` containing a deterministic, hard-capped
  5,000-record JSON sample. Query parameters cannot increase its size; it uses
  `no-store`, protocol/count headers, route-level request cancellation, Fluid
  Compute, and an explicit 10-second maximum duration.
- Added `?webgpuData=stream-function` to the scatter, histogram, and
  parallel-coordinate WebGPU routes. All three pass `response.body` through the
  public incremental JSON-record decoder and their typed streaming adapters;
  none calls `response.json()` or materializes the complete HTTP payload first.
- Added a Vite development middleware backed by the same exported handler,
  endpoint/protocol and three-chart integration tests, overview links, and a
  deployment/verification guide. Large 1M/10M/25M modes remain browser-local
  and never invoke the function.

## WebGPU Histogram And Parallel Streaming

- Added non-breaking live typed-batch constructors for WebGPU histograms and
  parallel-coordinate plots, matching scatter's first-batch startup, optional
  count/capacity hints, progress, completion, cancellation, and loaded-prefix
  controller shape while retaining all static constructors.
- Preserved histogram selections and user viewports while rebuilding exact
  aggregation for each prefix. Parallel streams require prepared full-stream
  domains, retain brushes/axis viewports, append decoder-prepared pages to the
  resident renderer, and backpressure producers until each batch is visible.
- Added scatter-aligned `Streaming` actions to the overview and three-way
  dataset controls to both existing WebGPU demo routes. The live routes now
  page the same browser-generated IndexedDB datasets used by all-at-once mode
  (with the identical seeded local worker as the missing-cache fallback),
  report loaded-prefix progress, and support both single- and multiple-table
  inputs through the public streaming constructors.
- Kept histogram aggregation snapshots synchronized with geometrically growing
  streamed prefixes so subplot count axes grow without quadratic per-batch
  full-prefix copies/rebuilds, and explicitly render every published
  aggregation so canvas bars and color stacks match those axes.
  The seeded demo stream also uses the normal-table signal domains so continuous
  bin boundaries and axis labels remain identical between loading modes.
  Parallel streams append decoder-prepared GPU pages and increment only the new
  page's density contribution while capacity is available, grow unknown-count
  resident resources geometrically, retain CPU columns as zero-copy segmented
  views, refresh active brush membership, and maintain a bounded representative
  layer for smooth final interaction. Non-packed sources retain the sparse
  replacement fallback.

## WebGPU Scatter Streaming

- Added non-breaking live typed-batch ingestion for WebGPU scatter plots. The
  first batch creates an interactive plot and later batches append to persistent
  coordinate/style buffers while draws remain animation-frame coalesced.
- Made final stream size optional. Known counts preallocate typed CPU and GPU
  storage; unknown streams grow both stores geometrically with GPU-to-GPU copies
  of the loaded prefix.
- Added progress, completion, abort, prepared-domain/viewport policies, an HTTP
  JSON record-batch bridge, compact packed-style batches, and lazy global IDs.
- Allowed the live JSON/record bridge to omit its final count; known counts still
  preallocate and validate, while the legacy materializing loader remains
  explicitly known-count-only.
- Integrated IndexedDB-backed local and small paged-HTTP streaming samples
  into the regular `/m-scatter-webgpu` demo route so they share its axes,
  interactions, display modes, and sidebar. The former standalone URL now
  redirects there.
- Kept the last completed GPU frame interactive during appends, bounded
  in-progress stream previews to representative point draws, and deferred the
  exact full-population frame until explicit stream completion. Streaming now
  retains lazy IDs and batch-only packed styles, coalesces cached submissions,
  drops superseded in-flight previews, periodically drains bounded upload
  staging, and avoids redundant sortedness scans and compact upload copies. Demo
  progress state, navigator, and overflow bookkeeping no longer perform large
  unused work on the interaction thread. IndexedDB page deliveries stay within
  short interaction-friendly slices, prepared streams reuse their first page,
  and stream completion drains staged GPU work before the settled draw. The demo retains
  completed columns behind a ref instead of republishing the full typed-column
  graph through React state.
- Matched local and HTTP stream viewports to static scatter datasets by
  applying the shared axis-aware domain padding before the first streamed frame.
- Made first-batch waits abortable, cancelled released HTTP readers, and ensured
  failed or aborted streams leave their loaded prefix in the normal settled
  render mode. Automatic growing-domain viewports now stop following after the
  first user viewport interaction.
- Kept lazy streamed ID arrays iterable and compatible with standard array
  methods/JSON serialization, and accepted the shared `rotationRadians` alias in
  typed stream batches.
- Reported an explicit recreate requirement when device loss occurs after
  memory-bounded packed-style stream pages have been released, instead of
  surfacing a misleading packed-style length mismatch during recovery.

## WebGPU Parallel Coordinates

- Added `m-charts/m-parallel-webgpu` as a public export/type superset of
  `m-parallel`, retaining buffers, bindings, commands, events, overlays,
  selection filters, styling, themes, factory aliases, and controlled updates.
- Added paged record-major WebGPU storage, pairwise adjacent-axis compute
  binning, continuous random-color aggregation, analytic density alpha,
  selected/preselected density, direct rendering for small datasets, and an
  exact-style representative overlay for large data.
- Made the bounded exact-style overlay representative across axes and source
  order by retaining categorical values and numeric extrema, adding local
  block coverage, deduplicating must-keep records, and filling remaining
  capacity with deterministic pseudo-randomized bucket samples.
- Added asynchronous readiness, device-loss recovery, diagnostics,
  creation-only render/bin/LOD options, and compact
  `createParallelWebgpuBuffers` construction without WebGL expansion.
- Added exact worker-to-GPU packed-page streaming with prepared-domain buffer
  construction and fused representative collection. Hybrid `interactive` now
  resolves for the representative frame while `ready` retains the exact
  full-population density gate.
- Reduced exact aggregation overhead by skipping inactive membership/style
  reads, using a count-only uniform-style path, and combining categorical-pair
  integer bin updates per workgroup before applying identical global totals.
- Added scatter-compatible viewport refinement for hybrid parallel plots.
  Committed density passes now fuse a bounded GPU compaction of records inside
  every active axis viewport, lower a deterministic detail stride as the view
  narrows, and render every qualifying line at stride one without a CPU scan or
  second full-data pass. Preview remains immediate and hover follows the exact
  currently drawn population.
- Promoted the bounded viewport-refined detail layer to raw-derived,
  viewport-relative Float32 coordinates after a bounded GPU source-index
  readback. Refined rendering, hit testing, and the exact hover overlay now
  share one geometry at deep zoom, while the full-population density path keeps
  its compact 16-bit storage and single-pass performance. Inspection pauses
  during the transient representative preview until matching refined geometry
  is published.
- Added two-pass GPU hover reduction and exact hovered-line overlays. Direct
  and density-only modes search all records; hybrid mode searches its rendered
  representative population and maps the winner back to the exact public
  source index, preventing inspection from introducing unseen polylines.
- Made hybrid hover cover the complete visible rendering model. Exact detail
  lines retain a bounded fast path; density-only and overflow segments use a
  coalesced full-population GPU fallback whose winner is checked against raw
  viewport geometry. Axis-boundary hit tests now search both adjacent pairs,
  making lines arriving from either side reachable.
- Added Rust/Wasm multi-axis, multi-interval exact selection for memory-safe
  datasets with an exact TypeScript fallback for larger inputs.
- Deferred WebGPU brush membership until pointer release; drag previews now
  update only the lightweight brush overlay. Commits reuse background density,
  compute only selected bins and a compact candidate mask, validate exact raw
  values only for candidates, and avoid redundant streamed aggregation passes.
- Increased committed parallel-selection contrast by removing selected records
  from the background density count, mildly desaturating but preserving 62% of
  unselected density, retaining 42% of exact-color representatives, and drawing
  dense selected bundles as clean bright-yellow paths while reserving a subtle
  viewport-aware halo for sparse selected bins. Demo brush styling matches
  selection, and edge-axis brushes move inward so their values remain readable.
- Added axis viewport state and commands, single-axis left-drag box zoom,
  middle-drag pan, middle-click undo, reset, preview/commit events, and
  viewport-aware density. Pointer zoom/pan now uses lightweight drag feedback
  and recomputes the viewport and lines only once on pointer release.
- Aligned zoom and pan calculations and their feedback box with the reserved
  4%-to-92% normal-axis lane. The box no longer starts above or spans beyond
  the axis, and small committed drags use the complete visible axis height.
- Fixed brush creation and editing on zoomed axes so pointer positions are
  converted through the visible viewport domain, keeping the committed range,
  selection, and brush overlay aligned with the dragged area.
- Routed values outside a zoomed axis to fixed above/below overflow rails and
  kept missing values on a separate neutral rail. Rail positions are always
  reserved to avoid layout shifts, while labels appear only for active
  overflow or axes that actually contain missing values.
- Fixed inspection projection markers on segments connecting overflow or
  missing-value rails to normal axes by interpolating in rendered display
  space. The demo now persists committed per-axis zoom/pan ranges in
  `pf.<axis>.min`/`pf.<axis>.max` URL parameters and restores them on reload.
- Added `/m-parallel-webgpu` and its fixture with shared IndexedDB-backed
  1M/10M/25M datasets, single/multiple-table modes, controls, diagnostics,
  unit/Wasm tests, opt-in Playwright coverage, and a WebGPU benchmark.
- Reduced large parallel-coordinate startup memory by reusing compatible raw
  typed columns and packed RGBA styling, deriving normalized values page by
  page, and replacing large sparse identity arrays with lazy views.
- Moved paged dataset decoding off the chart thread, retained paged source
  views without full-column copies, quantized normalized GPU coordinates to
  16 bits, retained compact RGBA4444 density styles on the GPU, and kept RGBA8
  only for the bounded representative style layer on large inputs. Viewport
  commits now avoid per-page repacking/uploads, publish density only after a
  complete pass, and recompute only pairs adjacent to changed axes.
- Fixed large-data density color/opacity by decoding the shared dataset's
  packed RGB565/opacity records before RGBA compaction. Retained 16-bit
  coordinate precision for the full-population density path; bounded refined
  detail now uses viewport-relative Float32 coordinates for hover alignment.
- Aligned the parallel WebGPU dataset sidebar and lifecycle with scatter and
  histogram: segmented size/table controls use full-document navigation, while
  local generation, progress, cancellation, reuse, and deletion are explicit.
- Routed WebGPU device-loss/restoration and renderer metrics through the shared
  typed engine events and option callback, preserved custom hover dependencies
  and current diagnostics across renderer replacement, retained command-driven
  brush/viewport/inspection state across controlled buffer updates, kept
  asynchronous selection payloads tied to their committed brush snapshot, and
  added the source-copy migration guide with WebGL2 fallback and compact-buffer
  compatibility guidance.

## WebGPU Histogram

- Added `m-charts/m-histogram-webgpu` as a compatibility-superset entry point
  with the same histogram options, bindings, commands, events, callbacks,
  overlays, styling, raw-data mode, and pre-aggregated bar mode.
- Extracted a renderer- and aggregation-neutral histogram engine. The existing
  `m-histogram` WebGL2 constructor remains compatible and retains its TypeScript
  aggregation behavior.
- Added asynchronous WebGPU instanced-bar rendering with readiness gates,
  device-loss/error lifecycle reporting, diagnostics, and exact rendering of
  every resulting bin/stack segment.
- Added selectable `auto`, `rust-wasm`, and `typescript` aggregation.
  Rust/WASM is preferred for compatible typed continuous, unsigned-integer
  categorical/boolean, and packed-rgba32 color data; unsupported shapes and
  custom out-of-row-range selection shapes use the exact TypeScript path.
  Scatter and histogram now consume one reproducibly generated shared
  aggregation binary.
- Added persistent sorted row-order indexes for continuous Rust/WASM histogram
  parameters. Viewport and bin-size rebuilds binary-search the visible window,
  reuse unchanged subplot results, report deterministic visited-row/reuse
  diagnostics, and materialize exact membership without a TypeScript fallback.
- Removed the redundant second aggregation pass after bin-size changes when
  viewport normalization only changes the count-axis range.
- Added `pnpm benchmark:histogram:webgpu`, including deterministic visited-row
  and unchanged-subplot reuse gates plus reported setup/full/zoomed timings.
- Deferred-membership selections now report the exact sum of selected bin
  counts immediately while leaving the source-index array pending.
- Fixed histogram viewport reset so one action restores the complete
  full-dataset ranges for every subplot, including viewport-bound WebGPU
  aggregation, instead of expanding the current visible bin window in steps.
- Updated the shared pre-aggregated histogram demo payload so every parameter,
  including Signal value, demonstrates four-color stacked bars consistently in
  both the WebGL2 and WebGPU routes.
- Added `/m-histogram-webgpu` with the same browser-generated, paged 1M, 10M,
  and 25M dataset, three parameters, palette, and secondary-table fixture used
  by the WebGPU scatter demo, plus pre-aggregated bars, full-refresh heavy
  controls, and aggregation-backend comparison.
- Added package/export compatibility, detailed Rust/WASM equivalence, fallback,
  route, exact-frame, and reset-viewport tests.
- Added WebGPU histogram API, architecture, source-copy migration/fallback,
  lifecycle, diagnostics, validation, README, `llms.md`, and troubleshooting
  documentation consistent with the WebGPU scatter release.

## WebGPU Scatter

- Added `m-charts/plot-engine-webgpu` and `m-charts/m-scatter-webgpu` as an
  alternative WebGPU renderer for point, bubble, and heat-map scatter plots.
  The existing scatter, histogram, and parallel-coordinate renderers remain on
  WebGL2.
- Kept the WebGPU entry point compatible with the public `m-scatter` contract,
  including columns, options, bindings, commands, events, overlays, callback
  payloads, factory aliases, and shared host/canvas CSS hooks. Existing scatter
  integrations can adopt WebGPU primarily by switching the renderer import.
- Preserved scatter styling and interaction behavior across both renderers,
  including zoom, pan, hover, measurement, rectangle/lasso selection, point
  markers, navigator controls, palettes, themes, and controlled updates.
- Added bounded high-density point rendering. Settled views draw every visible
  point through one million points per subplot and otherwise use a deterministic
  sample capped at one million representatives. Rectangle/lasso selection
  payloads remain exact over the complete source data; hover and selected
  overlays follow the rendered sample and refine as the visible range narrows.
- Added bounded bubble and heat-map aggregation. Supported sorted-X inputs use
  Rust/WebAssembly by default, with the exact TypeScript implementation as a
  safe fallback. The WebGPU-only `aggregationBackend` creation option selects
  `auto`, `rust-wasm`, or `typescript`, and diagnostics report the requested and
  active backend.
- Added known-count record-batch and incremental JSON streaming ingestion
  adapters that encode bounded batches into preallocated typed columns, report
  progress, support cancellation, and avoid retaining a complete JSON object
  graph.
- Added the WebGPU-only creation options `aggregationBackend`, `indexedStyle`,
  `packedStyles`, and `requestTimestampQuery`. The WebGPU factory accepts the
  WebGL2-only `forceWebglUnavailable`, `preserveDrawingBuffer`, and
  `rendererFactory` fields so applications can reuse shared option objects.
- Added asynchronous `interactive` and `ready` startup gates,
  `diagnoseWebgpuSupport()`, `getWebgpuDiagnostics()`, lifecycle error reporting,
  and device-loss recovery. WebGPU requires a secure context and a compatible
  adapter/device; applications can retain the WebGL2 factory as a
  host-controlled fallback when WebGPU or dataset initialization is unavailable.
- Added `/m-scatter-webgpu` and `/m-scatter-webgpu-fixture` demo routes with 1M,
  10M, and 25M browser-generated datasets, IndexedDB reuse, full-refresh
  dataset-size and single-/multiple-table controls, aggregation-backend
  controls, compact dataset details, and live diagnostics.
- Added WebGPU migration, source-copy, API, architecture, validation, benchmark,
  and troubleshooting documentation.

## Initial Migration

### Required Compatibility Changes

- Reusable chart source now lives under `packages/m-charts/src`.
- Shared plot-engine imports moved from the previous direct source layout to:

  ```text
  packages/m-charts/src/plot-engine
  ```

- Scatter imports moved to:

  ```text
  packages/m-charts/src/m-scatter
  ```

- Histogram imports moved to:

  ```text
  packages/m-charts/src/m-histogram
  ```

- Parallel-coordinate imports moved to:

  ```text
  packages/m-charts/src/m-parallel
  ```

- Demo-only application code, routes, generated-data loaders, URL state, theme
  state, panels, and CSS now live under `apps/demo`.
- Demo route paths changed to the `m-*` names:

  ```text
  /m-scatter
  /m-parallel
  /m-histogram
  ```

- Source-copy integrations should copy the needed `packages/m-charts/src`
  folders into the host application and rewrite imports to local copied module
  paths.
- `m-charts` is not published to npm yet, so `npm install m-charts` is not a
  supported consumer path.

### Preserved Compatibility

- The chart engines preserve the public command, event, update, binding, and
  dispose lifecycle shape as far as possible.
- Local workspace imports are available for the intended package boundary:

  ```ts
  import { createEmitter } from 'm-charts/plot-engine';
  import { createScatterPlot } from 'm-charts/m-scatter';
  import { createHistogramPlot } from 'm-charts/m-histogram';
  import { createParallelPlot } from 'm-charts/m-parallel';
  ```

- Compatibility aliases are available inside the workspace for older package
  import names:

  ```ts
  import { createScatterPlot } from 'm-charts/scatter';
  import { createHistogramPlot } from 'm-charts/histogram';
  import { createParallelPlot } from 'm-charts/parallel';
  ```

### Validation

Use the current repository commands after migrating imports:

```sh
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```
