import type { FastScatterEncodedAxis } from './axisSchema.js';
import type { FastScatterAggregateMeasurementReference } from './measurement.js';
import {
  formatFastScatterAxisValue,
  formatFastScatterDatetimeNsEpochValue,
} from './axisTicks.js';
import type {
  FastScatterPlotSpec,
  FastScatterPointColumns,
  FastScatterPointRef,
} from './types.js';

export interface FastScatterDisplayColumns extends FastScatterPointColumns {
  axisByColumn?: Readonly<Record<string, FastScatterEncodedAxis>>;
}

export interface FastScatterFormattedPointValue {
  encodedValue: number;
  label: string;
  sourceValue?: string;
}

export interface FastScatterFormattedPoint {
  id: string;
  sourceIndex: number;
  x: FastScatterFormattedPointValue;
  y: FastScatterFormattedPointValue;
  yKey: string;
}

export interface FastScatterDisplayField {
  active: boolean;
  delta?: string;
  key: string;
  label: string;
  value: string;
}

export function formatFastScatterPointForDisplay(
  point: FastScatterPointRef,
  columns: FastScatterDisplayColumns,
): FastScatterFormattedPoint {
  return {
    id: point.id,
    sourceIndex: point.sourceIndex,
    x: formatFastScatterColumnValueForDisplay({
      axis:
        columns.xKey === undefined
          ? undefined
          : columns.axisByColumn?.[columns.xKey],
      encodedValue: point.x,
      sourceIndex: point.sourceIndex,
    }),
    y: formatFastScatterColumnValueForDisplay({
      axis: columns.axisByColumn?.[point.yKey],
      encodedValue: point.y,
      sourceIndex: point.sourceIndex,
    }),
    yKey: point.yKey,
  };
}

export function formatFastScatterColumnValueForDisplay({
  axis,
  encodedValue,
  sourceIndex,
}: {
  axis: FastScatterEncodedAxis | undefined;
  encodedValue: number;
  sourceIndex?: number;
}): FastScatterFormattedPointValue {
  if (
    axis?.kind === 'numeric' &&
    axis.indexDisplay !== undefined &&
    sourceIndex !== undefined
  ) {
    const sourceValue = axis.indexDisplay.sourceValues[sourceIndex];

    if (sourceValue !== undefined && Number.isFinite(sourceValue)) {
      return formatFastScatterColumnValueForDisplay({
        axis: axis.indexDisplay.sourceAxis,
        encodedValue: sourceValue,
        sourceIndex,
      });
    }
  }

  if (
    axis?.kind === 'datetime-ns' &&
    sourceIndex !== undefined &&
    axis.epochNsValues[sourceIndex] !== undefined
  ) {
    const sourceValue = axis.epochNsValues[sourceIndex]!;

    return {
      encodedValue,
      label: formatFastScatterDatetimeNsEpochValue(sourceValue),
      sourceValue: `${sourceValue} ns`,
    };
  }

  return {
    encodedValue,
    label: formatFastScatterAxisValue(axis, encodedValue),
  };
}

export function formatFastScatterFormattedPointValueForDisplay(
  value: FastScatterFormattedPointValue,
): string {
  return value.sourceValue === undefined
    ? value.label
    : `${value.label} (${value.sourceValue})`;
}

export function createFastScatterPointDisplayFields({
  activeYKey,
  display,
}: {
  activeYKey: string;
  display: FastScatterFormattedPoint;
}): readonly FastScatterDisplayField[] {
  return [
    {
      active: false,
      key: 'x',
      label: 'x',
      value: formatFastScatterFormattedPointValueForDisplay(display.x),
    },
    {
      active: display.yKey === activeYKey,
      key: display.yKey,
      label: display.yKey,
      value: formatFastScatterFormattedPointValueForDisplay(display.y),
    },
  ];
}

export function createFastScatterSourceDisplayFields({
  activeYKey,
  columns,
  sourceIndex,
  spec,
}: {
  activeYKey: string;
  columns: FastScatterDisplayColumns;
  sourceIndex: number;
  spec: FastScatterPlotSpec;
}): readonly FastScatterDisplayField[] {
  return [
    {
      active: false,
      key: 'x',
      label: spec.xLabel,
      value: formatSourceFieldValue({
        axis:
          columns.xKey === undefined
            ? undefined
            : columns.axisByColumn?.[columns.xKey],
        encodedValue: columns.x[sourceIndex],
        sourceIndex,
      }),
    },
    ...spec.plots.map((plot) => ({
      active: plot.yKey === activeYKey,
      key: plot.yKey,
      label: plot.label,
      value: formatSourceFieldValue({
        axis: columns.axisByColumn?.[plot.yKey],
        encodedValue: columns.y[plot.yKey]?.[sourceIndex],
        sourceIndex,
      }),
    })),
  ];
}

export function createFastScatterMeasurementDisplayFields({
  activeYKey,
  columns,
  currentSourceIndex,
  referenceSourceIndex,
  spec,
}: {
  activeYKey: string;
  columns: FastScatterDisplayColumns;
  currentSourceIndex: number;
  referenceSourceIndex: number;
  spec: FastScatterPlotSpec;
}): readonly FastScatterDisplayField[] {
  const xAxis =
    columns.xKey === undefined
      ? undefined
      : columns.axisByColumn?.[columns.xKey];

  return [
    {
      active: false,
      delta: formatSourceFieldDelta({
        axis: xAxis,
        currentSourceIndex,
        fromEncodedValue: columns.x[referenceSourceIndex],
        referenceSourceIndex,
        toEncodedValue: columns.x[currentSourceIndex],
      }),
      key: 'x',
      label: spec.xLabel,
      value: formatSourceFieldValue({
        axis: xAxis,
        encodedValue: columns.x[currentSourceIndex],
        sourceIndex: currentSourceIndex,
      }),
    },
    ...spec.plots.map((plot) => {
      const axis = columns.axisByColumn?.[plot.yKey];

      return {
        active: plot.yKey === activeYKey,
        delta: formatSourceFieldDelta({
          axis,
          currentSourceIndex,
          fromEncodedValue: columns.y[plot.yKey]?.[referenceSourceIndex],
          referenceSourceIndex,
          toEncodedValue: columns.y[plot.yKey]?.[currentSourceIndex],
        }),
        key: plot.yKey,
        label: plot.label,
        value: formatSourceFieldValue({
          axis,
          encodedValue: columns.y[plot.yKey]?.[currentSourceIndex],
          sourceIndex: currentSourceIndex,
        }),
      };
    }),
  ];
}

export function createFastScatterAggregateDisplayFields({
  activeYKey,
  aggregate,
  columns,
  spec,
}: {
  activeYKey: string;
  aggregate: FastScatterAggregateMeasurementReference;
  columns: FastScatterDisplayColumns;
  spec: FastScatterPlotSpec;
}): readonly FastScatterDisplayField[] {
  const xAxis =
    columns.xKey === undefined
      ? undefined
      : columns.axisByColumn?.[columns.xKey];
  const yAxis = columns.axisByColumn?.[aggregate.yKey];
  const yLabel = spec.plots.find((plot) => plot.yKey === aggregate.yKey)?.label ?? aggregate.yKey;

  return [
    {
      active: false,
      key: 'x-center',
      label: spec.xLabel,
      value: formatAggregateAxisCenterValue(xAxis, aggregate.axis.x),
    },
    {
      active: false,
      key: 'x-range',
      label: `${spec.xLabel} range`,
      value: formatAggregateAxisRangeForDisplay(xAxis, aggregate.axis.x),
    },
    {
      active: aggregate.yKey === activeYKey,
      key: aggregate.yKey,
      label: yLabel,
      value: formatAggregateAxisCenterValue(yAxis, aggregate.axis.y),
    },
    {
      active: aggregate.yKey === activeYKey,
      key: `${aggregate.yKey}-range`,
      label: `${yLabel} range`,
      value: formatAggregateAxisRangeForDisplay(yAxis, aggregate.axis.y),
    },
    {
      active: false,
      key: 'count',
      label: 'count',
      value: aggregate.count.toLocaleString('en-US'),
    },
  ];
}

export function createFastScatterAggregateMeasurementDisplayFields({
  activeYKey,
  columns,
  current,
  reference,
  spec,
}: {
  activeYKey: string;
  columns: FastScatterDisplayColumns;
  current: FastScatterAggregateMeasurementReference;
  reference: FastScatterAggregateMeasurementReference;
  spec: FastScatterPlotSpec;
}): readonly FastScatterDisplayField[] {
  const xAxis =
    columns.xKey === undefined
      ? undefined
      : columns.axisByColumn?.[columns.xKey];
  const yAxis = columns.axisByColumn?.[current.yKey];
  const yLabel = spec.plots.find((plot) => plot.yKey === current.yKey)?.label ?? current.yKey;

  return [
    {
      active: false,
      delta: formatFastScatterAxisDeltaForDisplay({
        axis: xAxis,
        fromEncodedValue: reference.axis.x.center,
        toEncodedValue: current.axis.x.center,
      }),
      key: 'x-center',
      label: spec.xLabel,
      value: formatAggregateAxisCenterValue(xAxis, current.axis.x),
    },
    {
      active: false,
      key: 'x-range',
      label: `${spec.xLabel} range`,
      value: formatAggregateAxisRangeForDisplay(xAxis, current.axis.x),
    },
    {
      active: current.yKey === activeYKey,
      delta: formatFastScatterAxisDeltaForDisplay({
        axis: yAxis,
        fromEncodedValue: reference.axis.y.center,
        toEncodedValue: current.axis.y.center,
      }),
      key: current.yKey,
      label: yLabel,
      value: formatAggregateAxisCenterValue(yAxis, current.axis.y),
    },
    {
      active: current.yKey === activeYKey,
      key: `${current.yKey}-range`,
      label: `${yLabel} range`,
      value: formatAggregateAxisRangeForDisplay(yAxis, current.axis.y),
    },
    {
      active: false,
      delta: formatSignedCountDelta(current.count - reference.count),
      key: 'count',
      label: 'count',
      value: current.count.toLocaleString('en-US'),
    },
  ];
}

export function formatFastScatterAxisDeltaForDisplay({
  axis,
  fromEncodedValue,
  fromSourceIndex,
  toEncodedValue,
  toSourceIndex,
}: {
  axis: FastScatterEncodedAxis | undefined;
  fromEncodedValue: number;
  fromSourceIndex?: number;
  toEncodedValue: number;
  toSourceIndex?: number;
}): string {
  if (
    axis?.kind === 'numeric' &&
    axis.indexDisplay !== undefined &&
    fromSourceIndex !== undefined &&
    toSourceIndex !== undefined
  ) {
    const fromSourceValue = axis.indexDisplay.sourceValues[fromSourceIndex];
    const toSourceValue = axis.indexDisplay.sourceValues[toSourceIndex];

    if (
      fromSourceValue !== undefined &&
      toSourceValue !== undefined &&
      Number.isFinite(fromSourceValue) &&
      Number.isFinite(toSourceValue)
    ) {
      return formatFastScatterAxisDeltaForDisplay({
        axis: axis.indexDisplay.sourceAxis,
        fromEncodedValue: fromSourceValue,
        fromSourceIndex,
        toEncodedValue: toSourceValue,
        toSourceIndex,
      });
    }
  }

  if (axis === undefined || axis.kind === 'numeric') {
    return formatSignedAxisNumber(toEncodedValue - fromEncodedValue, axis?.unit);
  }

  if (axis.kind === 'datetime-ns') {
    return formatSignedDurationMs(toEncodedValue - fromEncodedValue);
  }

  const from = formatFastScatterColumnValueForDisplay({
    axis,
    encodedValue: fromEncodedValue,
    sourceIndex: fromSourceIndex,
  }).label;
  const to = formatFastScatterColumnValueForDisplay({
    axis,
    encodedValue: toEncodedValue,
    sourceIndex: toSourceIndex,
  }).label;

  return from === to ? `unchanged ${to}` : `${from} -> ${to}`;
}

function formatSignedAxisNumber(value: number, unit: string | undefined): string {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  const magnitude = Math.abs(value);
  const formatted =
    magnitude >= 1000
      ? value.toFixed(0)
      : magnitude >= 10
        ? value.toFixed(1)
        : value.toFixed(2);

  return `${value >= 0 ? '+' : ''}${formatted}${unit === undefined || unit === '' ? '' : ` ${unit}`}`;
}

function formatSignedDurationMs(deltaMs: number): string {
  if (!Number.isFinite(deltaMs)) {
    return 'n/a';
  }

  const absoluteMs = Math.abs(deltaMs);
  const sign = deltaMs >= 0 ? '+' : '-';

  if (absoluteMs >= 86_400_000) {
    return `${sign}${(absoluteMs / 86_400_000).toFixed(2)} d`;
  }

  if (absoluteMs >= 3_600_000) {
    return `${sign}${(absoluteMs / 3_600_000).toFixed(2)} h`;
  }

  if (absoluteMs >= 60_000) {
    return `${sign}${(absoluteMs / 60_000).toFixed(2)} min`;
  }

  if (absoluteMs >= 1000) {
    return `${sign}${(absoluteMs / 1000).toFixed(2)} s`;
  }

  return `${sign}${absoluteMs.toFixed(absoluteMs >= 10 ? 1 : 2)} ms`;
}

function formatSourceFieldValue({
  axis,
  encodedValue,
  sourceIndex,
}: {
  axis: FastScatterEncodedAxis | undefined;
  encodedValue: number | undefined;
  sourceIndex: number;
}): string {
  if (encodedValue === undefined || !Number.isFinite(encodedValue)) {
    return 'n/a';
  }

  return formatFastScatterFormattedPointValueForDisplay(
    formatFastScatterColumnValueForDisplay({
      axis,
      encodedValue,
      sourceIndex,
    }),
  );
}

function formatSourceFieldDelta({
  axis,
  currentSourceIndex,
  fromEncodedValue,
  referenceSourceIndex,
  toEncodedValue,
}: {
  axis: FastScatterEncodedAxis | undefined;
  currentSourceIndex: number;
  fromEncodedValue: number | undefined;
  referenceSourceIndex: number;
  toEncodedValue: number | undefined;
}): string {
  if (
    fromEncodedValue === undefined ||
    toEncodedValue === undefined ||
    !Number.isFinite(fromEncodedValue) ||
    !Number.isFinite(toEncodedValue)
  ) {
    return 'n/a';
  }

  return formatFastScatterAxisDeltaForDisplay({
    axis,
    fromEncodedValue,
    fromSourceIndex: referenceSourceIndex,
    toEncodedValue,
    toSourceIndex: currentSourceIndex,
  });
}

function formatAggregateAxisCenterValue(
  axis: FastScatterEncodedAxis | undefined,
  range: FastScatterAggregateMeasurementReference['axis']['x'],
): string {
  return formatFastScatterFormattedPointValueForDisplay(
    formatFastScatterColumnValueForDisplay({
      axis,
      encodedValue: range.center,
    }),
  );
}

function formatAggregateAxisRangeForDisplay(
  axis: FastScatterEncodedAxis | undefined,
  range: FastScatterAggregateMeasurementReference['axis']['x'],
): string {
  const min = formatFastScatterColumnValueForDisplay({
    axis,
    encodedValue: range.min,
  }).label;
  const max = formatFastScatterColumnValueForDisplay({
    axis,
    encodedValue: range.max,
  }).label;

  return `[${min}, ${max}]`;
}

function formatSignedCountDelta(delta: number): string {
  if (!Number.isFinite(delta)) {
    return 'n/a';
  }

  return `${delta >= 0 ? '+' : ''}${delta.toLocaleString('en-US')}`;
}
