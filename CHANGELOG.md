# Changelog

This changelog documents the standalone `m-charts` repository, beginning with
its initial migration. Entries are ordered newest first, and released entries
should remain unchanged.

## Parallel WebGPU interaction and startup performance

- Fuse picking and highlight projection into one compute pass. Reuse GPU geometry
  for the latest result, reduce match counts on the GPU, batch uniform uploads,
  and cache bind groups. Decode IDs directly from mapped memory; only older or
  resized results reconstruct a membership mask for reprojection.
- Add a real 25M-row four-axis crossing benchmark with sustained pointer movement,
  plus concurrent-result and resize pixel checks. Preserve all matched IDs and
  existing picking tolerance.

- Project and merge dense hover groups on the GPU, using resident coordinates,
  a screen-sized segment occupancy mask, and indirect drawing. Preserve all
  matched source IDs and the public Canvas 2D overlay; bound geometry to 64 MiB.
- Avoid main-thread comparisons of millions of identical group IDs on every
  pointer update. Validate overlay rendering, clearing and complete interaction
  timing in addition to picking at 1M, 10M and 25M rows.
- Preserve worker-packed pages for unchanged client coordinates/styles, decode
  semantic fields lazily, cache compact page views, and use deterministic demo
  manifest versions and prepared filter ranges instead of scanning every row
  during React rendering. Yield between fallback packing chunks of 250k rows.

## Parallel WebGPU overlap inspection

- Highlight every active record within 3 CSS pixels of the pointer, including
  full-population matches hidden underneath representative lines. Return all
  matches without a cap, with source-order deduplication and viewport/filter support.
- Add optional `sourceIndices` and `hitRadiusPx` to inspection payloads while
  preserving nearest-record fields. Support group overlays through optional
  `setHoverSourceIndices`; WebGL2 retains its existing behavior.
- Show the match count and tolerance in the demo, dim the background, and show
  individual axis values only for a single match. Clear the group on hover exit.

## Directional parallel range reset

- Add keyboard-accessible ↑/↓ pills to the shared WebGPU and WebGL2 demo axis
  overlay. Restore only one axis bound, preserving other bounds and brushes,
  using the existing viewport command and URL persistence.
- Keep missing-value ∅ rails inert and spatially separate from the reset
  pills, with light/dark styling and tooltips distinguishing both meanings.
- Label the pills “↑ Reset” / “↓ Reset” and center them directly on their blue
  rails without elbow connectors; use matching rounded styles for endpoint labels.
  Place the lower control above overflow, label the separate rail “∅ Missing”,
  and align endpoint values away from the controls. Truncate long endpoint
  labels with their full values available on hover.

## Parallel zoom preserves the population

- Keep the same hybrid representative source rows across axis zoom, pan, and
  reset. Zoom changes only scales; brushes and explicit filters retain their
  separate selection/filtering roles.
- Keep untouched density pairs visible while affected pairs recompute. Preserve
  Float32 representative and hover precision, missing values, and overflow rails
  without viewport-qualified compaction or source-index readback.
- Retain legacy refinement diagnostics with zero counts and stride one, and
  clarify zoom behavior in demo guidance and package documentation.

## Resumable streaming viewport following

- Add full-data bounds/following events and fit-once, pause, and resume controls
  to all three WebGPU streaming adapters; preserve expand/preserve options.
- Identify stream/fit viewport changes and offer an opt-out interaction binding
  so applications retain policy ownership. Keep controls alive after streaming
  completes and preserve preview viewports during parallel updates.
- Fit histograms from full data even when the displayed bins are zoomed;
  support both TypeScript and Rust/WASM aggregation without changing backends.
- Add demo following status, fit/pause/resume controls, reset-to-latest behavior,
  paced-stream browser test controls, and policy/full-data fitting regressions.

## Deployment type resolution

- Add the missing `m-charts/client-data-view` source mapping to the demo and
  tooling TypeScript configurations, matching Vite and the other chart entries.
  Demo builds no longer depend on existing package output to resolve client-view
  types, preventing missing-module and cascading type errors in deployment.

## Responsive parallel hover after zoom

- Bound default parallel hover to one lookup in flight with the latest pointer
  queued, preventing slow GPU readbacks from starving updates during movement.
- Invalidate pending inspection on Shift release, pointer leave, viewport changes
  and disposal. Preserve synchronous WebGL2 inspection behavior.
- Replace per-record global atomic picking with workgroup distance/source-index
  reductions and a final winner reduction. Reuse leased GPU scratch buffers;
  preserve full-population fallback, tolerances and deterministic source IDs.
- Add scheduler regressions and an in-app browser fixture covering 1M/10M rows,
  zoom, missing/overflow lanes, filtering, exact selection and concurrent queries.

## Consistent WebGPU demo pipelines

- Shared the scatter-based pipeline panel, summaries, rule lists, diagnostics,
  and state import/download across all three resident WebGPU demos.
- Made histogram/parallel preset filters and affine/difference transforms update
  existing rules, while keeping numeric-field and difference-order controls.
- Aligned selection actions, Alt+I / Alt+O shortcuts, reset behavior, and transform
  viewport fitting; fixed histogram fitting after large transformed value shifts.
- Resolve deferred histogram selection membership when a pipeline keep action
  needs source indices, so bin selections enable keep-inside/outside immediately.
- Added browser regressions for repeated edits, rule order, invalid imports,
  transformed ranges, reset, and theme changes. The E2E server port can now be
  overridden with `M_CHARTS_E2E_PORT`.

## Client pipeline documentation

- Added a dedicated README overview and architecture diagram explaining the
  optional client pipeline, large-dataset use cases, and CPU/WASM versus GPU
  residency and update costs.
- Added a complete source-copy example for filters, calculations, styles,
  updates, state persistence/reset, worker setup, and disposal, with links from
  chart guides and an agent integration checklist.
- Corrected source-copy dependency instructions and clarified field mappings,
  complete-item updates, streaming/bar-mode limits, and dataset lifecycle.

## Client pipeline residency and validation

- Kept scatter GPU source buffers resident during theme updates and added cumulative
  source-upload/resource-build diagnostics for scatter and parallel.
- Replaced scatter interaction copies with visibility-mask checks, including exact
  selection, hover and TypeScript/WASM bubble/heatmap aggregation.
- Retained histogram columns and sorted indexes across mask-only filters in both
  TypeScript and Rust/WASM; rebuilt only derived coordinates when necessary.
- Normalized difference overflow and tightened unknown calculation-operator validation;
  documented and tested the application-independent predicate contract.
- Aligned demo import/export, enable/reorder controls and additive style presets.
- Added submitted-GPU-work fences, in-app GPU regression fixtures, 1M/10M/25M
  latency/allocation/upload benchmarks, and a mandatory `pnpm test:release` gate.

## WebGPU Parallel and Histogram Client Data Views

- Pinned Rust 1.98.1 with the WASM target, rustfmt, and Clippy, documented local
  toolchain setup, and regenerated the aggregation binary with that compiler.

- Added client expression calculations (arithmetic, math, text, coalesce, case),
  field/expression comparisons, text predicates, transformed-stage filters and
  direct field style channels. Extended state uses version 2; legacy state and
  synchronous APIs remain compatible.
- Added optional bounded module-worker evaluation, atomic async batches, same-row
  field updates, precommit chart validators, disposal and content fingerprints.
  Demos use workers and content identity and expose the extended controls.
- Fixed semantic category/boolean/datetime decoding, transformed axis metadata,
  indexed scatter style inheritance, histogram unmatched colors and style-only
  selection preservation, and parallel mask-only coordinate reuse. Histogram
  specs can update resident subplots/parameters with a client view attached.
- Added real-worker unit regressions and an in-app-compatible actual WebGPU/WASM
  browser fixture, covered by the opt-in GPU E2E suite and TypeScript checks.

- Added optional creation-bound parallel and raw histogram client-view bindings,
  dataset/projection helpers, shared state/events, filtering, ordered numeric
  transformations, and color/opacity composition with source-style opt-out.
- Preserve row IDs and source indices through filtering, GPU visibility, exact
  TypeScript/WASM selection and histogram membership. Recalculate transformed
  domains; exclude filtered parallel rows from its missing-value lane and hover.
- Reuse the parallel GPU device and unchanged coordinate/style buffers; coalesce
  rapid revisions and expose pending/upload diagnostics. Histogram style edits
  reuse sorted WASM and TypeScript coordinate indexes.
- Fixed direct parallel draws interpreting paired density styles as full RGBA
  colors. They now decode the existing packed style representation correctly.
- Added resident demo controls, exact selection filters, reset and JSON import/
  export. Parallel waits for immutable decoded CPU columns before attaching its
  view. Streaming and pre-aggregated bar demos keep their existing behavior.
- Added unit and actual-WebGPU regression coverage for optionality, mixed fields,
  source identity, empty/sparse filters, all parallel modes, histogram backends,
  styles, transformations, rapid updates, reset and demo interactions.
- Updated package guides, API notes and source-copy migration instructions.
  No client binding is required by existing chart integrations.

## WebGPU Scatter Client Data Views

- Full-suite validation also fixed the parallel streaming controller returning
  stale `getBuffers()` results after a packed-page append. Progress callbacks
  now expose the same resident prefix as the renderer; the demo snapshots that
  prefix's metadata so subsequent in-place GPU appends cannot race its progress UI.

- Added applied-revision/pending diagnostics, prevented stale exact frames while
  a projection uploads, and exercised paged-style composition, sparse filters,
  LOD, and reset on ten million GPU-resident rows.

- Fixed streaming capacity growth to resize visibility storage without a client
  view, client-view culling for unsorted/nonfinite X, and conditional color rules
  losing the theme fallback. Source hover indexes are bypassed after coordinate
  transforms and restored when transforms are removed.
- Reuse unchanged evaluator stages, masked interaction columns, and derived GPU
  buffers. Constant styles encode once; ordered differences avoid redundant
  sorting. Rapid GPU revisions coalesce without retaining every intermediate
  projection, and canceled uploads release their temporary buffers.
- Isolate subscriber failures through optional `onListenerError(error, event)`
  (default: console.error), freeze configuration snapshots, and preserve event
  order during reentrant edits. Reject streaming append with an attached,
  creation-bound client view before mutation.
- Added CPU caching/error/order regressions and real-GPU pixel comparisons for
  source compatibility, theme updates, streaming growth, rapid resets, and hover.

- Expanded the demo with finite scale/offset controls, difference direction,
  missing-neighbor and grouping options, independent style channels, all five
  glyphs, category/gradient colors, and a glyph inspection zoom. Added a
  dismissible selection popup and bounded state previews with full JSON downloads.
  Reset viewport now retains the domain of active transformations.
- Selection filters now freeze selected source rows, work after transformations,
  and compose across successive selections. Large membership filters use set
  lookups; disabled transforms no longer expose nonexistent derived fields.
- Added transformed-selection and configurable-control regressions, native
  macOS GPU test flags, and composited WebGPU screenshot comparisons.

- Added an additive, chart-independent typed client data-view API with a
  JSON-serializable predicate AST, numeric/datetime/categorical/boolean fields,
  filter-first affine and ordered/partitioned difference transforms, and
  computed color/opacity/rotation/shape/size rules.
- Integrated the controller with WebGPU scatter while retaining immutable
  source coordinate/style buffers. View changes replace only visibility and
  derived buffers, expose state/change callbacks and diagnostics, preserve or
  ignore embedded, static-packed, and paged-packed base styles, and never
  initiate network work. Paged styles remain GPU-resident and compose with
  per-channel client overrides without expanded CPU copies.
- Added host-wired inside/outside multi-region selection filters, keyboard
  actions, presets, inspection/removal/reset controls, and state/performance
  diagnostics to `/m-scatter-webgpu`, plus unit/E2E coverage and a detailed host
  integration/persistence/query-adapter guide.
- Fixed sorted-X draw-range culling after a client filter. The renderer now
  derives the draw span from resident/render coordinates and gives an ordered
  active-index list the full LOD budget, so sparse box/lasso filters no longer
  render an empty chart, an unrelated contiguous X prefix, or a biased
  source-stride sample above one million rows.
- Hardened client-view interaction ordering, imported-state operator and typed
  operand validation, detached nested state, preserved RGBA8 style metadata,
  and bigint-first nanosecond differences. Source-column replacement is now
  rejected while a view is attached instead of desynchronizing CPU and GPU
  state.

## Scatter X Reference Lines

- Added application-owned, multi-line X reference annotations to the shared
  scatter engine and WebGPU entry point. Lines use arbitrary finite encoded X
  coordinates, can span all or selected subplots, retain point/bubble/heat-map
  compatibility, and remain distinct from double-click source-index point
  markers.
- Added overlay-only commands, typed create/change/hover events and callbacks,
  programmatic video-playhead updates, configurable create/drag/hover gestures,
  proximity highlighting, `col-resize` feedback, RAF-coalesced live dragging,
  and customizable stroke/dash/opacity/width presentation. Reference-line
  interaction never scans points, rebuilds aggregation, uploads GPU buffers, or
  schedules WebGL2/WebGPU drawing.
- Added the WebGPU scatter demo workflow: `Alt`/`Option` + double-click creates
  an optimistic line through a host-owned naming dialog, direct line dragging
  moves it, `Shift` + hover shows its formatted value, and the sidebar supports
  rename, individual deletion, and clear-all. Canonical datetime reference
  records persist for the browser session, re-encode across compatible time X
  columns, and remain stored but hidden on incompatible axes. The naming dialog
  supports `Escape` cancellation with opener-focus restoration and preserves
  create-versus-rename cancellation semantics.
- Reference-line replacement and plot updates now reconcile active hover state,
  publishing changed labels/values and clearing removed, out-of-range, or
  no-longer-scoped hovered lines. Added engine/binding/projection/E2E coverage
  and updated the scatter, WebGPU, README, migration, and LLM API documentation.

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
- Explicitly opted the plain Vercel Function into the Web API handler interface,
  fixing production `FUNCTION_INVOCATION_FAILED` responses caused by the legacy
  Node request/response bridge.
- Made the function's traced TypeScript protocol import use the emitted `.js`
  runtime suffix, preventing a startup failure in Vercel's compiled function.

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
