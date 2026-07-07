export const FAST_SCATTER_POINT_SIZE_SCALE_PARAM = 'sizeScale';
export const FAST_SCATTER_DEFAULT_POINT_SIZE_SCALE = 1;
export const FAST_SCATTER_POINT_SIZE_SCALE_STEPS = [
  0.1,
  0.125,
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
  2,
  3,
  4,
  6,
  8,
  10,
] as const;

export function parsePointSizeScaleSearchParam(params: URLSearchParams): number {
  const rawValue = params.get(FAST_SCATTER_POINT_SIZE_SCALE_PARAM);

  if (rawValue === null || rawValue.trim() === '') {
    return FAST_SCATTER_DEFAULT_POINT_SIZE_SCALE;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return FAST_SCATTER_DEFAULT_POINT_SIZE_SCALE;
  }

  return snapPointSizeScaleToStep(parsed);
}

export function formatPointSizeScaleParam(scale: number): string {
  return String(snapPointSizeScaleToStep(scale));
}

export function getPreviousPointSizeScale(scale: number): number {
  const currentIndex = getPointSizeScaleStepIndex(scale);

  return FAST_SCATTER_POINT_SIZE_SCALE_STEPS[Math.max(0, currentIndex - 1)]!;
}

export function getNextPointSizeScale(scale: number): number {
  const currentIndex = getPointSizeScaleStepIndex(scale);

  return FAST_SCATTER_POINT_SIZE_SCALE_STEPS[
    Math.min(FAST_SCATTER_POINT_SIZE_SCALE_STEPS.length - 1, currentIndex + 1)
  ]!;
}

export function snapPointSizeScaleToStep(scale: number): number {
  return FAST_SCATTER_POINT_SIZE_SCALE_STEPS[getPointSizeScaleStepIndex(scale)];
}

function getPointSizeScaleStepIndex(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return FAST_SCATTER_POINT_SIZE_SCALE_STEPS.indexOf(
      FAST_SCATTER_DEFAULT_POINT_SIZE_SCALE,
    );
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < FAST_SCATTER_POINT_SIZE_SCALE_STEPS.length; index += 1) {
    const step = FAST_SCATTER_POINT_SIZE_SCALE_STEPS[index];
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
