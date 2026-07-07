import type {
  FastScatterPointColumns,
  FastScatterPlotSpec,
  FastScatterViewport,
} from './types.js';

export interface FastScatterMetricSummary {
  count: number;
  max: number | null;
  mean: number | null;
  min: number | null;
}

export type FastScatterCompareSummary = Record<string, FastScatterMetricSummary>;

export interface FastScatterCompareSummaries {
  selected: FastScatterCompareSummary;
  visible: FastScatterCompareSummary;
}

interface MetricAccumulator {
  count: number;
  max: number;
  min: number;
  sum: number;
}

export function createFastScatterCompareSummaries(
  columns: Pick<FastScatterPointColumns, 'x' | 'y'>,
  spec: FastScatterPlotSpec,
  viewport: FastScatterViewport,
  selectedSourceIndices: Uint32Array,
): FastScatterCompareSummaries {
  return {
    selected: createFastScatterSelectedCompareSummary(
      columns,
      spec,
      selectedSourceIndices,
    ),
    visible: createFastScatterVisibleCompareSummary(columns, spec, viewport),
  };
}

export function createFastScatterSelectedCompareSummary(
  columns: Pick<FastScatterPointColumns, 'y'>,
  spec: FastScatterPlotSpec,
  selectedSourceIndices: Uint32Array,
): FastScatterCompareSummary {
  const accumulators = createMetricAccumulators(spec);

  for (const sourceIndex of selectedSourceIndices) {
    for (const plot of spec.plots) {
      const y = columns.y[plot.yKey];

      if (y !== undefined && sourceIndex < y.length) {
        addMetricValue(accumulators[plot.id], y[sourceIndex]);
      }
    }
  }

  return finalizeMetricAccumulators(accumulators);
}

export function createFastScatterVisibleCompareSummary(
  columns: Pick<FastScatterPointColumns, 'x' | 'y'>,
  spec: FastScatterPlotSpec,
  viewport: FastScatterViewport,
): FastScatterCompareSummary {
  const accumulators = createMetricAccumulators(spec);
  const xRange = normalizeRange(viewport.x);
  const startIndex = lowerBound(columns.x, xRange.min);
  const endIndex = upperBound(columns.x, xRange.max);

  for (let pointIndex = startIndex; pointIndex < endIndex; pointIndex += 1) {
    for (const plot of spec.plots) {
      const y = columns.y[plot.yKey];
      const yRange = viewport.yByPlot[plot.id];

      if (y === undefined || yRange === undefined) {
        continue;
      }

      const value = y[pointIndex];
      const normalizedYRange = normalizeRange(yRange);

      if (value >= normalizedYRange.min && value <= normalizedYRange.max) {
        addMetricValue(accumulators[plot.id], value);
      }
    }
  }

  return finalizeMetricAccumulators(accumulators);
}

function createMetricAccumulators(
  spec: FastScatterPlotSpec,
): Record<string, MetricAccumulator> {
  const accumulators: Record<string, MetricAccumulator> = {};

  for (const plot of spec.plots) {
    accumulators[plot.id] = {
      count: 0,
      max: Number.NEGATIVE_INFINITY,
      min: Number.POSITIVE_INFINITY,
      sum: 0,
    };
  }

  return accumulators;
}

function addMetricValue(accumulator: MetricAccumulator, value: number): void {
  if (!Number.isFinite(value)) {
    return;
  }

  accumulator.count += 1;
  accumulator.max = Math.max(accumulator.max, value);
  accumulator.min = Math.min(accumulator.min, value);
  accumulator.sum += value;
}

function finalizeMetricAccumulators(
  accumulators: Record<string, MetricAccumulator>,
): FastScatterCompareSummary {
  const summaries: FastScatterCompareSummary = {};

  for (const [plotId, accumulator] of Object.entries(accumulators)) {
    summaries[plotId] = finalizeMetricAccumulator(accumulator);
  }

  return summaries;
}

function finalizeMetricAccumulator(
  accumulator: MetricAccumulator,
): FastScatterMetricSummary {
  if (accumulator.count === 0) {
    return {
      count: 0,
      max: null,
      mean: null,
      min: null,
    };
  }

  return {
    count: accumulator.count,
    max: accumulator.max,
    mean: accumulator.sum / accumulator.count,
    min: accumulator.min,
  };
}

function normalizeRange(range: { readonly min: number; readonly max: number }): {
  max: number;
  min: number;
} {
  return range.min <= range.max
    ? { max: range.max, min: range.min }
    : { max: range.min, min: range.max };
}

function lowerBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);

    if (values[mid] < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function upperBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);

    if (values[mid] <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}
