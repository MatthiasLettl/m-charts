import assert from 'node:assert/strict';

import {
  createFastScatterEasterEggColorArray,
  createFastScatterEasterEggPointLayout,
  FAST_SCATTER_EASTER_EGG_RAINBOW_RGBA8,
  projectFastScatterEasterEggPosition,
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
