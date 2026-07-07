import assert from 'node:assert/strict';

import {
  DEFAULT_THEME_MODE,
  createThemeAwareTo,
  parseThemeMode,
  writeThemeMode,
} from '../../apps/demo/src/state/themeMode.ts';
import {
  getCommittedSelectionOverlayColor,
  getFastScatterTheme,
  getParallelFastTheme,
} from '../../apps/demo/src/theme/plotTheme.ts';

assert.equal(parseThemeMode(new URLSearchParams()), DEFAULT_THEME_MODE);
assert.equal(parseThemeMode(new URLSearchParams('theme=invalid')), 'light');
assert.equal(parseThemeMode(new URLSearchParams('theme=dark')), 'dark');
assert.equal(writeThemeMode(new URLSearchParams('mode=hover'), 'dark').toString(), 'mode=hover&theme=dark');
assert.equal(writeThemeMode(new URLSearchParams('mode=hover&theme=dark'), 'light').toString(), 'mode=hover');
assert.equal(
  createThemeAwareTo('/m-scatter', 'mode=hover&axis=x', 'dark'),
  '/m-scatter?mode=hover&axis=x&theme=dark',
);
assert.equal(
  createThemeAwareTo('/m-scatter', 'mode=hover&axis=x&xMode=index&tables=multi', 'dark'),
  '/m-scatter?mode=hover&axis=x&theme=dark',
);
assert.equal(
  createThemeAwareTo(
    '/m-parallel',
    'mode=hover&axis=x&tables=multi',
    'dark',
    { preserveKeys: ['tables'] },
  ),
  '/m-parallel?tables=multi&theme=dark',
);
assert.equal(createThemeAwareTo('/', 'mode=hover&axis=x&theme=dark', 'dark'), '/?theme=dark');

for (const themeMode of ['light', 'dark'] as const) {
  const scatterSelectedOverlayColor = getFastScatterTheme(themeMode).selectedOverlayColor;
  assert.deepEqual(getCommittedSelectionOverlayColor(themeMode), scatterSelectedOverlayColor);
  assert.deepEqual(getParallelFastTheme(themeMode).selectedColor, scatterSelectedOverlayColor);
}

assert.deepEqual(getFastScatterTheme('light').bubbleColor, [0, 0, 0, 220]);
assert.deepEqual(getFastScatterTheme('dark').bubbleColor, [255, 255, 255, 220]);
assert.notDeepEqual(
  getFastScatterTheme('light').bubbleColor,
  getFastScatterTheme('dark').bubbleColor,
);

console.log('theme mode tests passed');
