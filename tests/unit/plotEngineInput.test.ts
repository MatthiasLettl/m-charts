import assert from 'node:assert/strict';

import {
  createDomInputAdapter,
  normalizePointerEvent,
  normalizeWheelEvent,
} from '../../packages/m-charts/src/plot-engine/core/index.ts';

type Listener = (event: Event) => void;

class FakeHost {
  readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  getBoundingClientRect(): DOMRect {
    return {
      bottom: 240,
      height: 200,
      left: 10,
      right: 310,
      top: 40,
      width: 300,
      x: 10,
      y: 40,
      toJSON: () => ({}),
    } as DOMRect;
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
}

function makeEvent<T extends object>(type: string, values: T): Event & T {
  const event = new Event(type, { cancelable: true }) as Event & T;
  return Object.assign(event, values);
}

const host = new FakeHost() as unknown as HTMLElement;
const pointer = normalizePointerEvent(
  host,
  makeEvent('pointermove', {
    altKey: false,
    button: -1,
    buttons: 1,
    clientX: 35,
    clientY: 70,
    ctrlKey: true,
    metaKey: false,
    pointerId: 7,
    pointerType: 'pen',
    shiftKey: false,
  }),
  'pointermove',
);
assert.deepEqual(pointer.host, { x: 25, y: 30 });
assert.equal(pointer.pointerId, 7);
assert.equal(pointer.pointerType, 'pen');
assert.equal(pointer.modifiers.ctrlKey, true);

const wheel = normalizeWheelEvent(
  host,
  makeEvent('wheel', {
    altKey: false,
    clientX: 20,
    clientY: 50,
    ctrlKey: false,
    deltaMode: 0,
    deltaX: 1,
    deltaY: -120,
    deltaZ: 0,
    metaKey: false,
    shiftKey: true,
  }),
);
assert.deepEqual(wheel.host, { x: 10, y: 10 });
assert.equal(wheel.deltaY, -120);
assert.equal(wheel.modifiers.shiftKey, true);

const adapterHost = new FakeHost();
const adapter = createDomInputAdapter(adapterHost as unknown as HTMLElement);
const seen: string[] = [];
adapter.on('pointer', (event) => seen.push(`${event.type}:${event.host.x}`));
adapter.on('contextmenu', (event) => seen.push(`${event.type}:${event.defaultPrevented}`));
adapterHost.dispatch(
  'pointerdown',
  makeEvent('pointerdown', {
    altKey: false,
    button: 0,
    buttons: 1,
    clientX: 15,
    clientY: 45,
    ctrlKey: false,
    metaKey: false,
    pointerId: 1,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
adapterHost.dispatch(
  'contextmenu',
  makeEvent('contextmenu', {
    altKey: false,
    clientX: 15,
    clientY: 45,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  }),
);
adapter.dispose();
adapterHost.dispatch(
  'pointerdown',
  makeEvent('pointerdown', {
    altKey: false,
    button: 0,
    buttons: 1,
    clientX: 20,
    clientY: 45,
    ctrlKey: false,
    metaKey: false,
    pointerId: 1,
    pointerType: 'mouse',
    shiftKey: false,
  }),
);
assert.deepEqual(seen, ['pointerdown:5', 'contextmenu:true']);

console.log('plot-engine input tests passed');
