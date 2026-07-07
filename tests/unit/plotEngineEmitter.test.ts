import assert from 'node:assert/strict';

import { createEmitter } from '../../packages/m-charts/src/plot-engine/core/index.ts';

interface TestEvents {
  change: { value: number };
  done: undefined;
}

const emitter = createEmitter<TestEvents>();
const seen: number[] = [];
const unsubscribe = emitter.on('change', (event) => {
  seen.push(event.value);
});

emitter.emit('change', { value: 1 });
unsubscribe();
unsubscribe.dispose();
emitter.emit('change', { value: 2 });
assert.deepEqual(seen, [1]);

const offHandlerValues: number[] = [];
const offHandler = (event: { value: number }) => offHandlerValues.push(event.value);
emitter.on('change', offHandler);
emitter.off('change', offHandler);
emitter.emit('change', { value: 3 });
assert.deepEqual(offHandlerValues, []);

let onceCount = 0;
emitter.once('done', () => {
  onceCount += 1;
});
emitter.emit('done', undefined);
emitter.emit('done', undefined);
assert.equal(onceCount, 1);

console.log('plot-engine emitter tests passed');

