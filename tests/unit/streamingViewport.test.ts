import assert from 'node:assert/strict';
import { createEmitter } from '../../packages/m-charts/src/plot-engine/core/emitter.ts';
import {
  bindStreamingViewportInteractions,
  createStreamingViewportController,
} from '../../packages/m-charts/src/plot-engine/core/streamingViewport.ts';

const viewport = createEmitter<{ viewportchange: { reason: string } }>();
const applied: Array<{ bounds: number; reason: string }> = [];
const tracking = createStreamingViewportController({
  bounds: 10,
  following: true,
  equal: (a, b) => a === b,
  apply(bounds, reason) {
    applied.push({ bounds, reason });
    viewport.emit('viewportchange', { reason });
  },
});
const events: string[] = [];
tracking.controller.on('boundschange', ({ bounds }) => events.push(`bounds:${bounds}`));
tracking.controller.on('followingchange', ({ following, reason }) => events.push(`${following}:${reason}`));
const unbind = bindStreamingViewportInteractions(tracking.pause, (listener) => viewport.on('viewportchange', listener));
tracking.updateBounds(20);
assert.deepEqual(applied, [{ bounds: 20, reason: 'stream' }]);
assert.equal(tracking.controller.getViewportFollowing(), true, 'Own stream events must not pause following');
tracking.updateBounds(20);
assert.deepEqual(events, ['bounds:20'], 'Unchanged bounds must not emit or refit');
viewport.emit('viewportchange', { reason: 'wheel' });
tracking.updateBounds(30);
assert.equal(applied.length, 1, 'Streaming must preserve an active zoom');
assert.equal(tracking.controller.getBounds(), 30, 'Bounds must advance even while paused');
tracking.controller.setViewportFollowing(true);
assert.deepEqual(applied.at(-1), { bounds: 30, reason: 'fit' }, 'Resume must fit latest bounds immediately');
tracking.updateBounds(40);
assert.deepEqual(applied.at(-1), { bounds: 40, reason: 'stream' });
tracking.controller.fitViewport();
assert.equal(tracking.controller.getViewportFollowing(), false, 'Fit once must leave following paused');
tracking.updateBounds(50);
assert.deepEqual(applied.at(-1), { bounds: 40, reason: 'fit' });
tracking.controller.setViewportFollowing(true);
viewport.emit('viewportchange', { reason: 'programmatic' });
assert.equal(tracking.controller.getViewportFollowing(), false);
unbind();
tracking.controller.setViewportFollowing(true);
viewport.emit('viewportchange', { reason: 'wheel' });
assert.equal(tracking.controller.getViewportFollowing(), true, 'Application can own the interaction policy');
const cancelFromBoundsEvent = tracking.controller.on('boundschange', () => tracking.controller.setViewportFollowing(false));
const beforeCancel = applied.length;
tracking.updateBounds(60);
assert.equal(applied.length, beforeCancel, 'Bounds subscribers can suppress automatic fitting');
cancelFromBoundsEvent();
tracking.dispose();
const beforeDispose = events.length;
tracking.updateBounds(70);
tracking.controller.setViewportFollowing(true);
tracking.controller.fitViewport();
assert.equal(events.length, beforeDispose);
assert.equal(applied.length, beforeCancel, 'Disposed controls must not change the plot');
console.log('Streaming viewport policy tests passed');

const disposedDuringEvent = createStreamingViewportController({
  bounds: 1, following: false, equal: (a, b) => a === b,
  apply: () => assert.fail('A followingchange listener disposed the controller'),
});
disposedDuringEvent.controller.on('followingchange', () => disposedDuringEvent.dispose());
disposedDuringEvent.controller.setViewportFollowing(true);
