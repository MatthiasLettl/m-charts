import {
  axisToPixel,
  createFastScatterAxisTicks,
  createFastScatterDatetimeTickContext,
  type FastScatterDisplayColumns,
  type FastScatterEncodedAxis,
  type FastScatterPlotRect,
  type FastScatterPlotSpec,
  type FastScatterRange,
  type FastScatterViewport,
} from '../core/index.js';

interface FastScatterOverlayProps {
  columns: FastScatterDisplayColumns;
  heightCssPx: number;
  plotRects: readonly FastScatterPlotRect[];
  spec: FastScatterPlotSpec;
  viewport: FastScatterViewport;
  widthCssPx: number;
}

const X_TICK_COUNT = 5;
const Y_TICK_COUNT = 3;
const Y_AXIS_TITLE_X_OFFSET = 76;
const Y_AXIS_TITLE_VERTICAL_PADDING_CSS_PX = 12;

export function FastScatterOverlay({
  columns,
  heightCssPx,
  plotRects,
  spec,
  viewport,
  widthCssPx,
}: FastScatterOverlayProps) {
  return (
    <svg
      aria-hidden="true"
      className="scatter-fast-overlay"
      data-testid="scatter-fast-overlay"
      height={heightCssPx}
      viewBox={`0 0 ${widthCssPx} ${heightCssPx}`}
      width={widthCssPx}
    >
      {plotRects.map((rect, index) => {
        const plot = spec.plots[index];
        const yRange = plot === undefined ? undefined : viewport.yByPlot[plot.id];

        if (plot === undefined || yRange === undefined) {
          return null;
        }

        return (
          <g
            data-plot-id={plot.id}
            data-testid={`scatter-fast-overlay-plot-${plot.id}`}
            key={plot.id}
          >
            <rect
              className="scatter-fast-hit-region"
              data-plot-id={plot.id}
              data-plot-index={index}
              data-testid="scatter-fast-hit-region"
              data-x-max={String(viewport.x.max)}
              data-x-min={String(viewport.x.min)}
              data-y-key={plot.yKey}
              data-y-max={String(yRange.max)}
              data-y-min={String(yRange.min)}
              height={rect.heightCssPx}
              width={rect.widthCssPx}
              x={rect.xCssPx}
              y={rect.yCssPx}
            />
            <PlotOverlay
              plotLabel={plot.label}
              rect={rect}
              showXTickLabels={index === plotRects.length - 1}
              xAxisLabel={spec.xLabel}
              xAxis={
                columns.xKey === undefined
                  ? undefined
                  : columns.axisByColumn?.[columns.xKey]
              }
              xRange={viewport.x}
              yAxis={columns.axisByColumn?.[plot.yKey]}
              yRange={yRange}
            />
          </g>
        );
      })}
    </svg>
  );
}

function PlotOverlay({
  plotLabel,
  rect,
  showXTickLabels,
  xAxisLabel,
  xAxis,
  xRange,
  yAxis,
  yRange,
}: {
  plotLabel: string;
  rect: FastScatterPlotRect;
  showXTickLabels: boolean;
  xAxisLabel: string;
  xAxis: FastScatterEncodedAxis | undefined;
  xRange: FastScatterRange;
  yAxis: FastScatterEncodedAxis | undefined;
  yRange: FastScatterRange;
}) {
  const xTicks = createFastScatterAxisTicks(xAxis, {
    count: rect.widthCssPx < 360 ? 3 : X_TICK_COUNT,
    range: xRange,
  });
  const xTickContext = createFastScatterDatetimeTickContext(xAxis, {
    count: rect.widthCssPx < 360 ? 3 : X_TICK_COUNT,
    range: xRange,
  });
  const yTicks = createFastScatterAxisTicks(yAxis, {
    count: rect.heightCssPx < 96 ? 3 : Y_TICK_COUNT,
    range: yRange,
  });
  const xAxisY = rect.yCssPx + rect.heightCssPx;

  return (
    <>
      <rect
        className="scatter-fast-overlay-plot-frame"
        fill="none"
        height={rect.heightCssPx}
        width={rect.widthCssPx}
        x={rect.xCssPx}
        y={rect.yCssPx}
      />
      {xTicks.map((tick, index) => {
        const x = axisToPixel(
          tick.value,
          xRange,
          rect.xCssPx,
          rect.xCssPx + rect.widthCssPx,
        );
        const isFirstTick = index === 0;
        const isLastTick = index === xTicks.length - 1;
        const textAnchor = isFirstTick ? 'start' : isLastTick ? 'end' : 'middle';
        return (
          <g className="scatter-fast-overlay-x-tick" key={`x-${tick.value}`}>
            <line
              className="scatter-fast-overlay-grid-line"
              x1={x}
              x2={x}
              y1={rect.yCssPx}
              y2={xAxisY}
            />
            <line
              className="scatter-fast-overlay-axis-tick"
              x1={x}
              x2={x}
              y1={xAxisY}
              y2={xAxisY + 4}
            />
            {showXTickLabels ? (
              <text
                className="scatter-fast-overlay-x-label"
                textAnchor={textAnchor}
                x={x}
                y={xAxisY + 17}
              >
                {tick.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {showXTickLabels ? (
        <text
          className="scatter-fast-overlay-axis-title scatter-fast-overlay-x-title"
          data-testid="scatter-fast-overlay-x-title"
          textAnchor="middle"
          x={rect.xCssPx + rect.widthCssPx / 2}
          y={xAxisY + 34}
        >
          {xTickContext.sharedDateLabel === undefined
            ? xAxisLabel
            : `${xAxisLabel} - ${xTickContext.sharedDateLabel}`}
        </text>
      ) : null}
      {yTicks.map((tick) => {
        const y = axisToPixel(
          tick.value,
          yRange,
          rect.yCssPx + rect.heightCssPx,
          rect.yCssPx,
        );

        return (
          <g className="scatter-fast-overlay-y-tick" key={`y-${tick.value}`}>
            <line
              className="scatter-fast-overlay-grid-line"
              x1={rect.xCssPx}
              x2={rect.xCssPx + rect.widthCssPx}
              y1={y}
              y2={y}
            />
            <line
              className="scatter-fast-overlay-axis-tick"
              x1={rect.xCssPx - 4}
              x2={rect.xCssPx}
              y1={y}
              y2={y}
            />
            <text
              className="scatter-fast-overlay-y-label"
              dominantBaseline="middle"
              textAnchor="end"
              x={rect.xCssPx - 8}
              y={y}
            >
              {tick.label}
            </text>
          </g>
        );
      })}
      <line
        className="scatter-fast-overlay-axis-line"
        x1={rect.xCssPx}
        x2={rect.xCssPx}
        y1={rect.yCssPx}
        y2={xAxisY}
      />
      <line
        className="scatter-fast-overlay-axis-line"
        x1={rect.xCssPx}
        x2={rect.xCssPx + rect.widthCssPx}
        y1={xAxisY}
        y2={xAxisY}
      />
      <text
        className="scatter-fast-overlay-axis-title scatter-fast-overlay-y-title"
        data-testid="scatter-fast-overlay-y-title"
        dominantBaseline="middle"
        lengthAdjust="spacingAndGlyphs"
        textAnchor="middle"
        textLength={getYAxisTitleTextLength(plotLabel, rect)}
        transform={`rotate(-90 ${rect.xCssPx - Y_AXIS_TITLE_X_OFFSET} ${rect.yCssPx + rect.heightCssPx / 2})`}
        x={rect.xCssPx - Y_AXIS_TITLE_X_OFFSET}
        y={rect.yCssPx + rect.heightCssPx / 2}
      >
        {plotLabel}
      </text>
    </>
  );
}

function getYAxisTitleTextLength(
  plotLabel: string,
  rect: FastScatterPlotRect,
): number | undefined {
  const availableLength = rect.heightCssPx - Y_AXIS_TITLE_VERTICAL_PADDING_CSS_PX * 2;
  if (availableLength < 24) {
    return undefined;
  }

  return Math.min(availableLength, Math.max(24, plotLabel.length * 6.6));
}
