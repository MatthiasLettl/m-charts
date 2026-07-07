import type { Disposable } from './disposable.js';

export type EventMap = object;
export type EventHandler<TPayload> = (payload: TPayload) => void;
export type Unsubscribe = (() => void) & Disposable;

export interface TypedEmitter<TEvents extends EventMap> {
  on<K extends keyof TEvents & string>(type: K, handler: EventHandler<TEvents[K]>): Unsubscribe;
  once<K extends keyof TEvents & string>(type: K, handler: EventHandler<TEvents[K]>): Unsubscribe;
  off<K extends keyof TEvents & string>(type: K, handler: EventHandler<TEvents[K]>): void;
  emit<K extends keyof TEvents & string>(type: K, payload: TEvents[K]): void;
  clear(): void;
}

export function createEmitter<TEvents extends EventMap>(): TypedEmitter<TEvents> {
  const listeners = new Map<keyof TEvents & string, Set<EventHandler<TEvents[keyof TEvents]>>>();

  function off<K extends keyof TEvents & string>(type: K, handler: EventHandler<TEvents[K]>): void {
    const handlers = listeners.get(type);
    if (!handlers) {
      return;
    }
    handlers.delete(handler as EventHandler<TEvents[keyof TEvents]>);
    if (handlers.size === 0) {
      listeners.delete(type);
    }
  }

  function on<K extends keyof TEvents & string>(
    type: K,
    handler: EventHandler<TEvents[K]>,
  ): Unsubscribe {
    let handlers = listeners.get(type);
    if (!handlers) {
      handlers = new Set();
      listeners.set(type, handlers);
    }
    handlers.add(handler as EventHandler<TEvents[keyof TEvents]>);

    let unsubscribed = false;
    const unsubscribe = (() => {
      if (unsubscribed) {
        return;
      }
      unsubscribed = true;
      off(type, handler);
    }) as Unsubscribe;
    unsubscribe.dispose = unsubscribe;
    return unsubscribe;
  }

  function once<K extends keyof TEvents & string>(
    type: K,
    handler: EventHandler<TEvents[K]>,
  ): Unsubscribe {
    const unsubscribe = on(type, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  function emit<K extends keyof TEvents & string>(type: K, payload: TEvents[K]): void {
    const handlers = listeners.get(type);
    if (!handlers) {
      return;
    }
    for (const handler of [...handlers]) {
      handler(payload as TEvents[keyof TEvents]);
    }
  }

  return {
    clear() {
      listeners.clear();
    },
    emit,
    off,
    on,
    once,
  };
}
