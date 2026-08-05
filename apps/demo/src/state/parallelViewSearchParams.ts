import type {
  ParallelAxisDomains,
  ParallelAxisViewports,
  ParallelParameter,
} from 'm-charts/m-parallel';

export const PARALLEL_AXIS_VIEWPORT_PARAM_PREFIX = 'pf.';

export function parseParallelAxisViewportsSearchParams(
  params: URLSearchParams,
  axisOrder: readonly ParallelParameter[],
  domainsByAxis: ParallelAxisDomains,
): ParallelAxisViewports {
  const viewports: ParallelAxisViewports = {};

  for (const axis of axisOrder) {
    const domain = domainsByAxis[axis];
    if (domain === undefined) continue;
    const min = parseFiniteParam(params.get(getViewportParamName(axis, 'min')));
    const max = parseFiniteParam(params.get(getViewportParamName(axis, 'max')));
    if (min === null || max === null || min >= max) continue;

    const clampedMin = Math.max(domain.min, min);
    const clampedMax = Math.min(domain.max, max);
    if (clampedMin >= clampedMax) continue;
    if (clampedMin === domain.min && clampedMax === domain.max) continue;
    viewports[axis] = { max: clampedMax, min: clampedMin };
  }

  return viewports;
}

export function serializeParallelAxisViewportsSearchParams(
  viewports: ParallelAxisViewports,
  axisOrder: readonly ParallelParameter[],
  baseParams = new URLSearchParams(),
): URLSearchParams {
  const params = new URLSearchParams(baseParams);

  for (const key of [...params.keys()]) {
    if (key.startsWith(PARALLEL_AXIS_VIEWPORT_PARAM_PREFIX)) {
      params.delete(key);
    }
  }

  for (const axis of axisOrder) {
    const range = viewports[axis];
    if (
      range === null ||
      range === undefined ||
      !Number.isFinite(range.min) ||
      !Number.isFinite(range.max) ||
      range.min >= range.max
    ) {
      continue;
    }
    params.set(getViewportParamName(axis, 'min'), String(range.min));
    params.set(getViewportParamName(axis, 'max'), String(range.max));
  }

  return params;
}

function getViewportParamName(
  axis: ParallelParameter,
  edge: 'max' | 'min',
): string {
  return `${PARALLEL_AXIS_VIEWPORT_PARAM_PREFIX}${encodeURIComponent(axis)}.${edge}`;
}

function parseFiniteParam(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
