# Histogram Source-Copy Example

This snippet assumes `plot-engine`, `m-histogram/core`, and
`m-histogram/engine` were copied to `src/vendor/m-charts`. Copy
`m-histogram/adapters` or `react` only when the host uses those optional
helpers. Rewrite the import prefix to match your host file.

```ts
import {
  buildHistogramAggregation,
  createDefaultHistogramViewport,
  type HistogramBinSizeState,
  type HistogramColumns,
  type HistogramPlotSpec,
} from './vendor/m-charts/m-histogram/core/index.js';
import {
  createDefaultHistogramBindings,
  createHistogramPlot,
} from './vendor/m-charts/m-histogram/engine/index.js';

export function mountHistogramExample(host: HTMLDivElement): () => void {
  const columns: HistogramColumns = {
    ids: ['row-1', 'row-2', 'row-3', 'row-4', 'row-5'],
    sourceIndex: new Uint32Array([0, 1, 2, 3, 4]),
    valuesByParameter: {
      latency: new Float32Array([12, 18, 21, 29, 35]),
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

  const binSizes: readonly HistogramBinSizeState[] = [
    {
      binSize: 10,
      mode: 'continuous',
      parameterKey: 'latency',
      subplotId: 'latency',
    },
  ];

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

  const unsubscribeBinSize = plot.on('binsizeadjustrequest', (event) => {
    console.log('host decides the next bin size', event.delta, event.binSize);
  });

  return () => {
    unsubscribeBinSize();
    bindings.dispose();
    plot.dispose();
  };
}
```

Host requirements:

- Mount into a sized element, for example a `div` with `height: 420px`,
  `position: relative`, and nonzero width.
- Treat `binsizeadjustrequest` as a host policy handoff. Rebuild aggregation or
  call `plot.commands.setBinSizes(...)` according to your product rules.
- Keep source materialization, exports, surrounding controls, and overlay
  rendering in the host app.
