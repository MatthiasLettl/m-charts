export type FastScatterAlphaMode = 'normal-alpha' | 'adaptive-alpha' | 'performance';
export const FAST_SCATTER_RENDERING_MODES = ['points'] as const;

export type FastScatterRenderingMode = (typeof FAST_SCATTER_RENDERING_MODES)[number];
export type FastScatterEffectiveRenderingMode = 'points';
export type FastScatterPointRenderingPolicy = 'point-rendering';

export interface FastScatterAlphaPolicyInput {
  pointCount: number;
  plotAreaPx: number;
  requestedRenderingMode?: FastScatterRenderingMode;
}

export interface FastScatterAlphaPolicy {
  alphaScale: number;
  blendMode: 'src-alpha-one-minus-src-alpha' | 'one-zero';
  densityPointsPerPixel: number;
  effectiveRenderingMode: FastScatterEffectiveRenderingMode;
  mode: FastScatterAlphaMode;
  pointSizeScale: number;
  renderingPolicy: FastScatterPointRenderingPolicy;
  requestedRenderingMode: FastScatterRenderingMode;
}

const NORMAL_DENSITY_MAX = 0.6;
const PERFORMANCE_DENSITY_MIN = 18;
const TARGET_ALPHA_COVERAGE = 1.7;
const MIN_ADAPTIVE_ALPHA_SCALE = 0.06;
const PERFORMANCE_ALPHA_SCALE = 0.035;

export function resolveFastScatterAlphaPolicy({
  pointCount,
  plotAreaPx,
  requestedRenderingMode = 'points',
}: FastScatterAlphaPolicyInput): FastScatterAlphaPolicy {
  const safePointCount = Math.max(0, pointCount);
  const safePlotAreaPx = Math.max(1, plotAreaPx);
  const densityPointsPerPixel = safePointCount / safePlotAreaPx;
  const modePolicy = resolveFastScatterRenderingPolicy(requestedRenderingMode);

  if (densityPointsPerPixel <= NORMAL_DENSITY_MAX) {
    return {
      alphaScale: 1,
      blendMode: 'src-alpha-one-minus-src-alpha',
      densityPointsPerPixel,
      ...modePolicy,
      mode: 'normal-alpha',
      pointSizeScale: 1,
    };
  }

  if (densityPointsPerPixel >= PERFORMANCE_DENSITY_MIN) {
    return {
      alphaScale: PERFORMANCE_ALPHA_SCALE,
      blendMode: 'src-alpha-one-minus-src-alpha',
      densityPointsPerPixel,
      ...modePolicy,
      mode: 'performance',
      pointSizeScale: 0.75,
    };
  }

  return {
    alphaScale: clamp(
      TARGET_ALPHA_COVERAGE / densityPointsPerPixel,
      MIN_ADAPTIVE_ALPHA_SCALE,
      1,
    ),
    blendMode: 'src-alpha-one-minus-src-alpha',
    densityPointsPerPixel,
    ...modePolicy,
    mode: 'adaptive-alpha',
    pointSizeScale: 1,
  };
}

function resolveFastScatterRenderingPolicy(
  requestedRenderingMode: FastScatterRenderingMode,
): Pick<
  FastScatterAlphaPolicy,
  'effectiveRenderingMode' | 'renderingPolicy' | 'requestedRenderingMode'
> {
  return {
    effectiveRenderingMode: 'points',
    renderingPolicy: 'point-rendering',
    requestedRenderingMode,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
