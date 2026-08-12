# WebGPU Parallel Coordinates

`m-charts/m-parallel-webgpu` is an export and type superset of
`m-charts/m-parallel`. Existing integrations keep their buffers, options,
bindings, commands, events, overlays, themes, and selection payloads and switch
the constructor import:

```ts
import {
  createParallelPlot,
  type ParallelWebgpuPlotInstance,
} from 'm-charts/m-parallel-webgpu';

const plot = createParallelPlot(host, { buffers });
await plot.interactive;
```

The original `m-parallel` entry remains WebGL2. A host may dispose a failed
WebGPU instance and create the WebGL2 plot as its product fallback.
See the [copy-ready migration example](../../docs/examples/parallel-webgpu-migration.md)
for source-copy paths, startup handling, and a complete fallback lifecycle.

## Live typed streams

Static `buffers` remain supported. To create the plot as soon as the first
typed batch arrives, switch only the constructor and data option:

```ts
import { createParallelWebgpuStreamingPlot } from 'm-charts/m-parallel-webgpu';

const plot = await createParallelWebgpuStreamingPlot(host, {
  dataSource: {
    batches, // AsyncIterable<{ columns, packedPage? }>
    domainsByAxis, // prepared domains for the complete stream
    expectedCount,
  },
  theme,
});

await plot.interactive;
await plot.streaming.done;
```

The plot remains interactive between batches. While resident capacity is
available, a decoder-prepared `packedPage` is appended immediately and only
that page is added to the existing density bins; prior pages, pipelines, and
interaction state remain resident. Unknown streams grow capacity geometrically
and rebuild all resident pages only when they cross a capacity boundary.
Sources without packed pages retain a geometrically growing replacement
fallback. Stable full-stream domains are required so already
visible polylines do not move when a later batch extends an axis.
`expectedCount` and `initialCapacity` are optional hints; a supplied expected
count reserves streaming membership capacity and is validated at completion.
`plot.streaming` exposes `done`, `abort()`, `getBuffers()`, and `getProgress()`.
A failed or aborted source rejects `done` while leaving the loaded prefix
available until disposal.

The repository's `?webgpuData=stream-function` demo maps the same genuinely
chunked Vercel Function response used by scatter into parallel columns and
packed pages and never materializes the complete HTTP body. See the
[server-function streaming guide](../../docs/server-function-streaming.md).

Decoders that already produce quantized record-major values may attach a
`packedPage: { start, count, values, densityStyles }` to each batch. These pages
are uploaded directly once, avoiding repeated CPU normalization, packing, or
full-prefix GPU uploads. Each page contributes a proportional bounded
representative sample for direct rendering and hover. CPU columns are likewise
retained as segmented views instead of being recopied into a new full-prefix
allocation. Every batch must use the same axis order and must consistently
include or omit `packedPage`. Active brushes are re-evaluated against arriving
rows so public selection counts and source indices do not become stale.
The stream owns `buffers`; other mutable interaction/theme options remain
available through `plot.update(...)`.

The `/m-parallel-webgpu?webgpuData=stream-local` demo progressively delivers
the same generated typed data and keeps brush/viewport interaction enabled.

## Large-data renderer

The renderer does not expand one WebGL vertex buffer per adjacent-axis
segment. It pages normalized record-major values into storage buffers and runs
a compute invocation for every record. Each invocation evaluates all brushes,
writes GPU membership bits, increments one pairwise screen bin per
adjacent-axis segment, accumulates quantized RGB/opacity, and
increments independent selected and preselected counts.

The render pass draws one weighted line for every possible bin and discards
empty bins. Analytic alpha `1 - (1 - alpha)^count` represents repeated
transparent lines without drawing every source segment.

Automatic mode draws every line directly while the segment count fits
`directSegmentLimit`. Larger datasets use density plus up to
`representativeRecordLimit` deterministic exact-style records. The bounded
representative set retains every axis's numeric extrema and categorical values
when they fit, adds category or extrema coverage across source-order blocks,
deduplicates records selected by multiple axes, and fills remaining capacity
with one pseudo-randomized record per source-order bucket. If mandatory
coverage exceeds the limit, extrema take priority and categories are admitted
round-robin across axes. Set
`renderMode: 'direct' | 'density' | 'auto'` to override this creation-time
choice. `binResolution` defaults to 256 and is bounded to 32–1024.

On committed axis zoom or pan, hybrid mode fuses viewport refinement into the
affected-pair density pass. A record qualifies when its value lies inside every
active axis viewport. Wide views use a deterministic source-index hash stride
to keep the detail layer bounded by `representativeRecordLimit`; as viewports
narrow, the stride decreases, and at stride one every qualifying record is
drawn. The GPU reads back only the bounded compacted source-index list, then
uploads raw-derived, viewport-relative Float32 detail coordinates and exact
styles. This adds no full-data CPU scan, page repack, second full-data pass, or
unbounded readback. During pointer preview the original representatives provide
immediate feedback; the refined layer is published atomically with completed
density. Inspection pauses during that transient representative preview and
resumes against the matching refined geometry. Exact detail hits use the
bounded fast path. If no detail line lies within two pixels, hover searches the
complete resident GPU population, which makes density-only and above/below
overflow segments inspectable. Full-population fallbacks are coalesced so
pointer bursts cannot queue repeated large scans. Near an axis, both adjacent
segment pairs participate in hit testing.

Arbitrary per-record colors use continuous aggregate color in the density
layer and exact colors in the representative layer. Transparent source-order
compositing is intentionally order-independent in density mode. Selected and
preselected density use the theme's uniform overlay colors.

## Selection, hover, and Wasm

During a pointer brush, preview events and the lightweight brush box update
without recomputing line membership. Brush membership is evaluated in the GPU
density pass only when the pointer is released and the brush commits. Commit
uses a selection-only compute pass: it preserves the existing background bins,
does not restream per-record colors, and reads back a compact padded candidate
mask. Exact CPU finalization validates only those candidates against raw source
columns. The public `selectionchange` remains WebGL-compatible and contains
exact source indices.
`aggregationBackend: 'auto' | 'rust-wasm' | 'typescript'` controls exact CPU
finalization:

- `auto` uses the shared Rust/Wasm binary through two million rows, where its
  persistent typed-column copy has a bounded memory cost;
- larger inputs retain GPU-resident density and use exact source columns
  instead of duplicating hundreds of megabytes into Wasm;
- `typescript` always selects the compatibility implementation.

Committed selected density is rendered last with stronger opacity. Background
counts exclude selected records while a selection is active, so bins consisting
only of selected paths show the selection color without the original series
color underneath. Remaining density keeps 62% opacity with mild desaturation,
while exact-color representatives retain 42%. Dense selected bundles render as
clean bright-yellow paths; only sparse selected bins receive a subtle,
viewport-aware contrasting halo. This keeps the full population readable,
avoids dark hatching in dense selections, and makes sparse selected paths
independent of the underlying series palette.

Shift-hover runs a two-pass GPU reduction. Direct and density-only modes search
the complete dataset. Hybrid mode searches the currently drawn population:
initial representatives at the full view and viewport-refined lines after a
committed zoom. GPU-resident source mappings return the public source index
without reading back the compacted population. This prevents hover from
introducing a polyline that was only implicit in aggregate density. Only the
winning record is read back, and stale asynchronous results are discarded.

## Axis viewports

Axis viewports are independent of selection brushes:

- left-drag a brush-like vertical box to zoom the nearest axis only;
- middle-drag near an axis to pan that viewport;
- middle-click undoes the latest viewport;
- `commands.resetAxisViewports()` restores every full domain.

Use `commands.setAxisViewports(...)`, `commands.undoAxisViewport()`, and the
`axisviewportpreview`/`axisviewportchange` events for controlled integrations.
Pointer zoom and pan show only a lightweight axis overlay while dragging, then
commit the viewport and recompute only density pairs adjacent to changed axes
once on pointer release. Density becomes visible only after that submitted
aggregation completes, so page-by-page work cannot appear as a gradual opacity
change.
Programmatic previews remain available through `commands.setAxisViewports()`.
Brushes retain raw-value semantics.

Values outside a committed axis viewport route to fixed rails just beyond the
visible axis instead of appearing to stop at its endpoints. The demo reveals
the blue above/below rail labels only when that axis is zoomed and data exists
beyond the corresponding boundary. Missing values use a separate neutral rail
below them; it is labeled only on axes with missing records. All three rail
coordinates are permanently reserved, so zoom and reset do not move the axes
or surrounding layout. `ParallelBuffers.missingValueCountByAxis` exposes the
per-axis counts for host overlays.

The demo serializes committed ranges as
`pf.<axis>.min`/`pf.<axis>.max`, preserving them across refreshes while keeping
drag previews out of the URL. This is route-owned state: library integrations
continue to pass initial ranges with `axisViewports`, update them with
`commands.setAxisViewports(...)`, and subscribe to viewport events. Inspection
projection interpolates in display space so its marker remains directly on
segments connecting normal axes, overflow rails, or missing-value rails.

## Compact buffers and diagnostics

`createParallelWebgpuBuffers(columns)` skips line-strip and WebGL segment
allocations. It reuses compatible `Float32Array` and unsigned-integer raw
columns plus packed RGBA8 style data without changing exact hover or brush
values. Normalized values are
derived page-by-page during GPU upload instead of being retained as another
full-dataset copy. Use `readParallelNormalizedValue(...)` for on-demand CPU
access. Use `createParallelFastBuffers` when Float64 raw selection boundaries
are required or the same buffers must feed WebGL.

The demo decoder runs in a worker, prefetches source pages, and streams each
page into the renderer after fusing domain-aware normalization, coordinate
quantization, density-style packing, and representative collection. It does
not materialize full identity, timestamp, categorical, or RGBA columns. The GPU
stores normalized coordinates as two 16-bit values per word and compact
RGBA4444 density styles as two records per word. These full-population buffers
remain resident, while the bounded exact-color representative layer keeps
RGBA8 styles. Zoom aggregation therefore submits one compute pass without
repacking or re-uploading pages, keeps full-dataset population coverage, and
bounds chart-tab and GPU memory. Committed hybrid refinement promotes only its
bounded detail population to viewport-relative Float32 coordinates. Direct
detail rendering and GPU hover therefore use the same raw-derived geometry as
the hovered-line overlay even at deep zoom. Any remaining repeated axis levels
come from the source encoding (for example the demo signal column's 0.0025-unit
scale), categorical data, or screen-bin density resolution rather than the
detail-coordinate encoding.
The demo adapter explicitly converts the shared scatter dataset's packed
RGB565/opacity/style metadata into RGBA8 before density compaction.

`interactive` resolves after device creation, paged upload, and the submitted
exact-style representative frame. `ready` resolves after the unchanged
full-population density aggregation and its submitted frame complete. Direct
or density-only modes have no representative preview, so both gates resolve
with the first complete frame.
`getWebgpuDiagnostics()` reports device limits, pages, resident/upload bytes,
render mode, bin counts, representative/direct/refined and viewport-qualified
counts, refinement stride, selection backend, hover search count, style mode,
selected count, and the latest aggregation/render/hover timings.
Diagnostics also report 16-bit full-population density coordinates, 32-bit
refined-detail coordinates, full-population hover fallback count/usage, and how
many adjacent-axis pairs the latest density pass recomputed.

Creation-only options are excluded from `plot.update(...)`:

- `aggregationBackend`
- `binResolution`
- `directSegmentLimit`
- `renderMode`
- `representativeRecordLimit`
- `requestTimestampQuery`

The WebGL2-only `forceWebglUnavailable` and `rendererFactory` options are
accepted and ignored so a shared options object remains valid after switching
factories. A custom `hoverRendererFactory` remains active, and
`preserveDrawingBuffer` is forwarded to it without configuring the WebGPU
surface. Device loss/restoration and renderer-produced metrics flow through
both the option callback and the typed `contextlost`, `contextrestored`, and
`metrics` engine events.

## Demo and validation

- `/m-parallel-webgpu` supports the shared browser-generated 1M, 10M, and 25M
  IndexedDB datasets.
- `?tables=multi` adds the fixed secondary table and table axis.
- Dataset size and table mode use full-document navigation so the previous
  chart and its GPU/CPU buffers are released before another large dataset is
  loaded. The route exposes the same explicit local generation, progress,
  cancellation, reuse, and deletion flow as the WebGPU scatter demo.
- `/m-parallel-webgpu-fixture` is the small package fixture.

Run:

```sh
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
pnpm lint:rust
pnpm check:aggregation-wasm
pnpm benchmark:parallel:webgpu
```

Hardware-backed WebGPU rendering, zoom, and hover validation is opt-in:

```sh
M_CHARTS_ENABLE_WEBGPU_E2E=1 pnpm test:e2e
```
