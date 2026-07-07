export const PARALLEL_FAST_LINE_OPACITY_SCALE_PARAM = 'lineOpacityScale';
export const PARALLEL_FAST_DEFAULT_LINE_OPACITY_SCALE = 1;
export const PARALLEL_FAST_LINE_OPACITY_SCALE_STEPS = [
  0.05,
  0.1,
  0.15,
  0.2,
  0.25,
  0.33,
  0.5,
  0.67,
  0.75,
  1,
  1.25,
  1.5,
  1.75,
  2,
  2.5,
  3,
  3.5,
  4,
  5,
  6,
  8,
] as const;

export function parseLineOpacityScaleSearchParam(
  params: URLSearchParams,
): number {
  const rawValue = params.get(PARALLEL_FAST_LINE_OPACITY_SCALE_PARAM);

  if (rawValue === null || rawValue.trim() === '') {
    return PARALLEL_FAST_DEFAULT_LINE_OPACITY_SCALE;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return PARALLEL_FAST_DEFAULT_LINE_OPACITY_SCALE;
  }

  return snapLineOpacityScaleToStep(parsed);
}

export function formatLineOpacityScaleParam(scale: number): string {
  return String(snapLineOpacityScaleToStep(scale));
}

export function getPreviousLineOpacityScale(scale: number): number {
  const currentIndex = getLineOpacityScaleStepIndex(scale);

  return PARALLEL_FAST_LINE_OPACITY_SCALE_STEPS[Math.max(0, currentIndex - 1)]!;
}

export function getNextLineOpacityScale(scale: number): number {
  const currentIndex = getLineOpacityScaleStepIndex(scale);

  return PARALLEL_FAST_LINE_OPACITY_SCALE_STEPS[
    Math.min(PARALLEL_FAST_LINE_OPACITY_SCALE_STEPS.length - 1, currentIndex + 1)
  ]!;
}

export function snapLineOpacityScaleToStep(scale: number): number {
  return PARALLEL_FAST_LINE_OPACITY_SCALE_STEPS[
    getLineOpacityScaleStepIndex(scale)
  ]!;
}

function getLineOpacityScaleStepIndex(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return PARALLEL_FAST_LINE_OPACITY_SCALE_STEPS.indexOf(
      PARALLEL_FAST_DEFAULT_LINE_OPACITY_SCALE,
    );
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (
    let index = 0;
    index < PARALLEL_FAST_LINE_OPACITY_SCALE_STEPS.length;
    index += 1
  ) {
    const step = PARALLEL_FAST_LINE_OPACITY_SCALE_STEPS[index];
    if (step === undefined) {
      continue;
    }
    const distance = Math.abs(step - scale);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}
