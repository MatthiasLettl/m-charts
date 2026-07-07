import type { FastScatterRange, FastScatterTypedNumericArray } from './types.js';

export interface FastScatterNavigatorBin {
  count: number;
  maxY: number;
  minX: number;
  x: number;
}

export interface FastScatterNavigatorSummary {
  bins: FastScatterNavigatorBin[];
  domain: FastScatterRange;
  maxCount: number;
}

export interface FastScatterNavigatorWindowDragInput {
  currentPointerCssX: number;
  domain: FastScatterRange;
  startPointerCssX: number;
  startWindow: FastScatterRange;
  widthCssPx: number;
}

export interface FastScatterNavigatorResizeInput
  extends FastScatterNavigatorWindowDragInput {
  edge: 'min' | 'max';
  minSpan?: number;
}

const MIN_SPAN = 1e-9;

export function createFastScatterNavigatorSummary({
  binCount,
  domain,
  x,
}: {
  binCount: number;
  domain: FastScatterRange;
  x: FastScatterTypedNumericArray;
}): FastScatterNavigatorSummary {
  const normalizedDomain = normalizeNavigatorRange(domain, { min: 0, max: 1 });
  const count = Math.max(1, Math.floor(binCount));
  const bins: FastScatterNavigatorBin[] = Array.from({ length: count }, (_, index) => {
    const minX =
      normalizedDomain.min +
      (index / count) * (normalizedDomain.max - normalizedDomain.min);
    const maxX =
      normalizedDomain.min +
      ((index + 1) / count) * (normalizedDomain.max - normalizedDomain.min);

    return {
      count: 0,
      maxY: 0,
      minX,
      x: (minX + maxX) / 2,
    };
  });

  const span = safeSpan(normalizedDomain);
  let maxCount = 0;

  for (let index = 0; index < x.length; index += 1) {
    const value = x[index];
    if (!Number.isFinite(value)) {
      continue;
    }

    const binIndex = Math.min(
      count - 1,
      Math.max(0, Math.floor(((value - normalizedDomain.min) / span) * count)),
    );
    const bin = bins[binIndex]!;
    bin.count += 1;
    maxCount = Math.max(maxCount, bin.count);
  }

  if (maxCount > 0) {
    for (const bin of bins) {
      bin.maxY = bin.count / maxCount;
    }
  }

  return {
    bins,
    domain: normalizedDomain,
    maxCount,
  };
}

export function calculateFastScatterNavigatorWindowPixels(
  window: FastScatterRange,
  domain: FastScatterRange,
  widthCssPx: number,
): { leftCssPx: number; widthCssPx: number } {
  const normalizedDomain = normalizeNavigatorRange(domain, { min: 0, max: 1 });
  const normalizedWindow = clampFastScatterNavigatorWindow(
    normalizeNavigatorRange(window, normalizedDomain),
    normalizedDomain,
  );
  const width = Math.max(1, widthCssPx);
  const span = safeSpan(normalizedDomain);
  const leftCssPx =
    ((normalizedWindow.min - normalizedDomain.min) / span) * width;
  const rightCssPx =
    ((normalizedWindow.max - normalizedDomain.min) / span) * width;

  return {
    leftCssPx,
    widthCssPx: Math.max(0, rightCssPx - leftCssPx),
  };
}

export function dragFastScatterNavigatorWindow(
  input: FastScatterNavigatorWindowDragInput,
): FastScatterRange {
  const domain = normalizeNavigatorRange(input.domain, { min: 0, max: 1 });
  const startWindow = clampFastScatterNavigatorWindow(
    normalizeNavigatorRange(input.startWindow, domain),
    domain,
  );
  const domainUnitsPerCssPx = safeSpan(domain) / Math.max(1, input.widthCssPx);
  const delta = (input.currentPointerCssX - input.startPointerCssX) * domainUnitsPerCssPx;

  return clampFastScatterNavigatorWindow(
    {
      min: startWindow.min + delta,
      max: startWindow.max + delta,
    },
    domain,
  );
}

export function resizeFastScatterNavigatorWindow(
  input: FastScatterNavigatorResizeInput,
): FastScatterRange {
  const domain = normalizeNavigatorRange(input.domain, { min: 0, max: 1 });
  const startWindow = clampFastScatterNavigatorWindow(
    normalizeNavigatorRange(input.startWindow, domain),
    domain,
  );
  const domainUnitsPerCssPx = safeSpan(domain) / Math.max(1, input.widthCssPx);
  const delta = (input.currentPointerCssX - input.startPointerCssX) * domainUnitsPerCssPx;
  const minSpan = Math.max(MIN_SPAN, input.minSpan ?? safeSpan(domain) * 0.0025);

  if (input.edge === 'min') {
    return {
      min: Math.min(
        Math.max(domain.min, startWindow.min + delta),
        startWindow.max - minSpan,
      ),
      max: startWindow.max,
    };
  }

  return {
    min: startWindow.min,
    max: Math.max(
      Math.min(domain.max, startWindow.max + delta),
      startWindow.min + minSpan,
    ),
  };
}

export function clampFastScatterNavigatorWindow(
  window: FastScatterRange,
  domain: FastScatterRange,
): FastScatterRange {
  const normalizedDomain = normalizeNavigatorRange(domain, { min: 0, max: 1 });
  const span = Math.min(safeSpan(window), safeSpan(normalizedDomain));
  let min = window.min;
  let max = window.min + span;

  if (max > normalizedDomain.max) {
    max = normalizedDomain.max;
    min = max - span;
  }

  if (min < normalizedDomain.min) {
    min = normalizedDomain.min;
    max = min + span;
  }

  return { min, max };
}

function normalizeNavigatorRange(
  range: FastScatterRange,
  fallback: FastScatterRange,
): FastScatterRange {
  if (
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    range.min > range.max
  ) {
    return normalizeNavigatorRange(fallback, { min: 0, max: 1 });
  }

  if (range.min === range.max) {
    return {
      min: range.min - 0.5,
      max: range.max + 0.5,
    };
  }

  return { min: range.min, max: range.max };
}

function safeSpan(range: FastScatterRange): number {
  return Math.max(MIN_SPAN, range.max - range.min);
}
