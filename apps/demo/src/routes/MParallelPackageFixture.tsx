import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import {
  createParallelFastAxisTicks,
  createParallelFastBuffers,
  formatParallelFastAxisValue,
  PARALLEL_AXIS_MIN_DISPLAY_VALUE,
  PARALLEL_MISSING_AXIS_DISPLAY_VALUE,
  parallelRenderedNormalizedValueToDisplayValue,
  type NumericRange,
  type ParallelBrushIntervals,
  type ParallelBuffers,
  type ParallelFastAxisMetadata,
  type ParallelFastColumns,
  type ParallelParameter,
} from 'm-charts/m-parallel';
import {
  createDefaultParallelBindings,
  createParallelDomBrushHitTest,
  createParallelPlot,
  type ParallelPlotInstance,
  type ParallelRenderState,
} from 'm-charts/m-parallel';

export function MParallelPackageFixture() {
  const buffers = useMemo(() => createFixtureBuffers(), []);
  const [brushIntervals, setBrushIntervals] = useState<ParallelBrushIntervals>({});
  const [selectedSourceIndices, setSelectedSourceIndices] = useState<
    Uint32Array<ArrayBufferLike>
  >(
    () => new Uint32Array([1, 4, 7]),
  );

  return (
    <main className="prototype-shell">
      <section className="workspace" aria-label="m-parallel package fixture">
        <div className="parallel-fast-route">
          <h1>m-parallel package fixture</h1>
          <FixtureMParallelEngineChart
            brushIntervals={brushIntervals}
            buffers={buffers}
            onBrushIntervalsChange={(nextBrushIntervals) => {
              setBrushIntervals(nextBrushIntervals);
            }}
            onSelectionChange={(sourceIndices) => {
              setSelectedSourceIndices(sourceIndices);
            }}
            preselectedOverlayEnabled={true}
            preselectedSourceIndices={buffers.preselectedSourceIndices}
            selectedSourceIndices={selectedSourceIndices}
          />
        </div>
      </section>
    </main>
  );
}

function FixtureMParallelEngineChart({
  brushIntervals,
  buffers,
  onBrushIntervalsChange,
  onSelectionChange,
  preselectedOverlayEnabled,
  preselectedSourceIndices,
  selectedSourceIndices,
}: {
  brushIntervals: ParallelBrushIntervals;
  buffers: ParallelBuffers;
  onBrushIntervalsChange: (brushIntervals: ParallelBrushIntervals) => void;
  onSelectionChange: (sourceIndices: Uint32Array) => void;
  preselectedOverlayEnabled: boolean;
  preselectedSourceIndices: Uint32Array;
  selectedSourceIndices: Uint32Array;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<ParallelPlotInstance | null>(null);
  const latestOptionsRef = useRef({
    brushIntervals,
    preselectedOverlayEnabled,
    preselectedSourceIndices,
    selectedSourceIndices,
  });
  const onBrushIntervalsChangeRef = useRef(onBrushIntervalsChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const [displayBrushIntervals, setDisplayBrushIntervals] =
    useState<ParallelBrushIntervals>(brushIntervals);
  const [renderState, setRenderState] = useState<ParallelRenderState>('idle');

  useEffect(() => {
    onBrushIntervalsChangeRef.current = onBrushIntervalsChange;
  }, [onBrushIntervalsChange]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    latestOptionsRef.current = {
      brushIntervals,
      preselectedOverlayEnabled,
      preselectedSourceIndices,
      selectedSourceIndices,
    };
  }, [
    brushIntervals,
    preselectedOverlayEnabled,
    preselectedSourceIndices,
    selectedSourceIndices,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    const shell = shellRef.current;
    if (host === null || shell === null) {
      return;
    }
    const initialOptions = latestOptionsRef.current;
    const plot = createParallelPlot(host, {
      baseCanvasClassName:
        'parallel-fast-webgl-canvas parallel-fast-webgl-canvas-base',
      buffers,
      brushIntervals: initialOptions.brushIntervals,
      hoverCanvasClassName:
        'parallel-fast-webgl-canvas parallel-fast-webgl-hover-canvas',
      preselectedOverlayEnabled: initialOptions.preselectedOverlayEnabled,
      preselectedSourceIndices: initialOptions.preselectedSourceIndices,
      selectedSourceIndices: initialOptions.selectedSourceIndices,
      selectedVisualUpdateDelayMs: 0,
    });
    plotRef.current = plot;
    setRenderState(plot.commands.getRenderSnapshot().renderState);
    plot.use(
      createDefaultParallelBindings({
        brushHitTest: createParallelDomBrushHitTest(),
        coordinateTarget: host,
        inputElement: shell,
      }),
    );
    const unsubscribeRenderState = plot.on('renderstatechange', (event) => {
      setRenderState(event.state);
    });
    const unsubscribeBrushPreview = plot.on('brushpreview', (event) => {
      setDisplayBrushIntervals(event.brushIntervals);
    });
    const unsubscribeBrushChange = plot.on('brushchange', (event) => {
      setDisplayBrushIntervals(event.brushIntervals);
      onBrushIntervalsChangeRef.current(event.brushIntervals);
    });
    const unsubscribeSelection = plot.on('selectionchange', (event) => {
      onSelectionChangeRef.current(event.sourceIndices);
    });

    return () => {
      unsubscribeSelection();
      unsubscribeBrushChange();
      unsubscribeBrushPreview();
      unsubscribeRenderState();
      plotRef.current = null;
      plot.dispose();
    };
  }, [buffers]);

  useEffect(() => {
    plotRef.current?.update({
      preselectedOverlayEnabled,
      preselectedSourceIndices,
    });
  }, [preselectedOverlayEnabled, preselectedSourceIndices]);

  return (
    <div
      ref={shellRef}
      aria-label="Parallel fast WebGL2 chart"
      className="parallel-fast-chart-shell"
      role="region"
      tabIndex={0}
    >
      <div
        ref={hostRef}
        aria-label="WebGL2 segment parallel renderer"
        className="parallel-fast-chart-host"
        data-axis-count={buffers.axisCount}
        data-axis-labels={buffers.axisOrder.join('|')}
        data-gap-count={buffers.lineSeriesBuffers.gapCount}
        data-record-count={buffers.recordCount}
        data-render-state={renderState}
        data-renderer="webgl2-segments"
        data-sample-count={buffers.lineSeriesBuffers.sampleCount}
        data-testid="parallel-fast-chart-layout"
      />
      <FixtureAxisOverlay
        brushIntervals={displayBrushIntervals}
        buffers={buffers}
      />
    </div>
  );
}

function createFixtureBuffers() {
  const recordCount = 24;
  const axisOrder = ['latency', 'stage', 'accepted', 'observedAt'] as const;
  const accepted = new Array<boolean>(recordCount);
  const latency = new Float32Array(recordCount);
  const observedAt = new Array<string>(recordCount);
  const stage = new Array<string>(recordCount);
  const valuesByAxis: ParallelFastColumns['valuesByAxis'] = {
    accepted,
    observedAt,
    latency,
    stage,
  };

  for (let index = 0; index < recordCount; index += 1) {
    const t = index / Math.max(1, recordCount - 1);
    latency[index] = 40 + Math.sin(t * Math.PI * 2) * 18 + index * 0.4;
    stage[index] = ['queued', 'running', 'done'][index % 3]!;
    accepted[index] = index % 4 !== 0;
    observedAt[index] = `${1_717_200_000_000_000_000n + BigInt(index) * 1_000_000_000n}`;
  }

  return createParallelFastBuffers(
    {
      axes: [
        { key: 'latency', kind: 'numeric', label: 'Latency', unit: 'ms' },
        {
          categories: [
            { label: 'Queued', value: 'queued' },
            { label: 'Running', value: 'running' },
            { label: 'Done', value: 'done' },
          ],
          key: 'stage',
          kind: 'categorical',
          label: 'Stage',
        },
        { key: 'accepted', kind: 'boolean', label: 'Accepted' },
        { key: 'observedAt', kind: 'datetime-ns', label: 'Observed at' },
      ],
      axisOrder,
      ids: Array.from({ length: recordCount }, (_, index) => `pf-fixture-${index + 1}`),
      preselectedSourceIndices: new Uint32Array([2, 5, 11]),
      valuesByAxis,
    },
    { includeWebglSegmentBuffers: true },
  );
}

function FixtureAxisOverlay({
  brushIntervals,
  buffers,
}: {
  brushIntervals: ParallelBrushIntervals;
  buffers: ParallelBuffers;
}) {
  return (
    <div
      className="parallel-fast-axis-overlay"
      data-axis-count={buffers.axisCount}
      data-axis-labels={buffers.axisOrder.join('|')}
      data-testid="parallel-fast-fixture-axis-overlay"
      style={
        {
          '--parallel-fast-axis-label-max-width': '7rem',
          '--parallel-fast-axis-tick-max-width': '5rem',
        } as CSSProperties
      }
    >
      {buffers.axisOrder.map((axis, axisIndex) => {
        const metadata = buffers.axisMetadataByAxis?.[axis];
        const domain = buffers.domainsByAxis[axis];
        const ticks = createParallelFastAxisTicks(metadata, {
          count: 3,
          range: domain,
        });
        const axisKind = metadata?.kind ?? 'numeric';
        const axisLabel = metadata?.label ?? axis;
        const minLabel = formatParallelFastAxisValue(metadata, domain.min);
        const maxLabel = formatParallelFastAxisValue(metadata, domain.max);
        const axisLeftPercent =
          buffers.axisCount <= 1 ? 50 : (axisIndex / (buffers.axisCount - 1)) * 100;
        const axisBottomPercent = PARALLEL_AXIS_MIN_DISPLAY_VALUE * 100;
        const missingAnchorPercent = PARALLEL_MISSING_AXIS_DISPLAY_VALUE * 100;

        return (
          <div
            aria-label={`Brush ${axis}`}
            className="parallel-fast-axis-guide"
            data-axis={axis}
            data-axis-kind={axisKind}
            data-axis-label={axisLabel}
            data-max-label={maxLabel}
            data-min-label={minLabel}
            data-tick-labels={ticks.map((tick) => tick.label).join('|')}
            key={axis}
            style={
              {
                '--parallel-fast-normal-axis-bottom': `${axisBottomPercent}%`,
                '--parallel-fast-missing-axis-anchor': `${missingAnchorPercent}%`,
                left: `${axisLeftPercent}%`,
              } as CSSProperties
            }
          >
            <div className="parallel-fast-axis-line" />
            <div className="parallel-fast-axis-label" title={axisLabel}>
              {axisLabel}
            </div>
            {getBrushRangesForAxis(brushIntervals, axis).map((range, axisRangeIndex) => (
              <FixtureAxisBrush
                axisMetadata={metadata}
                axisRangeIndex={axisRangeIndex}
                domain={domain}
                key={`${axis}-${axisRangeIndex}`}
                parameter={axis}
                range={range}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function parallelNormalizedValueToTopPercent(normalizedValue: number): number {
  const displayValue = parallelRenderedNormalizedValueToDisplayValue(normalizedValue);
  if (!Number.isFinite(displayValue)) {
    return 100;
  }

  return (1 - displayValue) * 100;
}

function FixtureAxisBrush({
  axisMetadata,
  axisRangeIndex,
  domain,
  parameter,
  range,
}: {
  axisMetadata: ParallelFastAxisMetadata | undefined;
  axisRangeIndex: number;
  domain: { max: number; min: number; span: number };
  parameter: ParallelParameter;
  range: NumericRange;
}) {
  const normalizedRange = normalizeRange(range);
  const topPercent = parallelNormalizedValueToTopPercent(
    rawValueToNormalized(normalizedRange.max, domain),
  );
  const bottomPercent = parallelNormalizedValueToTopPercent(
    rawValueToNormalized(normalizedRange.min, domain),
  );

  return (
    <div
      aria-label={`${parameter} brush range`}
      className="parallel-fast-axis-brush"
      data-axis={parameter}
      data-axis-kind={axisMetadata?.kind ?? 'numeric'}
      data-axis-range-index={axisRangeIndex}
      style={{
        height: `${Math.max(0, bottomPercent - topPercent)}%`,
        top: `${topPercent}%`,
      }}
    >
      <button
        aria-label={`Resize ${parameter} brush maximum`}
        className="parallel-fast-axis-brush-handle parallel-fast-axis-brush-handle-max"
        type="button"
      />
      <button
        aria-label={`Move ${parameter} brush range`}
        className="parallel-fast-axis-brush-band"
        type="button"
      />
      <button
        aria-label={`Resize ${parameter} brush minimum`}
        className="parallel-fast-axis-brush-handle parallel-fast-axis-brush-handle-min"
        type="button"
      />
    </div>
  );
}

function getBrushRangesForAxis(
  brushIntervals: ParallelBrushIntervals,
  parameter: ParallelParameter,
): NumericRange[] {
  const interval = brushIntervals[parameter];

  if (interval === null || interval === undefined) {
    return [];
  }

  return Array.isArray(interval)
    ? [...(interval as readonly NumericRange[])]
    : [interval as NumericRange];
}

function normalizeRange(range: NumericRange): NumericRange {
  return range.min <= range.max
    ? range
    : {
        max: range.min,
        min: range.max,
      };
}

function rawValueToNormalized(
  value: number,
  domain: { max: number; min: number; span: number },
): number {
  if (domain.span === 0) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, (value - domain.min) / domain.span));
}
