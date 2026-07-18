# Scatter

Scatter is the WebGL2 XY plot engine under `packages/m-charts/src/m-scatter`.
It supports stacked subplots sharing one X column, point/bubble/heatmap modes,
rectangle and lasso selection, hover inspection, measurements, point markers,
navigator range control, and typed event handoff to the host application.

For the WebGPU renderer that reuses this data, engine, command, event, binding,
and overlay contract, see [SCATTER_WEBGPU.md](SCATTER_WEBGPU.md). Existing
WebGL2 integrations can add the WebGPU source folders and switch only the
factory import; the source-copy and fallback procedure is documented under
[Migrating An Existing WebGL2 Scatter](../../docs/source-copy-integration.md#migrating-an-existing-webgl2-scatter).

This document is the human-facing API guide. Keep
[llms.md](llms.md#scatter-reference) as the detailed reference for full command
signatures, event payload types, provenance, and migration notes.

## Source-Copy Imports

For public source-copy integration, copy `plot-engine` plus
`m-scatter/core` and `m-scatter/engine` into the host app. Add
`m-scatter/adapters`, `m-scatter/workers`, or `m-scatter/react` only when the
host uses those optional helpers. Import from copied `core` and `engine` paths:

```ts
import {
  calculateScatterDomain,
  createDefaultScatterViewport,
  type ScatterPlotSpec,
  type ScatterDisplayColumns,
} from './vendor/m-charts/m-scatter/core/index.js';
import {
  createDefaultScatterBindings,
  createScatterPlot,
} from './vendor/m-charts/m-scatter/engine/index.js';
```

Avoid importing from the chart top-level barrel in framework-neutral docs or
source-copy hosts because it can include optional React helper exports.

## Minimal WebGL2 Example

```ts
const host = document.querySelector<HTMLDivElement>('#scatter');
if (!host) throw new Error('Missing #scatter');

const columns: ScatterDisplayColumns = {
  ids: ['row-1', 'row-2', 'row-3'],
  x: new Float32Array([1, 2, 3]),
  xKey: 'time',
  y: { latency: new Float32Array([12, 20, 15]) },
  sourceIndex: new Uint32Array([0, 1, 2]),
};

const spec: ScatterPlotSpec = {
  xLabel: 'Time',
  plots: [{ id: 'latency', label: 'Latency', yKey: 'latency' }],
};

const plot = createScatterPlot(host, {
  axisMode: 'xy',
  columns,
  mode: 'zoom',
  spec,
  viewport: createDefaultScatterViewport(
    calculateScatterDomain(columns, spec),
  ),
});

const bindings = plot.use(createDefaultScatterBindings({
  inputElement: host.parentElement ?? host,
  suppressContextMenu: true,
}));

const unsubscribeSelection = plot.on('selectionchange', (event) => {
  console.log(event.selectedCount, event.sourceIndices);
});

// Later, when the route/component unmounts:
unsubscribeSelection();
bindings.dispose();
plot.dispose();
```

## Data Contract

`columns.ids`, `columns.x`, every `columns.y[key]`, and optional style arrays
must describe the same source-order record set. `sourceIndex` maps displayed
rows back to host records; omit it only when display order equals source order.
Use `recordIdentityBySourceIndex` and `tableBySourceIndex` when the host needs
provenance in events.

Required data:

- `ids`: stable row IDs.
- `x`: `Float32Array` or `Float64Array`.
- `y`: record of Y arrays keyed by plotted parameter.
- `spec.xLabel` and `spec.plots[]` with `id`, `label`, and `yKey`.

Optional style data for point mode:

- `color` plus `colorFormat: 'rgba8' | 'rgba32'`.
- `opacity` in `0..1`.
- `size` in CSS px before `pointSizeScale`.
- `rotation`, `rotationDegrees`, or `rotationRadians`.
- `shape` using `FAST_SCATTER_SHAPE_CODES`.

Keep records sorted by nondecreasing X where possible. Hover, selection,
visible summaries, and aggregation can use that ordering.

## Required Options And Updates

`createScatterPlot(...)` requires `columns`, `spec`, `viewport`, `mode`, and
`axisMode`. Common optional state includes `visualizationMode`,
`selectedSourceIndices`, `hoverSourceIndex`, `focusedPlotId`, `pointSizeScale`,
`opacityScale`, `heatmapBinSizePx`, `heatmapPalette`, `aggregation`, and
`theme`.

Use `plot.update(partialOptions)` for controlled host state: new data, restored
viewport, selected IDs, hover source, theme, renderer options, and aggregation.
Use `plot.commands.*` for user intents and product actions. Commands emit typed
events where observers need to react.

Lifecycle:

1. Create a sized host DOM element.
2. Build typed columns and a plot spec.
3. Compute or restore an initial viewport.
4. Create the plot and attach bindings with `plot.use(...)`.
5. Subscribe with `plot.on(...)` and unsubscribe when observers unmount.
6. Reconcile host state through `plot.update(...)`.
7. Dispose subscriptions, bindings, any external worker controllers, then
   `plot.dispose()`.

## Default Interactions

These are owned by `createDefaultScatterBindings`, not by the renderer itself.
The binding listens on `inputElement`, or the host parent/host if omitted.

| Input | Default action |
| --- | --- |
| Left drag in a subplot | Rectangle zoom; axis mode follows drag direction. |
| `Alt` + `Shift` + left drag | Force combined X/Y rectangle zoom. |
| Wheel | Request point-size adjustment, or heatmap bin-size adjustment in heatmap mode. |
| `Alt` + wheel | Zoom X axis. |
| `Shift` + wheel | Zoom focused subplot Y axis; horizontal wheel delta is used when vertical delta is zero. |
| `Ctrl` + wheel | Zoom X and Y axes. |
| Right drag | Rectangle selection, replacing current selection. |
| `Ctrl` + right drag | Append rectangle selection. |
| `Space` + right drag or `mode: 'lasso'` | Lasso selection. |
| `Space` + `Ctrl` + right drag | Append lasso selection. |
| `Shift` + pointer move | Temporary point or aggregate inspection. |
| `Shift` + right drag | Measurement guide from the hovered point/aggregate. |
| Left double-click point | Toggle a point marker in point mode. |
| Middle drag | Pan X/Y. |
| Middle click | Emit `viewportundorequest` with source `pointer`. |
| `Q` | Emit `viewportundorequest` with source `keyboard`. |
| `Escape` | Clear committed selection and point markers. |

`Space` lasso mode ignores editable targets (`input`, `select`, `textarea`, or
`contenteditable`). `Q` and `Escape` are not ignored by default; gate bindings
or prevent events in host-owned text inputs and popovers if needed.

Additional app-owned shortcuts are not scatter engine defaults; implement them
in the host by calling commands or `plot.update(...)`.

## Commands And Events

Most used commands:

- Lifecycle: `render`, `resize`, `getCanvas`, `getHostElement`,
  `getOverlayElement`, `getRenderSnapshot`, `getStateSnapshot`.
- Viewport: `setViewport`, `zoomAtPointer`, `zoomToRectangle`, `panFromDrag`,
  `dragNavigator`, `requestViewportUndo`.
- Selection: `selectRectangle`, `selectLasso`, `clearSelection`.
- Hover/measurement/markers: `hoverAtPoint`, `clearHover`,
  `setHoverSourceIndex`, `setMeasurement`, `togglePointMarker`,
  `clearPointMarkers`.
- Overlays and cursor: `setOverlays`, `clearOverlays`, `getOverlays`,
  `setCursorState`, `setActivePlot`.
- Requests: `requestPointSizeAdjust`, `requestHeatmapBinSizeAdjust`.
- Aggregation: `getAggregation`.

Important events:

- `viewportchange`: `{ viewport, reason, phase }`.
- `selectionchange`: source indices, selected count, selected ID samples,
  selection kind/tool, viewport, and query-ready filters.
- `hoverchange`: active point or aggregate, source index, labels, canvas point,
  distance, and lookup timing.
- `measurementchange`: reference/current measurement points.
- `brushstart`, `brushpreview`, `brushcommit`, `brushcancel`: brush target,
  shape, CSS geometry, modifiers, range, phase, source, and default action.
- `overlaychange`, `activeplotchange`, `cursorchange`.
- `pointsizeadjustrequest` and `heatmapbinsizeadjustrequest`: host handoffs;
  apply host policy, then call `plot.update(...)`.
- `viewportundorequest`, `metrics`, `renderstatechange`, `contextlost`,
  `contextrestored`.

Selection filters are the backend-query handoff. Do not infer query predicates
from overlay DOM.

## Overlays And Host UI

The `m-scatter` engine owns WebGL2 drawing and emits plain overlay descriptors.
The host owns rendering those descriptors in DOM, SVG, React, canvas, or
another UI layer. The WebGPU factory retains the same descriptor contract and
shared host/canvas CSS hooks.

Scatter overlay kinds include `rectangle-zoom`, `rectangle-selection`, `lasso`,
`committed-selection`, `color-rule-brush`, `hover-guide`, `measurement-guide`,
`cursor-tooltip`, `navigator`, `out-of-range-markers`, and `point-marker`.

The demo app owns side panels, URL state, generated data loading, exports,
diagnostics, and most visible overlay rendering. Those are integration examples,
not reusable library responsibilities.

## Performance And Workers

Keep hot data in typed arrays, avoid recreating the plot for state changes, and
coalesce pointer-preview work through the default bindings or equivalent RAF
scheduling. Rebuild bubble/heatmap aggregation when viewport, subplot pixel
size, selection, hover source, heat bin size, or plotted columns change.

Scatter has optional worker controllers under `m-scatter/workers` for
aggregation and selection. They are not required for the basic engine path. If
the host creates `FastScatterAggregationController` or
`FastScatterSelectionController` directly, provide a bundler-specific
`createWorker` callback when needed and dispose those controllers separately
from `plot.dispose()` so module workers are terminated.
