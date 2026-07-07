import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  FastScatterDisplayColumns,
  FastScatterPlotSpec,
  FastScatterViewport,
} from 'm-charts/m-scatter';
import {
  createDefaultScatterBindings,
  createScatterPlot,
  type ScatterPlotInstance,
  type ScatterRenderState,
} from 'm-charts/m-scatter';

export function MScatterPackageFixture() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<ScatterPlotInstance | null>(null);
  const { columns, spec, viewport: initialViewport } = useMemo(
    () => createFixtureModel(),
    [],
  );
  const initialSelectedSourceIndices = useMemo(() => new Uint32Array([1, 4, 9]), []);
  const [viewport, setViewport] = useState(initialViewport);
  const [selectedSourceIndices, setSelectedSourceIndices] = useState<
    Uint32Array<ArrayBufferLike>
  >(initialSelectedSourceIndices);
  const [renderState, setRenderState] = useState<ScatterRenderState>('idle');

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const plot = createScatterPlot(host, {
      axisMode: 'xy',
      canvasClassName: 'scatter-fast-webgl-canvas',
      columns,
      mode: 'pan',
      onSelectionChange: (event) => {
        setSelectedSourceIndices(event.sourceIndices);
      },
      onViewportChange: (nextViewport) => {
        setViewport(nextViewport);
      },
      pointSizeScale: 1.25,
      selectedSourceIndices: initialSelectedSourceIndices,
      spec,
      viewport: initialViewport,
    });
    plot.use(createDefaultScatterBindings({ easterEgg: { sequence: 'future' } }));
    plot.canvas.dataset.testid = 'scatter-fast-webgl-canvas';
    const unsubscribeRenderState = plot.on('renderstatechange', ({ state }) => {
      setRenderState(state);
    });
    setRenderState(plot.commands.getStateSnapshot().render.renderState);
    plotRef.current = plot;

    return () => {
      unsubscribeRenderState();
      plotRef.current = null;
      plot.dispose();
    };
  }, [columns, initialSelectedSourceIndices, initialViewport, spec]);

  useEffect(() => {
    plotRef.current?.update({
      selectedSourceIndices,
      viewport,
    });
  }, [selectedSourceIndices, viewport]);

  return (
    <main className="prototype-shell">
      <section className="workspace" aria-label="m-scatter package fixture">
        <div className="scatter-fast-render-shell" data-testid="scatter-fast-fixture">
          <h1 className="scatter-fast-route-title">m-scatter package fixture</h1>
          <div
            ref={hostRef}
            aria-label="m-scatter package fixture engine host"
            className="scatter-fast-webgl-host"
            data-record-count={columns.x.length}
            data-render-state={renderState}
            data-renderer="webgl2-points"
            data-selected-count={selectedSourceIndices.length}
            data-testid="scatter-fast-chart-shell"
            style={{ height: '24rem' }}
          >
            <svg
              aria-hidden="true"
              className="scatter-fast-overlay"
              data-testid="scatter-fast-overlay"
              height="100%"
              viewBox="0 0 100 100"
              width="100%"
            >
              {spec.plots.map((plot, index) => {
                const height = 100 / spec.plots.length;
                const y = height * index;
                return (
                  <g key={plot.id}>
                    <rect
                      className="scatter-fast-overlay-plot-frame"
                      fill="none"
                      height={height}
                      width={100}
                      x={0}
                      y={y}
                    />
                    <rect
                      className="scatter-fast-hit-region"
                      data-plot-id={plot.id}
                      data-plot-index={index}
                      data-testid="scatter-fast-hit-region"
                      height={height}
                      width={100}
                      x={0}
                      y={y}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </section>
    </main>
  );
}

function createFixtureModel(): {
  columns: FastScatterDisplayColumns;
  spec: FastScatterPlotSpec;
  viewport: FastScatterViewport;
} {
  const pointCount = 32;
  const ids = Array.from({ length: pointCount }, (_, index) => `fixture-${index + 1}`);
  const x = new Float32Array(pointCount);
  const a = new Float32Array(pointCount);
  const b = new Float32Array(pointCount);
  const c = new Float32Array(pointCount);
  const color = new Uint8Array(pointCount * 4);
  const opacity = new Float32Array(pointCount);
  const rotation = new Float32Array(pointCount);
  const size = new Float32Array(pointCount);
  const shape = new Uint8Array(pointCount);
  const sourceIndex = new Uint32Array(pointCount);

  for (let index = 0; index < pointCount; index += 1) {
    const t = index / (pointCount - 1);
    x[index] = index;
    a[index] = Math.sin(t * Math.PI * 2) * 12 + 20;
    b[index] = Math.cos(t * Math.PI * 2) * 8 + 12;
    c[index] = t * 30 + Math.sin(t * Math.PI * 4) * 4;
    opacity[index] = 0.85;
    rotation[index] = t * Math.PI;
    size[index] = 4 + (index % 5);
    shape[index] = index % 5;
    sourceIndex[index] = index;

    const offset = index * 4;
    color[offset] = 45 + ((index * 23) % 160);
    color[offset + 1] = 80 + ((index * 41) % 130);
    color[offset + 2] = 120 + ((index * 17) % 110);
    color[offset + 3] = 255;
  }

  return {
    columns: {
      ids,
      x,
      y: { a, b, c },
      color,
      colorFormat: 'rgba8',
      opacity,
      rotation,
      shape,
      size,
      sourceIndex,
    },
    spec: {
      xLabel: 'Fixture X',
      plots: [
        { id: 'a', label: 'Fixture A', yKey: 'a' },
        { id: 'b', label: 'Fixture B', yKey: 'b' },
        { id: 'c', label: 'Fixture C', yKey: 'c' },
      ],
    },
    viewport: {
      x: { min: 0, max: pointCount - 1 },
      yByPlot: {
        a: { min: 4, max: 36 },
        b: { min: 0, max: 24 },
        c: { min: -4, max: 36 },
      },
    },
  };
}
