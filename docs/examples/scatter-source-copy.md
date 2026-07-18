# Scatter WebGL2 Source-Copy Example

This snippet assumes `plot-engine`, `m-scatter/core`, and `m-scatter/engine`
were copied to `src/vendor/m-charts`. Copy `m-scatter/adapters`, `workers`, or
`react` only when the host uses those optional helpers. Rewrite the import
prefix to match your host file. Existing users moving this example to WebGPU
should follow the [WebGL2-to-WebGPU migration example](scatter-webgpu-migration.md).

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

export function mountScatterExample(host: HTMLDivElement): () => void {
  const columns: ScatterDisplayColumns = {
    ids: ['row-1', 'row-2', 'row-3', 'row-4'],
    sourceIndex: new Uint32Array([0, 1, 2, 3]),
    x: new Float32Array([1, 2, 3, 4]),
    xKey: 'time',
    y: {
      latency: new Float32Array([12, 18, 9, 24]),
    },
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
    console.log('selected rows', event.selectedCount, event.sourceIndices);
  });

  return () => {
    unsubscribeSelection();
    bindings.dispose();
    plot.dispose();
  };
}
```

Host requirements:

- Mount into a sized element, for example a `div` with `height: 420px`,
  `position: relative`, and nonzero width.
- Keep surrounding panels, labels, overlays, data loading, and export UI in the
  host app.
- If you instantiate `FastScatterAggregationController` or
  `FastScatterSelectionController` for workers, dispose those controllers in
  the same cleanup path. `plot.dispose()` does not own externally created worker
  controllers.
