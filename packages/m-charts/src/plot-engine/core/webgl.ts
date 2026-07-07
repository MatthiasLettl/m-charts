import { addEventListenerDisposable, DisposableStack, type Disposable } from './disposable.js';

export interface WebGlContextLifecycleOptions {
  onLost?: (event: Event) => void;
  onRestored?: (event: Event) => void;
  preventDefaultOnLost?: boolean;
}

export function createWebGlContextLifecycle(
  canvas: HTMLCanvasElement,
  options: WebGlContextLifecycleOptions = {},
): Disposable {
  const preventDefaultOnLost = options.preventDefaultOnLost ?? true;
  const disposables = new DisposableStack();
  disposables.add(
    addEventListenerDisposable(canvas, 'webglcontextlost', (event) => {
      if (preventDefaultOnLost && event.cancelable) {
        event.preventDefault();
      }
      options.onLost?.(event);
    }),
  );
  disposables.add(
    addEventListenerDisposable(canvas, 'webglcontextrestored', (event) => {
      options.onRestored?.(event);
    }),
  );
  return disposables;
}

