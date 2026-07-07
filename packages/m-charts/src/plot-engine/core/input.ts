import { addEventListenerDisposable, DisposableStack, type Disposable } from './disposable.js';
import { createEmitter, type TypedEmitter, type Unsubscribe } from './emitter.js';
import type {
  InputModifiers,
  NormalizedContextMenuEvent,
  NormalizedFocusEvent,
  NormalizedKeyEvent,
  NormalizedPointerEvent,
  NormalizedWheelEvent,
  PlotInputEvents,
} from './events.js';
import type { Point } from './geometry.js';

export interface DomInputAdapter extends Disposable {
  on<K extends keyof PlotInputEvents & string>(
    type: K,
    handler: (event: PlotInputEvents[K]) => void,
  ): Unsubscribe;
}

export interface DomInputAdapterOptions {
  coordinateTarget?: HTMLElement;
  suppressContextMenu?: boolean;
}

type PointerLikeEvent = PointerEvent | MouseEvent;

export function getInputModifiers(event: Pick<InputModifiers, keyof InputModifiers>): InputModifiers {
  return {
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  };
}

export function getHostPoint(host: HTMLElement, clientX: number, clientY: number): Point {
  const rect = host.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

export function normalizePointerEvent(
  host: HTMLElement,
  event: PointerLikeEvent,
  type: NormalizedPointerEvent['type'],
): NormalizedPointerEvent {
  const client = { x: event.clientX, y: event.clientY };
  return {
    button: event.button,
    buttons: event.buttons,
    client,
    defaultPrevented: event.defaultPrevented,
    host: getHostPoint(host, event.clientX, event.clientY),
    modifiers: getInputModifiers(event),
    originalEvent: event,
    pointerId: 'pointerId' in event ? event.pointerId : 0,
    pointerType: 'pointerType' in event ? event.pointerType : 'mouse',
    timeStamp: event.timeStamp,
    type,
  };
}

export function normalizeWheelEvent(host: HTMLElement, event: WheelEvent): NormalizedWheelEvent {
  const client = { x: event.clientX, y: event.clientY };
  return {
    client,
    defaultPrevented: event.defaultPrevented,
    deltaMode: event.deltaMode,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaZ: event.deltaZ,
    host: getHostPoint(host, event.clientX, event.clientY),
    modifiers: getInputModifiers(event),
    originalEvent: event,
    timeStamp: event.timeStamp,
    type: 'wheel',
  };
}

export function normalizeKeyEvent(event: KeyboardEvent): NormalizedKeyEvent {
  return {
    code: event.code,
    defaultPrevented: event.defaultPrevented,
    key: event.key,
    modifiers: getInputModifiers(event),
    originalEvent: event,
    repeat: event.repeat,
    timeStamp: event.timeStamp,
    type: event.type === 'keyup' ? 'keyup' : 'keydown',
  };
}

export function normalizeFocusEvent(event: FocusEvent): NormalizedFocusEvent {
  return {
    defaultPrevented: event.defaultPrevented,
    modifiers: {
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    },
    originalEvent: event,
    relatedTarget: event.relatedTarget,
    timeStamp: event.timeStamp,
    type: event.type === 'blur' ? 'blur' : 'focus',
  };
}

export function normalizeContextMenuEvent(
  host: HTMLElement,
  event: MouseEvent,
): NormalizedContextMenuEvent {
  const client = { x: event.clientX, y: event.clientY };
  return {
    client,
    defaultPrevented: event.defaultPrevented,
    host: getHostPoint(host, event.clientX, event.clientY),
    modifiers: getInputModifiers(event),
    originalEvent: event,
    timeStamp: event.timeStamp,
    type: 'contextmenu',
  };
}

export function createDomInputAdapter(
  host: HTMLElement,
  options: DomInputAdapterOptions = {},
): DomInputAdapter {
  const suppressContextMenu = options.suppressContextMenu ?? true;
  const coordinateTarget = options.coordinateTarget ?? host;
  const emitter: TypedEmitter<PlotInputEvents> = createEmitter();
  const disposables = new DisposableStack();

  disposables.add(
    addEventListenerDisposable(host, 'pointerdown', (event) => {
      emitter.emit('pointer', normalizePointerEvent(coordinateTarget, event, 'pointerdown'));
    }),
  );
  disposables.add(
    addEventListenerDisposable(host, 'pointermove', (event) => {
      emitter.emit('pointer', normalizePointerEvent(coordinateTarget, event, 'pointermove'));
    }),
  );
  disposables.add(
    addEventListenerDisposable(host, 'pointerup', (event) => {
      emitter.emit('pointer', normalizePointerEvent(coordinateTarget, event, 'pointerup'));
    }),
  );
  disposables.add(
    addEventListenerDisposable(host, 'pointercancel', (event) => {
      emitter.emit('pointer', normalizePointerEvent(coordinateTarget, event, 'pointercancel'));
    }),
  );
  disposables.add(
    addEventListenerDisposable(host, 'wheel', (event) => {
      emitter.emit('wheel', normalizeWheelEvent(coordinateTarget, event));
    }),
  );
  disposables.add(
    addEventListenerDisposable(host, 'keydown', (event) => {
      emitter.emit('key', normalizeKeyEvent(event));
    }),
  );
  disposables.add(
    addEventListenerDisposable(host, 'keyup', (event) => {
      emitter.emit('key', normalizeKeyEvent(event));
    }),
  );
  disposables.add(
    addEventListenerDisposable(host, 'focus', (event) => {
      emitter.emit('focus', normalizeFocusEvent(event));
    }),
  );
  disposables.add(
    addEventListenerDisposable(host, 'blur', (event) => {
      emitter.emit('blur', normalizeFocusEvent(event));
    }),
  );
  disposables.add(
    addEventListenerDisposable(host, 'contextmenu', (event) => {
      if (suppressContextMenu) {
        event.preventDefault();
      }
      emitter.emit('contextmenu', normalizeContextMenuEvent(coordinateTarget, event));
    }),
  );

  return {
    dispose() {
      disposables.dispose();
      emitter.clear();
    },
    on(type, handler) {
      return emitter.on(type, handler);
    },
  };
}
