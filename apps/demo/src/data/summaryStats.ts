import type { ViewportState } from '../state/viewSearchParams.ts';
import { findVisibleRecordIndexRange } from './density.ts';
import { SCATTER_Y_ATTRIBUTES, type ScatterRecord, type ScatterYAttribute } from './types.ts';

export interface MetricSummary {
  count: number;
  max: number | null;
  mean: number | null;
  min: number | null;
}

export type CompareSummary = Record<ScatterYAttribute, MetricSummary>;

export interface CompareSummaries {
  selected: CompareSummary;
  visible: CompareSummary;
}

export function createEmptyMetricSummary(): MetricSummary {
  return {
    count: 0,
    max: null,
    mean: null,
    min: null,
  };
}

export function summarizeMetricValues(values: Iterable<number>): MetricSummary {
  let count = 0;
  let max = Number.NEGATIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  let sum = 0;

  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue;
    }

    count += 1;
    max = Math.max(max, value);
    min = Math.min(min, value);
    sum += value;
  }

  if (count === 0) {
    return createEmptyMetricSummary();
  }

  return {
    count,
    max,
    mean: sum / count,
    min,
  };
}

export function createCompareSummaries(
  records: readonly ScatterRecord[],
  viewport: ViewportState,
  selectedIds: ReadonlySet<string>,
): CompareSummaries {
  return {
    selected: createSelectedCompareSummary(records, selectedIds),
    visible: createVisibleCompareSummary(records, viewport),
  };
}

export function createSelectedCompareSummary(
  records: readonly ScatterRecord[],
  selectedIds: ReadonlySet<string>,
): CompareSummary {
  const accumulators = createMetricAccumulators();

  if (selectedIds.size === 0) {
    return finalizeMetricAccumulators(accumulators);
  }

  for (const record of records) {
    if (!selectedIds.has(record.id)) {
      continue;
    }

    for (const attribute of SCATTER_Y_ATTRIBUTES) {
      addMetricValue(accumulators[attribute], record[attribute]);
    }
  }

  return finalizeMetricAccumulators(accumulators);
}

export function createVisibleCompareSummary(
  records: readonly ScatterRecord[],
  viewport: ViewportState,
): CompareSummary {
  const accumulators = createMetricAccumulators();
  const xRange = findVisibleRecordIndexRange(records, viewport.x);

  for (let index = xRange.start; index < xRange.end; index += 1) {
    const record = records[index];

    for (const attribute of SCATTER_Y_ATTRIBUTES) {
      const value = record[attribute];
      const yRange = viewport[attribute];

      if (value >= yRange.min && value <= yRange.max) {
        addMetricValue(accumulators[attribute], value);
      }
    }
  }

  return finalizeMetricAccumulators(accumulators);
}

interface MetricAccumulator {
  count: number;
  max: number;
  min: number;
  sum: number;
}

function createMetricAccumulators(): Record<ScatterYAttribute, MetricAccumulator> {
  return {
    a: createMetricAccumulator(),
    b: createMetricAccumulator(),
    c: createMetricAccumulator(),
  };
}

function createMetricAccumulator(): MetricAccumulator {
  return {
    count: 0,
    max: Number.NEGATIVE_INFINITY,
    min: Number.POSITIVE_INFINITY,
    sum: 0,
  };
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
  accumulators: Record<ScatterYAttribute, MetricAccumulator>,
): CompareSummary {
  return {
    a: finalizeMetricAccumulator(accumulators.a),
    b: finalizeMetricAccumulator(accumulators.b),
    c: finalizeMetricAccumulator(accumulators.c),
  };
}

function finalizeMetricAccumulator(accumulator: MetricAccumulator): MetricSummary {
  if (accumulator.count === 0) {
    return createEmptyMetricSummary();
  }

  return {
    count: accumulator.count,
    max: accumulator.max,
    mean: accumulator.sum / accumulator.count,
    min: accumulator.min,
  };
}
