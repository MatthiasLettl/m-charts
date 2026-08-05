# Parallel Coordinates

Parallel coordinates is the WebGL2 line-segment engine under
`packages/m-charts/src/m-parallel`. It supports numeric, categorical, boolean,
and datetime axes; axis brush intervals; selected and preselected overlays;
hover inspection; per-record color/opacity; and typed event handoff to the host.
For the compatible WebGPU/Wasm pairwise-density backend, see
[PARALLEL_WEBGPU.md](PARALLEL_WEBGPU.md).

This document is the human-facing API guide. Keep
[llms.md](llms.md#parallel-coordinates-reference) as the detailed reference for
full command signatures, event payload types, provenance, overlay contracts, and
formatting helpers.

## Source-Copy Imports

For public source-copy integration, copy `plot-engine` plus
`m-parallel/core` and `m-parallel/engine` into the host app. Add
`m-parallel/adapters` or `m-parallel/react` only when the host uses those
optional helpers. Import from copied `core` and `engine` paths:

```ts
import {
  createParallelHoverIndex,
  createParallelPlotBuffers,
  type ParallelFastColumns,
} from './vendor/m-charts/m-parallel/core/index.js';
import {
  createDefaultParallelBindings,
  createParallelDomBrushHitTest,
  createParallelPlot,
} from './vendor/m-charts/m-parallel/engine/index.js';
```

Avoid importing from the chart top-level barrel in framework-neutral docs or
source-copy hosts because optional helpers can be copied independently.

## Minimal Example

```ts
const host = document.querySelector<HTMLDivElement>('#parallel');
if (!host) throw new Error('Missing #parallel');

const columns: ParallelFastColumns = {
  axisOrder: ['latency', 'throughput', 'healthy'],
  axes: [
    { key: 'latency', kind: 'numeric', label: 'Latency', unit: 'ms' },
    { key: 'throughput', kind: 'numeric', label: 'Throughput' },
    { key: 'healthy', kind: 'boolean', label: 'Healthy' },
  ],
  ids: ['row-1', 'row-2'],
  valuesByAxis: {
    latency: new Float32Array([12, 20]),
    throughput: new Float32Array([900, 840]),
    healthy: [true, false],
  },
};

const buffers = createParallelPlotBuffers(columns, {
  includeWebglSegmentBuffers: true,
});
const hoverIndex = createParallelHoverIndex(buffers);

const plot = createParallelPlot(host, { buffers });

const bindings = plot.use(createDefaultParallelBindings({
  brushHitTest: createParallelDomBrushHitTest(),
  coordinateTarget: host,
  inputElement: host.parentElement ?? host,
  inspection: { getHoverIndex: () => hoverIndex },
  keyboardTarget: window,
}));

plot.on('selectionchange', (event) => {
  console.log(event.selectedCount, event.filters);
});

// Later:
bindings.dispose();
plot.dispose();
```

`createParallelDomBrushHitTest()` only works if the host renders compatible DOM
axis guides and brush handles. The default DOM contract selectors expect a
`.parallel-fast-axis-guide` element with `data-axis="<parameterKey>"`, plus
existing brush wrappers with `data-axis-range-index="<index>"` when move,
resize, or remove interactions should target an existing interval. Hosts with
different DOM, SVG, or canvas overlays should provide their own `brushHitTest`.

## Data Contract

Build `ParallelBuffers` with `createParallelPlotBuffers(...)`. It encodes raw
values into normalized typed arrays and can prebuild WebGL segment buffers.

Required data:

- `ids`: stable row IDs.
- `axisOrder`: axis keys in display order.
- `valuesByAxis`: arrays keyed by axis.

Recommended data:

- `axes[]`: axis labels, kinds, units, categories, and provenance source.
- `includeWebglSegmentBuffers: true` in active rendering hosts.
- `recordIdentityBySourceIndex` and `tableBySourceIndex` when events need
  provenance or table identity.
- `color` and `opacity` for per-record styling.
- `preselectedSourceIndices` when the host wants a secondary highlighted set.

Supported axis kinds are `numeric`, `datetime-ns`, `categorical`, and
`boolean`. Brush intervals use raw display values in each axis domain. Multiple
intervals on one axis are ORed; intervals across axes are ANDed.

## Required Options And Updates

`createParallelPlot(...)` requires `buffers`. Common optional state includes
`brushIntervals`, `inspection`, `selectedSourceIndices`,
`preselectedSourceIndices`, `preselectedOverlayEnabled`, `lineOpacityScale`, and
`theme`.

Use `plot.update(partialOptions)` for controlled host state. Parallel has one
important exception: `plot.update({ brushIntervals })` is treated as a committed
brush update and emits brush/selection events. Use
`commands.previewBrushIntervals(...)` for lightweight drag previews and
`commands.commitBrushIntervals(...)` for committed user actions.

Lifecycle:

1. Create a sized host DOM element.
2. Build columns, then `ParallelBuffers`.
3. Create the plot.
4. Render host-owned axis guides/brush handles if pointer brushing is needed.
5. Attach bindings with a matching `brushHitTest`.
6. Subscribe with `plot.on(...)`.
7. Reconcile host state through `plot.update(...)` or commands.
8. Dispose subscriptions, bindings, then `plot.dispose()`.

## Default Interactions

These are owned by `createDefaultParallelBindings`, not by the renderer. The
binding listens on `inputElement` for pointer/key input and can also listen on
`keyboardTarget`. Shortcut handling ignores prevented events, `Alt`/`Ctrl`/Meta
modified events, `shortcutGate() === false`, and targets rejected by
`ignoreKeyboardTarget`.

| Input | Default action |
| --- | --- |
| Right drag on an axis guide | Create or replace a brush interval on that axis. |
| `Ctrl` + right drag on an axis guide | Append a brush interval on that axis. |
| Right drag existing brush band | Move the brush interval. |
| Right drag min/max handle | Resize the brush interval. |
| Right double-click existing brush | Remove the brush interval. |
| `Shift` + pointer move | Inspect nearest line path. |
| `Escape` | Clear all active brushes when brushes exist. |
| `,` or `-` | Emit line opacity decrease request. |
| `.` or `+` | Emit line opacity increase request. |
| `0` | Emit line opacity reset request. |

Pointer brushing requires `brushHitTest` because axis guides and brush handles
are host-rendered. Without a hit test, inspection and keyboard opacity
shortcuts can still work, but pointer brushing cannot.

The demo cheat sheet labels this as "Drag axis". In reusable bindings,
right-drag is the built-in selection gesture. The demo route owns the concrete
axis overlay DOM, sidebar controls, URL state, exports, and diagnostics. Those
are not library responsibilities.

## Commands And Events

Most used commands:

- Lifecycle: `render`, `resize`, `getCanvas`, `getHoverCanvas`,
  `getHostElement`, `getRenderSnapshot`, `getStateSnapshot`.
- Brush/selection: `previewBrushIntervals`, `commitBrushIntervals`,
  `removeBrushInterval`, `clearBrushes`, `setSelectedSourceIndices`,
  `setPreselectedSourceIndices`.
- Inspection/hover: `setInspection`, `clearInspection`, `setHoverSourceIndex`,
  `setHoverState`, `drawHover`.
- Style/theme: `requestLineOpacityAdjustment`, `updateLineOpacityScale`,
  `updateTheme`.
- Overlays: `setOverlays`, `clearOverlays`, `getOverlays`.
- Low-level event bridge: `emitBrushEvent`.

Important events:

- `brushpreview`, `brushcommit`, `brushchange`: active brushes, brush intervals,
  target axis/range index, reason, source, modifiers, phase, and default action.
- `selectionchange`: selected source indices, selected count, active brushes,
  brush intervals, compute timings, reason, source, and query-ready filters.
- `inspectionchange`: nearest record/segment, active axis, lookup source, and
  resolve timing.
- `hovervisualchange`: hover canvas visual state.
- `lineopacityadjustrequest`: host handoff for opacity scale policy.
- `overlaychange`, `metrics`, `renderstatechange`, `contextlost`,
  `contextrestored`, `dispose`.
- `axisviewportpreview`, `axisviewportchange`: additive per-axis zoom/pan state
  shared by WebGL-compatible engine integrations and the WebGPU renderer. The
  default pointer binding commits once on release; previews remain available
  for controlled/programmatic integrations.

Selection filters are the backend-query handoff. Do not infer query predicates
from overlay DOM.

## Overlays And Host UI

The engine owns base and hover WebGL canvases. The host owns axis labels, axis
guides, brush handles, inspection labels, side panels, popovers, URL state,
exports, generated data loading, and diagnostics.

Parallel overlay kinds are `axis-brush`, `color-rule-brush`, and `inspection`.
`axis-brush` and `color-rule-brush` carry `activeBrushes` and
`brushIntervals`; `inspection` carries the current inspection payload.

`createParallelDomBrushHitTest()` expects the default/demo DOM contract classes:
`.parallel-fast-axis-guide`, `.parallel-fast-axis-brush`,
`.parallel-fast-axis-brush-handle-min`,
`.parallel-fast-axis-brush-handle-max`, and
`.parallel-fast-axis-brush-band`. The axis guide must expose `data-axis`, and
existing brush wrappers should expose `data-axis-range-index` so move, resize,
and right double-click removal resolve the intended interval. Use a custom
`brushHitTest` when your host renders different markup.

## Performance And Workers

Build `webglSegmentBuffers` once with `includeWebglSegmentBuffers: true` and
reuse buffers during interaction. Cache `createParallelHoverIndex(buffers)` for
large datasets and provide it through `inspection.getHoverIndex`; without an
index, the default binding only uses a small-dataset fallback up to
`smallDatasetFallbackRecordLimit`.

Use `previewBrushIntervals(...)` during drags and commit once on pointer up.
Keep selected source indices as typed arrays and materialize row objects only
for panels or export.

Parallel currently has no dedicated worker source requirement. If a host moves
buffer building or selection into its own worker, keep the same command/event
handoff and push finished buffers or selection state back through
`plot.update(...)` or commands.

The default binding also reserves left drag for axis box zoom and middle drag
for axis pan. Middle click invokes viewport undo. Programmatic hosts can use
`setAxisViewports`, `undoAxisViewport`, and `resetAxisViewports`; viewport
ranges do not change brush selection semantics.
