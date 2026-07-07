import assert from 'node:assert/strict';

import {
  STYLE_MODE_OPTIONS,
  getStyleModeDescription,
} from '../../apps/demo/src/state/styleModes.ts';
import {
  areViewportsEqual,
  createViewportStateKey,
  isPlotInteractionGateActive,
  normalizeInteractionShortcutKey,
  parsePrototypeSearchParams,
  serializePrototypeSearchParams,
  summarizeViewportChange,
  type ViewportState,
} from '../../apps/demo/src/state/viewSearchParams.ts';

const defaultViewport: ViewportState = {
  x: { min: 0, max: 100 },
  a: { min: -10, max: 10 },
  b: { min: -20, max: 20 },
  c: { min: -30, max: 30 },
};

const validViewport: ViewportState = {
  x: { min: 1.25, max: 98.5 },
  a: { min: -9, max: 8 },
  b: { min: -15, max: 14 },
  c: { min: -25, max: 23 },
};

const serialized = serializePrototypeSearchParams({
  axis: 'x',
  mode: 'select',
  viewport: validViewport,
});

assert.deepEqual(parsePrototypeSearchParams(serialized, defaultViewport), {
  axis: 'x',
  mode: 'select',
  viewport: validViewport,
});

assert.equal(serialized.get('axis'), 'x');

assert.equal(
  parsePrototypeSearchParams(new URLSearchParams('mode=invalid'), defaultViewport).mode,
  'pan',
);

assert.equal(
  parsePrototypeSearchParams(new URLSearchParams('axis=invalid'), defaultViewport).axis,
  'xy',
);

for (const axis of ['x', 'y', 'xy'] as const) {
  const params = serializePrototypeSearchParams({
    axis,
    mode: 'pan',
    viewport: validViewport,
  });

  assert.equal(params.get('axis'), axis);
  assert.equal(parsePrototypeSearchParams(params, defaultViewport).axis, axis);
}

assert.deepEqual(
  parsePrototypeSearchParams(
    new URLSearchParams(
      'mode=pan&xMin=1&xMax=2&aMin=3&aMax=4&bMin=5&bMax=6&cMin=7',
    ),
    defaultViewport,
  ),
  {
    axis: 'xy',
    mode: 'pan',
    viewport: defaultViewport,
  },
);

assert.deepEqual(
  parsePrototypeSearchParams(
    new URLSearchParams(
      'mode=hover&xMin=9&xMax=2&aMin=3&aMax=4&bMin=5&bMax=6&cMin=7&cMax=8',
    ),
    defaultViewport,
  ),
  {
    axis: 'xy',
    mode: 'hover',
    viewport: defaultViewport,
  },
);

assert.equal(
  parsePrototypeSearchParams(new URLSearchParams('mode=measure'), defaultViewport).mode,
  'measure',
);

assert.equal(
  parsePrototypeSearchParams(new URLSearchParams('mode=lasso'), defaultViewport).mode,
  'lasso',
);

assert.deepEqual(
  serializePrototypeSearchParams(
    {
      axis: 'xy',
      mode: 'zoom',
      viewport: defaultViewport,
    },
    new URLSearchParams('keep=true'),
  ).get('keep'),
  'true',
);
assert.equal(
  serializePrototypeSearchParams(
    {
      axis: 'xy',
      mode: 'pan',
      viewport: defaultViewport,
    },
    new URLSearchParams('viz=heatmap&heatBinPx=16'),
  ).get('viz'),
  'heatmap',
);
assert.equal(
  serializePrototypeSearchParams(
    {
      axis: 'xy',
      mode: 'pan',
      viewport: defaultViewport,
    },
    new URLSearchParams('viz=heatmap&heatBinPx=16'),
  ).get('heatBinPx'),
  '16',
);

assert.equal(areViewportsEqual(defaultViewport, { ...defaultViewport }), true);
assert.equal(
  isPlotInteractionGateActive({ hasFocusWithin: false, isHovered: false }),
  false,
);
assert.equal(
  isPlotInteractionGateActive({ hasFocusWithin: true, isHovered: false }),
  true,
);
assert.equal(
  isPlotInteractionGateActive({ hasFocusWithin: false, isHovered: true }),
  true,
);
assert.equal(normalizeInteractionShortcutKey('B'), 'b');
assert.equal(normalizeInteractionShortcutKey('PageDown'), 'pagedown');
assert.equal(normalizeInteractionShortcutKey('ArrowLeft'), 'arrowleft');
assert.equal(normalizeInteractionShortcutKey('Period'), 'period');
assert.equal(
  createViewportStateKey(defaultViewport),
  'x:0:100|a:-10:10|b:-20:20|c:-30:30',
);

assert.deepEqual(
  summarizeViewportChange(defaultViewport, {
    ...defaultViewport,
    x: { min: 10, max: 110 },
  }),
  {
    axes: ['x'],
    kind: 'x-only',
    movement: 'pan/move',
  },
);

assert.deepEqual(
  summarizeViewportChange(defaultViewport, {
    ...defaultViewport,
    a: { min: -5, max: 5 },
  }),
  {
    axes: ['a'],
    kind: 'y-only',
    movement: 'zoom/resize',
  },
);

assert.deepEqual(
  summarizeViewportChange(defaultViewport, {
    ...defaultViewport,
    x: { min: 10, max: 90 },
    b: { min: -10, max: 30 },
  }),
  {
    axes: ['x', 'b'],
    kind: 'combined',
    movement: 'mixed',
  },
);

assert.deepEqual(
  STYLE_MODE_OPTIONS.map((option) => option.mode),
  ['dataset', 'uniform', 'shape-limitation'],
);
assert.equal(getStyleModeDescription('shape-limitation').status, 'observed');

console.log('viewSearchParams tests passed');
