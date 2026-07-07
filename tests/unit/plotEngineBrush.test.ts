import assert from 'node:assert/strict';

import {
  brushEventNameForPhase,
  normalizeBrushNumericRange,
  snapshotBrushModifiers,
} from '../../packages/m-charts/src/plot-engine/core/index.ts';

assert.equal(brushEventNameForPhase('start'), 'brushstart');
assert.equal(brushEventNameForPhase('preview'), 'brushpreview');
assert.equal(brushEventNameForPhase('commit'), 'brushcommit');
assert.equal(brushEventNameForPhase('cancel'), 'brushcancel');

assert.deepEqual(normalizeBrushNumericRange({ max: -4, min: 8 }), {
  max: 8,
  min: -4,
});
assert.deepEqual(normalizeBrushNumericRange({ max: 2, min: 2 }), {
  max: 2,
  min: 2,
});

const modifiers = {
  altKey: false,
  ctrlKey: true,
  metaKey: false,
  shiftKey: true,
};
const snapshot = snapshotBrushModifiers(modifiers);
modifiers.ctrlKey = false;

assert.deepEqual(snapshot, {
  altKey: false,
  ctrlKey: true,
  metaKey: false,
  shiftKey: true,
});

console.log('plot-engine brush primitive tests passed');
