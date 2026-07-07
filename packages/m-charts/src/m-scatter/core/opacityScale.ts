export const FAST_SCATTER_OPACITY_SCALE_PARAM = 'opacityScale';
export const FAST_SCATTER_DEFAULT_OPACITY_SCALE = 1;
export const FAST_SCATTER_OPACITY_SCALE_STEPS = [
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
export const FAST_SCATTER_MAX_OPACITY_SCALE =
  FAST_SCATTER_OPACITY_SCALE_STEPS[FAST_SCATTER_OPACITY_SCALE_STEPS.length - 1]!;

export function parseOpacityScaleSearchParam(params: URLSearchParams): number {
  const rawValue = params.get(FAST_SCATTER_OPACITY_SCALE_PARAM);

  if (rawValue === null || rawValue.trim() === '') {
    return FAST_SCATTER_DEFAULT_OPACITY_SCALE;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return FAST_SCATTER_DEFAULT_OPACITY_SCALE;
  }

  return snapOpacityScaleToStep(parsed);
}

export function formatOpacityScaleParam(scale: number): string {
  return String(snapOpacityScaleToStep(scale));
}

export function getPreviousOpacityScale(scale: number): number {
  const currentIndex = getOpacityScaleStepIndex(scale);

  return FAST_SCATTER_OPACITY_SCALE_STEPS[Math.max(0, currentIndex - 1)]!;
}

export function getNextOpacityScale(scale: number): number {
  const currentIndex = getOpacityScaleStepIndex(scale);

  return FAST_SCATTER_OPACITY_SCALE_STEPS[
    Math.min(FAST_SCATTER_OPACITY_SCALE_STEPS.length - 1, currentIndex + 1)
  ]!;
}

export function snapOpacityScaleToStep(scale: number): number {
  return FAST_SCATTER_OPACITY_SCALE_STEPS[getOpacityScaleStepIndex(scale)];
}

function getOpacityScaleStepIndex(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return FAST_SCATTER_OPACITY_SCALE_STEPS.indexOf(
      FAST_SCATTER_DEFAULT_OPACITY_SCALE,
    );
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < FAST_SCATTER_OPACITY_SCALE_STEPS.length; index += 1) {
    const step = FAST_SCATTER_OPACITY_SCALE_STEPS[index];
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
