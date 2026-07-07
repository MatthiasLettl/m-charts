import type {
  HistogramContinuousBinResolution,
  HistogramParameterSpec,
  HistogramRange,
} from './types.js';

const DEFAULT_VISIBLE_BIN_TARGET = 64;

export const DEFAULT_HISTOGRAM_CONTINUOUS_BIN_POLICY = {
  hardMaxVisibleBinCount: 512,
  softMaxVisibleBinCount: 256,
} as const;

export function resolveHistogramContinuousBinSize(input: {
  readonly parameter: Pick<HistogramParameterSpec, 'kind'>;
  readonly requestedBinSize: number | null;
  readonly visibleRange: HistogramRange;
}): HistogramContinuousBinResolution {
  const visibleRange = normalizeRange(input.visibleRange);
  const visibleSpan = getRangeSpan(visibleRange);
  const minBinSize = getMinimumContinuousBinSize(input.parameter.kind, visibleSpan);
  const fallbackBinSize = Math.max(
    minBinSize,
    visibleSpan / DEFAULT_VISIBLE_BIN_TARGET,
  );
  const normalizedRequestedBinSize =
    input.requestedBinSize !== null &&
    Number.isFinite(input.requestedBinSize) &&
    input.requestedBinSize > 0
      ? input.requestedBinSize
      : null;
  const requestedBinSize =
    normalizedRequestedBinSize === null
      ? null
      : Math.max(minBinSize, normalizedRequestedBinSize);
  const requestedVisibleBinCount =
    requestedBinSize === null
      ? null
      : getVisibleBinCount(visibleSpan, requestedBinSize);
  let effectiveBinSize = requestedBinSize ?? fallbackBinSize;
  let status: HistogramContinuousBinResolution['status'] =
    requestedBinSize === null ? 'defaulted' : 'applied';

  if (
    requestedVisibleBinCount !== null &&
    requestedVisibleBinCount >
      DEFAULT_HISTOGRAM_CONTINUOUS_BIN_POLICY.hardMaxVisibleBinCount
  ) {
    effectiveBinSize = Math.max(
      minBinSize,
      visibleSpan /
        DEFAULT_HISTOGRAM_CONTINUOUS_BIN_POLICY.hardMaxVisibleBinCount,
    );
    status = 'clamped';
  } else if (
    requestedVisibleBinCount !== null &&
    requestedVisibleBinCount >
      DEFAULT_HISTOGRAM_CONTINUOUS_BIN_POLICY.softMaxVisibleBinCount
  ) {
    status = 'warned';
  }

  return {
    effectiveBinSize,
    effectiveVisibleBinCount: getVisibleBinCount(visibleSpan, effectiveBinSize),
    hardMaxVisibleBinCount:
      DEFAULT_HISTOGRAM_CONTINUOUS_BIN_POLICY.hardMaxVisibleBinCount,
    minBinSize,
    requestedBinSize,
    requestedVisibleBinCount,
    softMaxVisibleBinCount:
      DEFAULT_HISTOGRAM_CONTINUOUS_BIN_POLICY.softMaxVisibleBinCount,
    status,
    visibleRange,
  };
}

function getVisibleBinCount(span: number, binSize: number): number {
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(binSize) || binSize <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil((span - 1e-12) / binSize));
}

function getMinimumContinuousBinSize(
  parameterKind: HistogramParameterSpec['kind'],
  visibleSpan: number,
): number {
  if (parameterKind === 'datetime-ns') {
    return 1;
  }

  return Math.max(1e-9, visibleSpan / 1_000_000);
}

function normalizeRange(range: HistogramRange): HistogramRange {
  const min = Number.isFinite(range.min) ? range.min : 0;
  const max = Number.isFinite(range.max) ? range.max : min + 1;

  if (max > min) {
    return { max, min };
  }

  const center = (min + max) / 2;
  return { max: center + 0.5, min: center - 0.5 };
}

function getRangeSpan(range: HistogramRange): number {
  return Math.max(1e-9, range.max - range.min);
}
