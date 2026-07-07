import { addEventListenerDisposable, DisposableStack, type Disposable } from './disposable.js';
import type { NormalizedResizeEvent } from './events.js';

export interface ResizeLifecycleOptions {
  emitInitial?: boolean;
  getDevicePixelRatio?: () => number;
}

export interface ResizeLifecycle extends Disposable {
  measure(): NormalizedResizeEvent;
}

interface ResizeObserverConstructor {
  new (callback: ResizeObserverCallback): ResizeObserver;
}

function getCssSize(host: HTMLElement, entry?: ResizeObserverEntry): { width: number; height: number } {
  const boxSize = entry?.contentBoxSize;
  const firstBox = Array.isArray(boxSize) ? boxSize[0] : boxSize;
  if (firstBox) {
    return { height: firstBox.blockSize, width: firstBox.inlineSize };
  }
  if (entry?.contentRect) {
    return { height: entry.contentRect.height, width: entry.contentRect.width };
  }
  const rect = host.getBoundingClientRect();
  return { height: rect.height, width: rect.width };
}

export function createResizeLifecycle(
  host: HTMLElement,
  onResize: (event: NormalizedResizeEvent) => void,
  options: ResizeLifecycleOptions = {},
): ResizeLifecycle {
  const emitInitial = options.emitInitial ?? true;
  const getDevicePixelRatio = options.getDevicePixelRatio ?? (() => globalThis.devicePixelRatio || 1);
  const disposables = new DisposableStack();

  let lastEntry: ResizeObserverEntry | undefined;
  let lastDpr = getDevicePixelRatio();
  let mediaQuery: MediaQueryList | null = null;

  function makeEvent(entry?: ResizeObserverEntry): NormalizedResizeEvent {
    const cssSize = getCssSize(host, entry);
    const devicePixelRatio = getDevicePixelRatio();
    return {
      cssSize,
      devicePixelRatio,
      pixelSize: {
        height: Math.round(cssSize.height * devicePixelRatio),
        width: Math.round(cssSize.width * devicePixelRatio),
      },
      type: 'resize',
    };
  }

  function emit(entry?: ResizeObserverEntry): void {
    lastEntry = entry ?? lastEntry;
    lastDpr = getDevicePixelRatio();
    onResize(makeEvent(lastEntry));
    bindDprMediaQuery();
  }

  function bindDprMediaQuery(): void {
    if (!globalThis.matchMedia) {
      return;
    }
    const query = `(resolution: ${lastDpr}dppx)`;
    if (mediaQuery?.media === query) {
      return;
    }
    mediaQuery?.removeEventListener('change', handleDprChange);
    mediaQuery = globalThis.matchMedia(query);
    mediaQuery.addEventListener('change', handleDprChange);
  }

  function handleDprChange(): void {
    emit(lastEntry);
  }

  const resizeObserverCtor = globalThis.ResizeObserver as ResizeObserverConstructor | undefined;
  if (resizeObserverCtor) {
    const observer = new resizeObserverCtor((entries) => {
      emit(entries[0]);
    });
    observer.observe(host);
    disposables.defer(() => observer.disconnect());
  }

  if (globalThis.window) {
    disposables.add(addEventListenerDisposable(globalThis.window, 'resize', () => emit(lastEntry)));
  }

  disposables.defer(() => {
    mediaQuery?.removeEventListener('change', handleDprChange);
    mediaQuery = null;
  });

  if (emitInitial) {
    emit();
  } else {
    bindDprMediaQuery();
  }

  return {
    dispose() {
      disposables.dispose();
    },
    measure() {
      return makeEvent(lastEntry);
    },
  };
}

