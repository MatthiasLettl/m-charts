import type {
  HistogramColumns,
  HistogramParameterKey,
  HistogramParameterSpec,
  HistogramPlotSpec,
  HistogramRange,
  HistogramValueColumn,
  HistogramViewport,
} from './types.js';

export interface HistogramCalculatedDomain {
  readonly excludedValueCount: number;
  readonly invalidValueCount: number;
  readonly missingValueCount: number;
  readonly outOfDomainValueCount: number;
  readonly range: HistogramRange;
}

export interface HistogramAggregationPreparedState {
  readonly parameterPlanByKey: ReadonlyMap<
    HistogramParameterKey,
    HistogramPreparedParameterPlan
  >;
}

export type HistogramPreparedParameterPlan =
  | HistogramPreparedCategoryPlan
  | HistogramPreparedContinuousPlan;

export interface HistogramPreparedContinuousPlan {
  readonly domain: HistogramCalculatedDomain;
  readonly kind: 'continuous';
  readonly parameter: HistogramParameterSpec;
  readonly rowIndicesBySortedValue: Uint32Array;
  readonly sortedValues: Float64Array;
}

export interface HistogramPreparedCategoryPlan {
  readonly domain: HistogramCalculatedDomain;
  readonly kind: 'category';
  readonly parameter: HistogramParameterSpec;
}

export interface HistogramContinuousVisibleWindow {
  readonly candidateEnd: number;
  readonly candidateStart: number;
  readonly visibleRange: HistogramRange;
}

export function prepareHistogramAggregationState(
  columns: HistogramColumns,
  plotSpec: Pick<HistogramPlotSpec, 'parameters'>,
): HistogramAggregationPreparedState {
  const parameterPlanByKey = new Map<
    HistogramParameterKey,
    HistogramPreparedParameterPlan
  >();

  for (const parameter of plotSpec.parameters) {
    const domain = calculatePreparedHistogramDomain(columns.valuesByParameter[parameter.key], parameter);
    if (parameter.kind === 'categorical' || parameter.kind === 'boolean') {
      parameterPlanByKey.set(parameter.key, {
        domain,
        kind: 'category',
        parameter,
      });
      continue;
    }

    parameterPlanByKey.set(
      parameter.key,
      prepareContinuousParameterPlan(columns.valuesByParameter[parameter.key], parameter, domain),
    );
  }

  return {
    parameterPlanByKey,
  };
}

function calculatePreparedHistogramDomain(
  column: HistogramValueColumn | undefined,
  parameter: HistogramParameterSpec,
): HistogramCalculatedDomain {
  if (parameter.domain !== undefined) {
    if (column === undefined) {
      return {
        excludedValueCount: 0,
        invalidValueCount: 0,
        missingValueCount: 0,
        outOfDomainValueCount: 0,
        range: normalizeRange(parameter.domain),
      };
    }
    let invalidValueCount = 0;
    let missingValueCount = 0;
    let outOfDomainValueCount = 0;
    const range = normalizeRange(parameter.domain);
    for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
      const rawValue = column[rowIndex];
      if (rawValue === null || rawValue === undefined) {
        missingValueCount += 1;
        continue;
      }
      const value =
        typeof rawValue === 'number'
          ? rawValue
          : typeof rawValue === 'bigint'
            ? Number(rawValue)
            : Number.NaN;
      if (!Number.isFinite(value)) {
        invalidValueCount += 1;
        continue;
      }
      if (value < range.min || value > range.max) {
        outOfDomainValueCount += 1;
      }
    }
    return {
      excludedValueCount: invalidValueCount + missingValueCount + outOfDomainValueCount,
      invalidValueCount,
      missingValueCount,
      outOfDomainValueCount,
      range,
    };
  }

  if (parameter.kind === 'categorical' || parameter.kind === 'boolean') {
    const categories = parameter.categories ?? [];
    if (categories.length === 0) {
      return {
        excludedValueCount: 0,
        invalidValueCount: 0,
        missingValueCount: 0,
        outOfDomainValueCount: 0,
        range: { max: 1, min: 0 },
      };
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < categories.length; index += 1) {
      const encoded = categories[index]?.encoded ?? index;
      min = Math.min(min, encoded);
      max = Math.max(max, encoded);
    }

    return {
      excludedValueCount: 0,
      invalidValueCount: 0,
      missingValueCount: 0,
      outOfDomainValueCount: 0,
      range: normalizeRange({ max, min }),
    };
  }

  if (column === undefined) {
    return {
      excludedValueCount: 0,
      invalidValueCount: 0,
      missingValueCount: 0,
      outOfDomainValueCount: 0,
      range: { max: 1, min: 0 },
    };
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let invalidValueCount = 0;
  let missingValueCount = 0;

  for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
    const rawValue = column[rowIndex];
    if (rawValue === null || rawValue === undefined) {
      missingValueCount += 1;
      continue;
    }

    const value =
      typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'bigint'
          ? Number(rawValue)
          : Number.NaN;
    if (!Number.isFinite(value)) {
      invalidValueCount += 1;
      continue;
    }

    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  return {
    excludedValueCount: invalidValueCount + missingValueCount,
    invalidValueCount,
    missingValueCount,
    outOfDomainValueCount: 0,
    range: normalizeRange({
      max: Number.isFinite(max) ? max : 1,
      min: Number.isFinite(min) ? min : 0,
    }),
  };
}

export function resolveContinuousVisibleWindow(
  plan: HistogramPreparedContinuousPlan,
  viewport: HistogramViewport | undefined,
  subplotId: string,
): HistogramContinuousVisibleWindow {
  const viewportRange = viewport?.subplotById[subplotId]?.x;
  const domainRange = plan.domain.range;
  const unclippedVisibleMin = viewportRange?.min ?? domainRange.min;
  const unclippedVisibleMax = viewportRange?.max ?? domainRange.max;
  const visibleMin = Math.max(domainRange.min, Math.min(unclippedVisibleMin, unclippedVisibleMax));
  const visibleMax = Math.min(domainRange.max, Math.max(unclippedVisibleMin, unclippedVisibleMax));

  if (visibleMax <= visibleMin) {
    return {
      candidateEnd: 0,
      candidateStart: 0,
      visibleRange: {
        max: domainRange.max,
        min: domainRange.min,
      },
    };
  }

  return {
    candidateEnd: upperBound(plan.sortedValues, visibleMax),
    candidateStart: lowerBound(plan.sortedValues, visibleMin),
    visibleRange: {
      max: visibleMax,
      min: visibleMin,
    },
  };
}

function prepareContinuousParameterPlan(
  column: HistogramValueColumn | undefined,
  parameter: HistogramParameterSpec,
  domain: HistogramCalculatedDomain,
): HistogramPreparedContinuousPlan {
  if (column === undefined) {
    return {
      domain,
      kind: 'continuous',
      parameter,
      rowIndicesBySortedValue: new Uint32Array(0),
      sortedValues: new Float64Array(0),
    };
  }

  const sortable: Array<{ readonly rowIndex: number; readonly value: number }> = [];
  for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
    const rawValue = column[rowIndex];
    if (rawValue === null || rawValue === undefined) {
      continue;
    }

    const value =
      typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'bigint'
          ? Number(rawValue)
          : Number.NaN;
    if (!Number.isFinite(value)) {
      continue;
    }
    if (value < domain.range.min || value > domain.range.max) {
      continue;
    }

    sortable.push({ rowIndex, value });
  }

  sortable.sort((left, right) => left.value - right.value);
  const rowIndicesBySortedValue = new Uint32Array(sortable.length);
  const sortedValues = new Float64Array(sortable.length);

  for (let index = 0; index < sortable.length; index += 1) {
    rowIndicesBySortedValue[index] = sortable[index]?.rowIndex ?? 0;
    sortedValues[index] = sortable[index]?.value ?? 0;
  }

  return {
    domain,
    kind: 'continuous',
    parameter,
    rowIndicesBySortedValue,
    sortedValues,
  };
}

function lowerBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if ((values[middle] ?? Number.POSITIVE_INFINITY) < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function upperBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if ((values[middle] ?? Number.NEGATIVE_INFINITY) <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function normalizeRange(range: HistogramRange): HistogramRange {
  const min = Number.isFinite(range.min) ? range.min : 0;
  const max = Number.isFinite(range.max) ? range.max : min + 1;
  return max > min ? { max, min } : { max: min + 1, min };
}
