import assert from 'node:assert/strict';

import { createLatestRafScheduler, type RafRequest } from '../../packages/m-charts/src/plot-engine/core/index.ts';

const callbacks: FrameRequestCallback[] = [];
const canceled = new Set<number>();
let nextHandle = 1;
const requestFrame: RafRequest = (callback) => {
  callbacks.push(callback);
  return nextHandle++;
};
const cancelFrame = (handle: number) => {
  canceled.add(handle);
};

const seen: Array<{ timestamp: number; value: string }> = [];
const scheduler = createLatestRafScheduler<string>(
  (value, timestamp) => {
    seen.push({ timestamp, value });
  },
  { cancelFrame, requestFrame },
);

scheduler.schedule('first');
scheduler.schedule('latest');
assert.equal(callbacks.length, 1);
assert.equal(scheduler.pending, true);
callbacks.shift()?.(12);
assert.deepEqual(seen, [{ timestamp: 12, value: 'latest' }]);
assert.equal(scheduler.pending, false);

scheduler.schedule('cancel-me');
assert.equal(callbacks.length, 1);
scheduler.cancel();
assert.deepEqual([...canceled], [2]);
callbacks.shift()?.(24);
assert.deepEqual(seen, [{ timestamp: 12, value: 'latest' }]);

scheduler.schedule('dispose-me');
scheduler.dispose();
assert.deepEqual([...canceled], [2, 3]);

console.log('plot-engine scheduler tests passed');

