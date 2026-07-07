import assert from 'node:assert/strict';

import {
  DisposableStack,
  createResizeLifecycle,
  createWebGlContextLifecycle,
} from '../../packages/m-charts/src/plot-engine/core/index.ts';

type Listener = (event: Event) => void;

class FakeTarget {
  readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  dispatch(type: string, event = new Event(type, { cancelable: true })): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  getBoundingClientRect(): DOMRect {
    return {
      bottom: 50,
      height: 50,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
}

const stackOrder: number[] = [];
const stack = new DisposableStack();
stack.defer(() => stackOrder.push(1));
stack.defer(() => stackOrder.push(2));
stack.dispose();
stack.dispose();
stack.add(() => stackOrder.push(3));
assert.deepEqual(stackOrder, [2, 1, 3]);

const host = new FakeTarget();
const resizes: Array<{ height: number; pixelWidth: number }> = [];
const resizeLifecycle = createResizeLifecycle(
  host as unknown as HTMLElement,
  (event) => {
    resizes.push({ height: event.cssSize.height, pixelWidth: event.pixelSize.width });
  },
  { getDevicePixelRatio: () => 2 },
);
assert.deepEqual(resizes, [{ height: 50, pixelWidth: 200 }]);
assert.deepEqual(resizeLifecycle.measure().pixelSize, { height: 100, width: 200 });
resizeLifecycle.dispose();

const canvas = new FakeTarget();
let lost = 0;
let restored = 0;
const webglLifecycle = createWebGlContextLifecycle(canvas as unknown as HTMLCanvasElement, {
  onLost: () => {
    lost += 1;
  },
  onRestored: () => {
    restored += 1;
  },
});
const lostEvent = new Event('webglcontextlost', { cancelable: true });
canvas.dispatch('webglcontextlost', lostEvent);
canvas.dispatch('webglcontextrestored');
assert.equal(lost, 1);
assert.equal(lostEvent.defaultPrevented, true);
assert.equal(restored, 1);
webglLifecycle.dispose();
canvas.dispatch('webglcontextlost');
assert.equal(lost, 1);

console.log('plot-engine lifecycle tests passed');
