# Streaming viewport control

All three WebGPU streaming factories expose the same viewport controls on
`plot.streaming`. WASM/TypeScript aggregation choice does not change this policy.

```ts
const stopBounds = plot.streaming.on('boundschange', ({ bounds }) => {
  // Update application state, a range readout, or a linked chart.
  // Calling setViewportFollowing(false) here prevents this automatic fit.
  console.log(bounds);
});
const stopFollowing = plot.streaming.on('followingchange', ({ following, reason }) => {
  console.log(following, reason); // reason: command | interaction
});

plot.streaming.getBounds();                 // latest full-data fit bounds
plot.streaming.getViewportFollowing();      // observable policy state
plot.streaming.fitViewport();               // fit once; leave following paused
plot.streaming.setViewportFollowing(false); // freeze the current viewport
plot.streaming.setViewportFollowing(true);  // fit latest bounds now; follow future growth

stopBounds();
stopFollowing();
```

`boundschange` is delivered when fit bounds change, including while following is
paused. Its payload has `bounds` and `reason: 'stream'`. Bounds are the latest
rendered prefix; histogram prefixes are aggregated at geometric checkpoints.
Get the initial bounds with `getBounds()` after the factory resolves. Treat
returned bounds as immutable. Controls remain usable after completion or abort
on a surviving partial plot; disposal removes subscriptions and makes commands inert.

`viewportPolicy: 'expand' | 'preserve'` remains a creation option. Without a
provided viewport, scatter/histogram default to `expand`; a provided viewport
defaults to `preserve`. Parallel follows by default unless non-null axis viewport overrides are
provided. These defaults can be overridden explicitly. Automatic updates expand
without shrinking the current viewport; explicit fitting/resuming may shrink it.
An initial viewport with explicit `expand` remains in place until bounds change
or the application explicitly fits/resumes.

The default optional interaction binding pauses on external viewport changes
(including previews, reset/undo, and programmatic commands), and on scatter/
histogram rectangle-zoom start. A cancelled zoom remains paused. Plain
`update({ viewport })` / `update({ axisViewports })` pauses when the viewport
actually differs; controlled echoes of the current viewport are harmless.
Selection, hover, and theme changes do not pause following. Reset commands do
not silently resume; the application chooses when to call
`setViewportFollowing(true)`.

Set `pauseViewportFollowingOnInteraction: false` to disable this binding and
own the policy using plot events and the controller commands. The reusable
`bindStreamingViewportInteractions` helper and controller types are exported
from `m-charts/plot-engine`; no React/application logic enters the engine.

Viewport events use `reason: 'stream'` for automatic fits and `reason: 'fit'`
for fit-once/resume. They are committed viewport changes and do not pause the
default binding. Applications should exclude stream events from undo history
and avoid adding URL history for each batch. Existing reason values remain valid.
Parallel uses its existing `axisviewportchange` event, with these additional
reason values, and preserves active preview viewports during stream appends.

## Bounds by chart

- Scatter: `FastScatterDataDomain` (`x`, `yByPlot`). Without a supplied
  `dataSource.domain`, batch domains are merged. Encoded axis metadata can
  provide domains too. Prepared full-stream domains are authoritative and stay
  stable; the source must cover the stream's values.
- Histogram: `HistogramViewport` (`subplotById`). Bounds are computed across
  the full resident data at current bin sizes, independently of zoomed bins.
  Explicit parameter domains/category dictionaries remain authoritative; this
  does not change out-of-domain filtering. Bin-size changes refresh fit bounds.
  `plot.commands.getDataViewport()` also exposes full-data fitting on static
  histogram plots without moving the viewport.
- Parallel: `ParallelAxisDomains`. The stream still requires
  `dataSource.domainsByAxis`; packed data uses those fixed normalization domains.
  Therefore domains do not grow and no bounds event is emitted for each batch.
  Fit/resume clears axis viewport overrides to show the prepared domains.

## Demo verification

The streaming demos show following/paused state, Fit once, Pause/Resume following,
and Show all / Resume following. The application wires those controls to the
library API. Saved URL zooms remain paused on load.

Development-only test controls (ignored by production builds):

- `__e2eStreamDelayMs=1000`: pace batches on all streaming demos (0–5000 ms).
- `__e2eStreamUnknownDomain=1`: use batch-derived scatter axis bounds to exercise
  unknown-domain growth while retaining axis labels/encoding.

Example: `/m-scatter-webgpu?points=1000000&webgpuData=stream-local&__e2eStreamDelayMs=1000&__e2eStreamUnknownDomain=1`.

Verify growth, zoom/pan while batches arrive, preservation of that viewport,
resumption to the newest bounds, fit-once remaining paused, and a saved zoom
surviving reload. Repeat histogram with `aggregationBackend=typescript` and the
Rust/WASM backend selected in the UI. Parallel uses its prepared full domains.
