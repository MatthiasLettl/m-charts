import type { Disposable } from './disposable.js';

export type RafRequest = (callback: FrameRequestCallback) => number;
export type RafCancel = (handle: number) => void;

export interface LatestRafScheduler<TValue> extends Disposable {
  readonly pending: boolean;
  cancel(): void;
  schedule(value: TValue): void;
}

export interface LatestRafSchedulerOptions {
  requestFrame?: RafRequest;
  cancelFrame?: RafCancel;
}

const fallbackRequestFrame: RafRequest = (callback) =>
  globalThis.requestAnimationFrame
    ? globalThis.requestAnimationFrame(callback)
    : (globalThis.setTimeout(
        () => callback(globalThis.performance?.now() ?? Date.now()),
        16,
      ) as unknown as number);

const fallbackCancelFrame: RafCancel = (handle) =>
  globalThis.cancelAnimationFrame
    ? globalThis.cancelAnimationFrame(handle)
    : globalThis.clearTimeout(handle);

export function createLatestRafScheduler<TValue>(
  run: (value: TValue, timestamp: DOMHighResTimeStamp) => void,
  options: LatestRafSchedulerOptions = {},
): LatestRafScheduler<TValue> {
  const requestFrame = options.requestFrame ?? fallbackRequestFrame;
  const cancelFrame = options.cancelFrame ?? fallbackCancelFrame;
  let frame: number | null = null;
  let latest: TValue | undefined;
  let hasLatest = false;

  function cancel(): void {
    if (frame !== null) {
      cancelFrame(frame);
      frame = null;
    }
    latest = undefined;
    hasLatest = false;
  }

  function schedule(value: TValue): void {
    latest = value;
    hasLatest = true;
    if (frame !== null) {
      return;
    }
    frame = requestFrame((timestamp) => {
      frame = null;
      if (!hasLatest) {
        return;
      }
      const valueToRun = latest as TValue;
      latest = undefined;
      hasLatest = false;
      run(valueToRun, timestamp);
    });
  }

  return {
    get pending() {
      return frame !== null;
    },
    cancel,
    dispose: cancel,
    schedule,
  };
}
