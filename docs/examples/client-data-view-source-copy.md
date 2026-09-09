# Client Data View Source-Copy Example

This example mounts a WebGPU scatter plot and edits a resident dataset through
the optional client controller. It filters accepted rows, calculates a ratio,
filters that result, and colors/sizes the visible points. The source arrays stay
unchanged throughout these operations.

Copy `plot-engine`, `plot-engine-webgpu`, `client-data-view`, `m-scatter/core`,
`m-scatter/engine`, `m-scatter-webgpu/core`, and `m-scatter-webgpu/engine` from
`packages/m-charts/src` to `src/vendor/m-charts`. Preserve their relative layout.
Rewrite the imports below to match your host file. As with the other
[source-copy examples](README.md), use a sized host element and a secure context
with WebGPU support; handle startup rejection in your application.

## Create, Edit, Persist, And Dispose

The small inline dataset makes this example self-contained. In a real app,
finish loading your typed columns once before mounting the plot.

```ts
import {
  calculateScatterDomain,
  createDefaultScatterViewport,
  createFastScatterClientDataView,
  type ScatterDisplayColumns,
  type ScatterPlotSpec,
} from './vendor/m-charts/m-scatter/core/index.js';
import {
  createDefaultScatterBindings,
  createScatterPlot,
} from './vendor/m-charts/m-scatter-webgpu/engine/index.js';
import type { ClientDataViewState } from './vendor/m-charts/client-data-view/index.js';

export async function mountClientViewExample(host: HTMLDivElement) {
  const columns: ScatterDisplayColumns = {
    ids: ['row-1', 'row-2', 'row-3', 'row-4'],
    sourceIndex: new Uint32Array([0, 1, 2, 3]),
    xKey: 'time',
    x: new Float64Array([1, 2, 3, 4]),
    y: { pressure: new Float32Array([100, 120, 90, 150]) },
  };
  const spec: ScatterPlotSpec = {
    xLabel: 'Time',
    plots: [{ id: 'pressure', label: 'Pressure', yKey: 'pressure' }],
  };
  const view = createFastScatterClientDataView({
    columns,
    datasetKey: 'pressure-query',
    // In production use a content/order version supplied by your data source,
    // or fingerprint: true instead of datasetVersion (adds a content scan).
    datasetVersion: 'result-42',
    fields: {
      accepted: { kind: 'boolean', values: new Uint8Array([1, 1, 0, 1]) },
      baseline: { kind: 'numeric', values: new Float32Array([100, 100, 100, 100]) },
      phase: { kind: 'categorical', values: ['warmup', 'steady', 'steady', 'peak'] },
    },
  });
  const baselineState = view.exportState();
  const plot = createScatterPlot(host, {
    axisMode: 'xy',
    mode: 'zoom',
    columns,
    spec,
    viewport: createDefaultScatterViewport(calculateScatterDomain(columns, spec)),
    clientView: { view },
  });
  try {
    await plot.ready;
  } catch (error) {
    plot.dispose();
    view.dispose();
    throw error;
  }
  const bindings = plot.use(createDefaultScatterBindings({
    inputElement: host,
    suppressContextMenu: true,
  }));
  const unsubscribe = view.on('change', ({ state }) => {
    // Drive a host sidebar/history UI here. State contains no source dataset.
    console.log('committed client revision', state.revision);
  });

  return {
    plot,
    view,
    async applyPipeline() {
      // One atomic evaluation and one change event. Without an asyncEvaluator,
      // batchAsync evaluates synchronously; a Promise alone does not offload it.
      return view.batchAsync(() => {
        view.addFilter({
          id: 'accepted',
          predicate: { op: 'eq', field: 'accepted', value: true },
        });
        view.addTransformation({
          id: 'ratio', op: 'calculate', output: 'ratio',
          expression: {
            op: 'divide',
            left: { op: 'field', field: 'pressure' },
            right: { op: 'field', field: 'baseline' },
          },
        });
        view.addFilter({
          id: 'high-ratio', stage: 'transformed',
          predicate: { op: 'gt', field: 'ratio', value: 1.1 },
        });
        view.addStyle({
          id: 'phase-and-ratio',
          channels: {
            color: { op: 'hashedColor', field: 'phase' },
            size: { op: 'continuous', field: 'ratio', domain: [1, 1.5], range: [3, 9] },
            opacity: { op: 'constant', value: 0.8 },
          },
        });
      });
    },
    setThreshold(value: number) {
      // updateFilter replaces the complete item, including its stage and ID.
      view.updateFilter('high-ratio', {
        id: 'high-ratio', stage: 'transformed',
        predicate: { op: 'gt', field: 'ratio', value },
      });
    },
    setThresholdEnabled(enabled: boolean) {
      const filter = view.getFilters().find((item) => item.id === 'high-ratio');
      if (filter) view.updateFilter(filter.id, { ...filter, enabled });
    },
    exportJson() {
      return JSON.stringify(view.exportState());
    },
    importJson(json: string) {
      // The cast supplies a TS type; replaceState performs runtime validation.
      // Invalid JSON/state or a dataset mismatch throws. Surface that in host UI.
      view.replaceState(JSON.parse(json) as ClientDataViewState);
    },
    reset() {
      view.replaceState(baselineState);
    },
    dispose() {
      unsubscribe();
      bindings.dispose();
      plot.dispose();
      view.dispose();
    },
  };
}
```

Call `await example.applyPipeline()` once after mounting (or after `reset()`),
then `example.setThreshold(1.3)` as the user changes a control. With these rows,
the initial pipeline keeps `row-2` and `row-4`; threshold `1.3` keeps `row-4`.
Item IDs are unique within a stage, so edit existing items with `update*` rather
than adding the same IDs again. `view.removeStyle('phase-and-ratio')` restores
the source/default style base. `reset()` restores the saved unfiltered state.
Always call `example.dispose()` on unmount.

Here `ratio` drives a filter and size, while the Y axis still plots `pressure`.
To plot a derived output, define its transformation before creating the plot
and map it with `clientView.yFieldByKey`, or overwrite the plotted field name
in the view. Source arrays remain immutable either way. See
[field mappings and lifecycle](../../packages/m-charts/CLIENT_DATA_VIEW.md#creating-and-attaching-a-view).

## Optional Worker For Expensive Edits

With Vite, a host file at `src/clientView.ts` can create a module worker from the
copied TypeScript entry as follows. Pass `asyncEvaluator` into the view factory
in the example above. Adapt URL resolution to your bundler; do not copy demo
React hooks to use the worker.

```ts
import { createClientDataViewWorkerEvaluator } from './vendor/m-charts/client-data-view/index.js';

const asyncEvaluator = createClientDataViewWorkerEvaluator(new Worker(
  new URL('./vendor/m-charts/client-data-view/core/worker.ts', import.meta.url),
  { type: 'module' },
));
```

Use `batchAsync` or `replaceStateAsync` for off-thread evaluation. Ordinary
setters, including `setThreshold` above, remain synchronous; for expensive
threshold edits wrap that setter in `await view.batchAsync(() => { ... })`.
Await dependent edits. A result of `false` means a newer edit superseded the
request. Worker failures reject and leave committed state intact. A committed
state does not mean the corresponding GPU frame has finished: inspect chart
diagnostics as described in the [API guide](../../packages/m-charts/CLIENT_DATA_VIEW.md#demo-and-diagnostics).

Use one evaluator per view. The worker clones source columns once per dataset
identity and adds memory overhead; initial decoding, projection preparation,
and uploads still involve the main thread. Dispose attached plots first, then
the view, which releases the evaluator/worker.

## Other Charts And Selection Actions

The same controller methods work with WebGPU parallel and raw histogram
factories; use their existing buffers/columns and map fields when necessary.
See the [parallel and histogram examples](../../packages/m-charts/CLIENT_DATA_VIEW.md#parallel-coordinates-and-histogram)
for rendered channels, aggregation, and selection behavior. Streaming append
and pre-aggregated bars do not accept this resident binding.

Selection alone does not filter. For a host-owned “keep selected” action after
transformations, declare a stable source-row field and build an `in` predicate
from selection source indices (or `notIn` to exclude them). Geometric predicates
over source fields are only appropriate when selection coordinates describe
those original fields. See the [selection recipe](../../packages/m-charts/CLIENT_DATA_VIEW.md#demo-and-diagnostics).
