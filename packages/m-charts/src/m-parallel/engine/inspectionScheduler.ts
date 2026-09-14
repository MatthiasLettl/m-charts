import {
  createLatestRafScheduler,
  type LatestRafSchedulerOptions,
} from '../../plot-engine/core/scheduler.js';

/** One lookup in flight, with only the latest pointer retained for the next frame. */
export function createParallelInspectionScheduler<T>(
  run: (value: T, isCurrent: () => boolean) => void | Promise<void>,
  onError: (error: unknown) => void,
  options: LatestRafSchedulerOptions = {},
) {
  let generation = 0;
  let running = false;
  let disposed = false;
  let latest: { value: T } | null = null;

  const frames = createLatestRafScheduler<void>(() => {
    if (running || latest === null || disposed) return;
    const { value } = latest;
    latest = null;
    running = true;
    const currentGeneration = generation;
    const isCurrent = () => !disposed && generation === currentGeneration;
    const finish = () => {
      running = false;
      if (latest !== null && !disposed) frames.schedule();
    };
    try {
      const result = run(value, isCurrent);
      if (result === undefined) finish();
      else void result.then(finish, (error: unknown) => {
        finish();
        if (isCurrent()) onError(error);
      });
    } catch (error) {
      finish();
      if (isCurrent()) onError(error);
    }
  }, options);

  const cancel = () => {
    generation += 1;
    latest = null;
    frames.cancel();
  };
  return {
    schedule(value: T) {
      if (disposed) return;
      latest = { value };
      if (!running) frames.schedule();
    },
    cancel,
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
