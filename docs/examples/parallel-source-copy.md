# Parallel Coordinates Source-Copy Example

This snippet assumes `plot-engine`, `m-parallel/core`, and `m-parallel/engine`
were copied to `src/vendor/m-charts`. Copy `m-parallel/adapters` or `react`
only when the host uses those optional helpers. Rewrite the import prefix to
match your host file.

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

export function mountParallelExample(host: HTMLDivElement): () => void {
  const columns: ParallelFastColumns = {
    axisOrder: ['latency', 'throughput', 'healthy'],
    axes: [
      { key: 'latency', kind: 'numeric', label: 'Latency', unit: 'ms' },
      { key: 'throughput', kind: 'numeric', label: 'Throughput' },
      { key: 'healthy', kind: 'boolean', label: 'Healthy' },
    ],
    ids: ['row-1', 'row-2', 'row-3'],
    valuesByAxis: {
      latency: new Float32Array([12, 20, 15]),
      throughput: new Float32Array([900, 840, 930]),
      healthy: [true, false, true],
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

  const unsubscribeSelection = plot.on('selectionchange', (event) => {
    console.log('selected rows', event.selectedCount, event.filters);
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
- Render axis labels, guides, and brush handles in the host app. The engine owns
  WebGL canvases, not the visible axis UI.
- `createParallelDomBrushHitTest()` expects host-rendered axis guides matching
  the default/demo DOM contract class names: `.parallel-fast-axis-guide` with
  `data-axis="<axisKey>"`, and existing brush wrappers with
  `data-axis-range-index="<index>"` when move, resize, or remove interactions
  target an existing interval. Provide a custom `brushHitTest` for different
  DOM, SVG, or canvas overlays.
