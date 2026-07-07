export interface Disposable {
  dispose(): void;
}

export type DisposeFn = () => void;

export function toDisposable(dispose: DisposeFn): Disposable {
  let disposed = false;
  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      dispose();
    },
  };
}

export function disposeAll(disposables: Iterable<Disposable | DisposeFn | null | undefined>): void {
  const errors: unknown[] = [];
  for (const disposable of disposables) {
    if (!disposable) {
      continue;
    }
    try {
      if (typeof disposable === 'function') {
        disposable();
      } else {
        disposable.dispose();
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Failed to dispose one or more resources');
  }
}

export class DisposableStack implements Disposable {
  #disposed = false;
  #items: Array<Disposable | DisposeFn> = [];

  get disposed(): boolean {
    return this.#disposed;
  }

  add<T extends Disposable | DisposeFn | null | undefined>(disposable: T): T {
    if (!disposable) {
      return disposable;
    }
    if (this.#disposed) {
      if (typeof disposable === 'function') {
        disposable();
      } else {
        disposable.dispose();
      }
      return disposable;
    }
    this.#items.push(disposable);
    return disposable;
  }

  defer(dispose: DisposeFn): Disposable {
    const disposable = toDisposable(dispose);
    this.add(disposable);
    return disposable;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const items = this.#items.splice(0).reverse();
    disposeAll(items);
  }
}

export function createDisposableStack(): DisposableStack {
  return new DisposableStack();
}

export function addEventListenerDisposable<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): Disposable;
export function addEventListenerDisposable<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions,
): Disposable;
export function addEventListenerDisposable(
  target: EventTarget,
  type: string,
  listener: EventListener,
  options?: AddEventListenerOptions,
): Disposable;
export function addEventListenerDisposable(
  target: EventTarget,
  type: string,
  listener: EventListener,
  options?: AddEventListenerOptions,
): Disposable {
  target.addEventListener(type, listener, options);
  return toDisposable(() => target.removeEventListener(type, listener, options));
}
