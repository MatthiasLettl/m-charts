import assert from 'node:assert/strict';
import { createParallelInspectionScheduler } from '../../packages/m-charts/src/m-parallel/engine/inspectionScheduler.ts';

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const started: number[] = [];
const applied: number[] = [];
const errors: unknown[] = [];
const completions: { resolve: () => void; reject: (error: unknown) => void }[] = [];
const scheduler = createParallelInspectionScheduler<number>((value, isCurrent) => {
  started.push(value);
  return new Promise<void>((resolve, reject) => completions.push({ resolve, reject }))
    .then(() => { if (isCurrent()) applied.push(value); });
}, (error) => errors.push(error), {
  requestFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
  cancelFrame: (frame) => { frames.delete(frame); },
});
const frame = () => {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
};
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

scheduler.schedule(1);
scheduler.schedule(2);
frame();
assert.deepEqual(started, [2], 'pointer events coalesce before the animation frame');
for (let value = 3; value <= 100; value += 1) { scheduler.schedule(value); frame(); }
assert.deepEqual(started, [2], 'slow GPU readbacks never overlap');
completions.shift()!.resolve();
await settle();
assert.deepEqual(applied, [2], 'continuous movement must not starve completed results');
frame();
assert.deepEqual(started, [2, 100], 'only the most recent queued pointer runs');

scheduler.cancel();
scheduler.schedule(101);
frame();
assert.deepEqual(started, [2, 100], 'cancellation does not free an occupied GPU slot');
completions.shift()!.resolve();
await settle();
assert.deepEqual(applied, [2], 'cancelled hover cannot reappear after pointer leave or zoom');
frame();
assert.deepEqual(started, [2, 100, 101]);
completions.shift()!.reject(new Error('GPU lost'));
await settle();
assert.equal(errors.length, 1);
scheduler.schedule(102);
frame();
assert.equal(started.at(-1), 102, 'failed lookups release the slot');
scheduler.schedule(103);
scheduler.dispose();
completions.shift()!.resolve();
await settle();
frame();
scheduler.schedule(104);
frame();
assert.equal(started.at(-1), 102, 'disposal suppresses queued and future work');
assert.deepEqual(applied, [2]);
console.log('parallel inspection scheduler tests passed');
