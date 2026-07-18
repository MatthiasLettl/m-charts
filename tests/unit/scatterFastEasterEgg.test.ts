import assert from 'node:assert/strict';

import {
  createFastScatterEasterEggColorArray,
  createFastScatterEasterEggPlayback,
  createFastScatterEasterEggPointLayout,
  FAST_SCATTER_EASTER_EGG_RAINBOW_RGBA8,
  getFastScatterEasterEggTotalDurationMs,
  projectFastScatterEasterEggPosition,
  updateFastScatterEasterEggPositions,
} from '../../packages/m-charts/src/m-scatter/core/easterEgg.ts';

const layout = createFastScatterEasterEggPointLayout();
const colors = createFastScatterEasterEggColorArray(layout);
const firstPointByChar = new Map<number, number>();

for (let index = 0; index < layout.points.length; index += 1) {
  const point = layout.points[index]!;
  if (!firstPointByChar.has(point.charIndex)) {
    firstPointByChar.set(point.charIndex, index);
  }
}

assert.equal(layout.charCount, 6);
assert.equal(firstPointByChar.size, layout.charCount);

for (const [charIndex, pointIndex] of firstPointByChar) {
  assert.deepEqual(
    Array.from(colors.slice(pointIndex * 4, pointIndex * 4 + 4)),
    FAST_SCATTER_EASTER_EGG_RAINBOW_RGBA8[charIndex],
  );
}

const explicitColor = [10, 20, 30, 220] as const;
const explicitColors = createFastScatterEasterEggColorArray(layout, explicitColor);
for (let index = 0; index < layout.points.length; index += 1) {
  assert.deepEqual(
    Array.from(explicitColors.slice(index * 4, index * 4 + 4)),
    explicitColor,
  );
}

assert.deepEqual(
  projectFastScatterEasterEggPosition(
    0.25,
    0.75,
    { min: 250_000, max: 450_000 },
    { min: -10, max: 40 },
  ),
  { x: 300_000, y: 27.5 },
);

const playback = createFastScatterEasterEggPlayback({
  color: [-1, 20.4, 999, Number.NaN],
  enterDurationMs: 100,
  exitDurationMs: 100,
  holdDurationMs: 0,
  pointSizePx: 6,
  staggerMs: 0,
}, 50);
assert.deepEqual(playback.options.color, [0, 20, 255, 255]);
assert.equal(playback.options.pointSizePx, 6);
assert.equal(playback.startedAt, 50);
assert.equal(getFastScatterEasterEggTotalDurationMs(playback), 200);

const currentX = new Float32Array(playback.layout.points.length);
const currentY = new Float32Array(playback.layout.points.length);
updateFastScatterEasterEggPositions(playback, 100, currentX, currentY);
const firstPoint = playback.layout.points[0]!;
assert.ok(Math.abs(currentX[0]! - (0.14 + firstPoint.x * 0.78)) < 1e-6);
assert.ok(Math.abs(currentY[0]! - (0.2 + firstPoint.y * 0.6)) < 1e-6);
