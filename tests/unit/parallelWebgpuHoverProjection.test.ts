import assert from 'node:assert/strict';

import {
  PARALLEL_ABOVE_VIEWPORT_DISPLAY_VALUE,
  PARALLEL_ABOVE_VIEWPORT_ROUTE_NORMALIZED_Y,
  PARALLEL_AXIS_MAX_DISPLAY_VALUE,
  PARALLEL_AXIS_MIN_DISPLAY_VALUE,
  PARALLEL_BELOW_VIEWPORT_DISPLAY_VALUE,
  PARALLEL_BELOW_VIEWPORT_ROUTE_NORMALIZED_Y,
  createParallelWebgpuBuffers,
  PARALLEL_MISSING_AXIS_DISPLAY_VALUE,
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
  parallelRenderedNormalizedValueToDisplayValue,
} from '../../packages/m-charts/src/m-parallel/index.ts';
import {
  createParallelWebgpuInspectionResult,
  resolveParallelWebgpuHoverPairRange,
  resolveParallelWebgpuHoverSourceIndex,
  resolveParallelWebgpuInspectionGeometry,
} from '../../packages/m-charts/src/m-parallel-webgpu/core/inspection.ts';

assert.equal(resolveParallelWebgpuHoverSourceIndex(7), 7);
assert.equal(
  resolveParallelWebgpuHoverSourceIndex(1, new Uint32Array([11, 42, 73])),
  42,
);
assert.equal(
  resolveParallelWebgpuHoverSourceIndex(3, new Uint32Array([11, 42, 73])),
  null,
);

const missingBuffers = createParallelWebgpuBuffers({
  axes: [
    { key: 'start', kind: 'numeric' },
    { key: 'end', kind: 'numeric' },
  ],
  axisOrder: ['start', 'end'],
  ids: ['missing-record'],
  valuesByAxis: {
    end: new Float32Array([Number.NaN]),
    start: new Float32Array([Number.NaN]),
  },
});
const missingInspection = createParallelWebgpuInspectionResult(
  missingBuffers,
  0,
  0,
  0.5,
  0,
  {},
);
assert.deepEqual(missingBuffers.missingValueCountByAxis, { end: 1, start: 1 });
assert.equal(
  missingInspection.projectedNormalizedValue,
  PARALLEL_MISSING_AXIS_ROUTE_NORMALIZED_Y,
);
assert.equal(
  parallelRenderedNormalizedValueToDisplayValue(
    missingInspection.projectedNormalizedValue,
  ),
  PARALLEL_MISSING_AXIS_DISPLAY_VALUE,
);

const transitionBuffers = createParallelWebgpuBuffers({
  axes: [
    { key: 'start', kind: 'numeric' },
    { key: 'end', kind: 'numeric' },
  ],
  axisOrder: ['start', 'end'],
  ids: ['transition-record'],
  valuesByAxis: {
    end: new Float32Array([Number.NaN]),
    start: new Float32Array([42]),
  },
});
const transitionInspection = createParallelWebgpuInspectionResult(
  transitionBuffers,
  0,
  0,
  0.5,
  0,
  {},
);
assert.ok(
  Math.abs(
    parallelRenderedNormalizedValueToDisplayValue(
      transitionInspection.projectedNormalizedValue,
    ) -
      (PARALLEL_MISSING_AXIS_DISPLAY_VALUE +
        PARALLEL_AXIS_MIN_DISPLAY_VALUE +
        0.5 * (PARALLEL_AXIS_MAX_DISPLAY_VALUE - PARALLEL_AXIS_MIN_DISPLAY_VALUE)) /
        2,
  ) < 1e-12,
);

const overflowBuffers = createParallelWebgpuBuffers({
  axes: [
    { key: 'start', kind: 'numeric' },
    { key: 'end', kind: 'numeric' },
  ],
  axisOrder: ['start', 'end'],
  ids: ['below-record', 'above-record'],
  valuesByAxis: {
    end: new Float32Array([0, 10]),
    start: new Float32Array([0, 10]),
  },
});
const overflowViewports = {
  end: { max: 8, min: 2 },
  start: { max: 8, min: 2 },
};
assert.deepEqual(overflowBuffers.missingValueCountByAxis, { end: 0, start: 0 });
const belowInspection = createParallelWebgpuInspectionResult(
  overflowBuffers,
  0,
  0,
  0.5,
  0,
  overflowViewports,
);
assert.equal(
  belowInspection.projectedNormalizedValue,
  PARALLEL_BELOW_VIEWPORT_ROUTE_NORMALIZED_Y,
);
assert.equal(
  parallelRenderedNormalizedValueToDisplayValue(
    belowInspection.projectedNormalizedValue,
  ),
  PARALLEL_BELOW_VIEWPORT_DISPLAY_VALUE,
);

const aboveInspection = createParallelWebgpuInspectionResult(
  overflowBuffers,
  1,
  0,
  0.5,
  0,
  overflowViewports,
);
assert.equal(
  aboveInspection.projectedNormalizedValue,
  PARALLEL_ABOVE_VIEWPORT_ROUTE_NORMALIZED_Y,
);
assert.equal(
  parallelRenderedNormalizedValueToDisplayValue(
    aboveInspection.projectedNormalizedValue,
  ),
  PARALLEL_ABOVE_VIEWPORT_DISPLAY_VALUE,
);
assert.deepEqual(
  resolveParallelWebgpuHoverPairRange(4, 1, 28, 900),
  { count: 2, start: 0 },
  'hovering an axis searches the visible segments on both sides',
);
assert.deepEqual(
  resolveParallelWebgpuHoverPairRange(4, 1.2, 28, 900),
  { count: 1, start: 1 },
  'hovering away from an axis searches only its containing pair',
);
const aboveRailGeometry = resolveParallelWebgpuInspectionGeometry(
  overflowBuffers,
  1,
  {
    axisPosition: 0.5,
    normalizedValue: PARALLEL_ABOVE_VIEWPORT_ROUTE_NORMALIZED_Y,
    plotHeightPx: 600,
    plotWidthPx: 1_000,
  },
  overflowViewports,
  { count: 1, start: 0 },
);
assert.equal(aboveRailGeometry?.pair, 0);
assert.ok((aboveRailGeometry?.distancePx ?? Number.POSITIVE_INFINITY) < 1e-9);

const railTransitionInspection = createParallelWebgpuInspectionResult(
  overflowBuffers,
  1,
  0,
  0.4,
  0,
  {
    end: { max: 10, min: 0 },
    start: { max: 8, min: 2 },
  },
);
assert.ok(
  Math.abs(
    parallelRenderedNormalizedValueToDisplayValue(
      railTransitionInspection.projectedNormalizedValue,
    ) -
      (PARALLEL_ABOVE_VIEWPORT_DISPLAY_VALUE +
        (PARALLEL_AXIS_MAX_DISPLAY_VALUE -
          PARALLEL_ABOVE_VIEWPORT_DISPLAY_VALUE) *
          0.4),
  ) < 1e-12,
);

console.log('parallel WebGPU hover projection tests passed');
