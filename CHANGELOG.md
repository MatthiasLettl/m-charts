# Changelog

This changelog documents the standalone `m-charts` repository, beginning with
its initial migration. Entries are ordered newest first, and released entries
should remain unchanged.

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
