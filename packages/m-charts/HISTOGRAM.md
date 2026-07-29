# Histogram

Histogram is the WebGL2 histogram and bar-aggregation engine under
`packages/m-charts/src/m-histogram`. It supports raw per-record histogram mode,
pre-aggregated bar mode, stacked subplots, rectangle/lasso bin selection, hover,
measurement, bin-size requests, and typed event handoff to the host.

This document is the human-facing API guide. Keep
[llms.md](llms.md#histogram-reference) as the detailed reference for full
command signatures, event payload types, provenance, and bin-size planning
notes.

For the compatible WebGPU renderer, asynchronous lifecycle, Rust/WASM
aggregation, and migration guidance, see
[HISTOGRAM_WEBGPU.md](HISTOGRAM_WEBGPU.md). Existing integrations keep this
histogram contract and switch the constructor entry point.

## Source-Copy Imports

For public source-copy integration, copy `plot-engine` plus
`m-histogram/core` and `m-histogram/engine` into the host app. Add
`m-histogram/adapters` or `m-histogram/react` only when the host uses those
optional helpers. Import from copied `core` and `engine` paths:

```ts
import {
  buildHistogramAggregation,
  createDefaultHistogramViewport,
  type HistogramColumns,
  type HistogramPlotSpec,
} from './vendor/m-charts/m-histogram/core/index.js';
import {
  createDefaultHistogramBindings,
  createHistogramPlot,
} from './vendor/m-charts/m-histogram/engine/index.js';
```

Avoid importing from the chart top-level barrel in framework-neutral docs or
source-copy hosts because optional helpers can be copied independently.

## Minimal Example

```ts
const host = document.querySelector<HTMLDivElement>('#histogram');
if (!host) throw new Error('Missing #histogram');

const columns: HistogramColumns = {
  ids: ['row-1', 'row-2', 'row-3'],
  sourceIndex: new Uint32Array([0, 1, 2]),
  valuesByParameter: {
    latency: new Float32Array([12, 20, 35]),
  },
};

const spec: HistogramPlotSpec = {
  mode: 'histogram',
  parameters: [
    { key: 'latency', kind: 'numeric', label: 'Latency', unit: 'ms' },
  ],
  subplots: [
    { id: 'latency', label: 'Latency', parameterKey: 'latency' },
  ],
};

const binSizes = [
  { binSize: 10, mode: 'continuous', parameterKey: 'latency', subplotId: 'latency' },
] as const;
const initialAggregation = buildHistogramAggregation(columns, {
  binSizes,
  plotSpec: spec,
});
const viewport = createDefaultHistogramViewport(initialAggregation);
const aggregation = buildHistogramAggregation(columns, {
  binSizes,
  plotSpec: spec,
  viewport,
});

const plot = createHistogramPlot(host, {
  aggregation,
  binSizes,
  columns,
  mode: 'zoom',
  spec,
  viewport,
});

const bindings = plot.use(createDefaultHistogramBindings({
  inputElement: host.parentElement ?? host,
  suppressContextMenu: true,
}));

plot.on('binsizeadjustrequest', ({ delta, binSize }) => {
  console.log('host decides next bin size', delta, binSize);
});

// Later:
bindings.dispose();
plot.dispose();
```

## Data Contract

Raw histogram mode uses `columns` and computes visible bins from the current
viewport and `binSizes`. Bar mode uses a prebuilt `aggregation`, usually from
`normalizeHistogramBarSeries(...)`.

Required raw data:

- `columns.ids`: stable row IDs.
- `columns.valuesByParameter`: arrays keyed by `HistogramParameterSpec.key`.
- `spec.mode: 'histogram'`.
- `spec.parameters[]`: `key`, `kind`, and `label`; categories for categorical
  axes when useful.
- `spec.subplots[]`: `id`, `label`, and `parameterKey`.

Optional data:

- `sourceIndex`, `recordIdentityBySourceIndex`, and `tableBySourceIndex` for
  source materialization and provenance.
- `color` plus `colorFormat: 'rgba8' | 'rgba32'` for color-stacked raw bars.
- `displayFields` and `parameters` for host display metadata.

Supported parameter kinds are `numeric`, `datetime-ns`, `categorical`, and
`boolean`. Source-index membership may be unavailable in bar mode when bins are
query-only aggregates.

## Required Options And Updates

`createHistogramPlot(...)` requires `spec`. In practice, pass either raw
`columns` plus `aggregation`/`binSizes`, or a bar-mode `aggregation`.
Common optional state includes `viewport`, `mode`, `axisMode`,
`focusedSubplotId`, `selectedSourceIndices`, `hoverSourceIndex`, and `theme`.

Use `plot.update(partialOptions)` for controlled host state: data,
aggregation, viewport, selected source indices, hover source, theme, and
renderer options. Use `plot.commands.*` for user intents. Commands emit typed
events when observers need to react.

Lifecycle:

1. Create a sized host DOM element.
2. Build a `HistogramPlotSpec` and raw columns or bar aggregation.
3. Build initial aggregation and viewport.
4. Create the plot and attach bindings with `plot.use(...)`.
5. Subscribe with `plot.on(...)`.
6. Rebuild aggregation or call `setBinSizes(...)` when bin-size policy changes.
7. Dispose subscriptions, bindings, then `plot.dispose()`.

## Default Interactions

These are owned by `createDefaultHistogramBindings`, not by the renderer. The
binding listens on `inputElement`, or the host parent/host if omitted.

| Input | Default action |
| --- | --- |
| Left drag in a subplot | Rectangle zoom; axis mode follows drag direction. |
| `Alt` + `Shift` + left drag | Force combined X/Y rectangle zoom. |
| Wheel over histogram subplot | Request continuous bin-size adjustment. |
| `Alt` + wheel | Zoom X axis. |
| `Shift` + wheel | Zoom Y axis; horizontal wheel delta is used when vertical delta is zero. |
| `Ctrl` + wheel | Zoom X and Y axes. |
| Right drag | Rectangle bin selection, replacing current selection. |
| `Ctrl` + right drag | Append rectangle bin selection. |
| `Space` + right drag or `mode: 'lasso'` | Lasso bin selection. |
| `Space` + `Ctrl` + right drag | Append lasso bin selection. |
| `Shift` + pointer move | Temporary bin hover inspection. |
| `Shift` + right drag | Measurement guide between bins. |
| Middle drag | Pan X/Y. |
| Middle click | Emit `viewportundorequest` with source `pointer`. |
| `Q` | Emit `viewportundorequest` with source `keyboard`. |
| `Escape` | Clear committed selection overlays and selection. |

`Space` lasso mode ignores editable targets (`input`, `select`, `textarea`, or
`contenteditable`). `Q` and `Escape` are not ignored by default; gate bindings
or prevent events in host-owned text inputs and popovers if needed.

The demo route also owns controls for histogram/bar mode, raw bin size, URL
state, export panels, and diagnostics. Those are not library responsibilities.

## Commands And Events

Most used commands:

- Lifecycle: `render`, `resize`, `getCanvas`, `getHostElement`,
  `getOverlayElement`, `getRenderSnapshot`, `getStateSnapshot`.
- Geometry: `getPlotRectAtPoint`, `getBinAtPoint`, `queryBinsInRectangle`,
  `queryBinsInLasso`.
- Viewport: `setViewport`, `zoomAtPointer`, `zoomToRectangle`, `panFromDrag`,
  `requestViewportUndo`.
- Selection/materialization: `selectRectangle`, `selectLasso`, `selectBins`,
  `clearSelection`, `materializeSelectionSourceIndices`,
  `materializeVisibleMembership`.
- Bin sizing: `requestBinSizeAdjust`, `setBinSizes`.
- Hover/measurement: `hoverAtPoint`, `clearHover`, `setMeasurement`.
- Overlays and cursor: `setOverlays`, `clearOverlays`, `getOverlays`,
  `setCursorState`, `setActivePlot`.

Important events:

- `viewportchange`: `{ viewport, reason, phase }`.
- `selectionchange`: selected bin descriptors, source indices, materialization
  status, selected source/bin counts, selection kind/tool, viewport, and
  query-ready filters.
- `hoverchange` and `measurementchange`.
- `brushstart`, `brushpreview`, `brushcommit`, `brushcancel`: brush target,
  shape, CSS geometry, modifiers, bin descriptors, ranges, phase, source, and
  default action.
- `binsizeadjustrequest`: host handoff for bin-size policy; apply app policy,
  call `setBinSizes(...)` or rebuild aggregation, and optionally materialize
  visible membership after wheel bursts settle.
- `overlaychange`, `activeplotchange`, `cursorchange`,
  `viewportundorequest`, `metrics`, `renderstatechange`, `contextlost`,
  `contextrestored`.

Selection filters are the backend-query handoff. Do not infer query predicates
from overlay DOM.

## Overlays And Host UI

The engine owns WebGL drawing and emits plain overlay descriptors. The host owns
rendering those descriptors in DOM, SVG, React, canvas, or another UI layer.

Histogram overlay kinds include `rectangle-zoom`, `rectangle-selection`,
`lasso`, `committed-selection`, `color-rule-brush`, `hover-guide`,
`measurement-guide`, `cursor-tooltip`, and `custom`.

The host is responsible for visible axis/sidebar UI, popovers, URL state,
exports, generated data loading, and diagnostics. The demo route shows one
integration style; it is not the package API.

## Performance And Workers

Keep raw values in typed arrays where possible. Debounce continuous bin-size
changes and avoid materializing source indices on every wheel event. Large
rectangle/lasso selections can report `sourceIndicesStatus: 'pending'`; call
`plot.commands.materializeSelectionSourceIndices()` only for export or detail
panels. Use `materializeVisibleMembership()` after settled raw bin-size changes
when the host needs source membership for visible bins.

Histogram currently has no dedicated worker source requirement. If a host moves
aggregation into its own worker, keep the same command/event handoff and push
the resulting aggregation back through `plot.update(...)` or `setBinSizes(...)`.
