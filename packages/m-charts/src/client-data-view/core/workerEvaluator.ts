import type { ClientDataAsyncEvaluator, ClientDataSet, ClientDataViewEvaluation } from './types.js';

/** Owns a dedicated module worker. Source data is cloned once, never detached. */
export function createClientDataViewWorkerEvaluator(worker: Worker): ClientDataAsyncEvaluator {
  let dataset: ClientDataSet | undefined;
  let previous: ClientDataViewEvaluation | undefined;
  let sequence = 0;
  let disposed = false;
  const pending = new Map<number, { resolve: (value: ClientDataViewEvaluation) => void; reject: (error: Error) => void }>();
  const fail = (message: string) => {
    for (const entry of pending.values()) entry.reject(new Error(message));
    pending.clear();
  };
  worker.onmessage = ({ data }: MessageEvent<{
    id: number; error?: string; sourceFields: string[];
    reuse: { mask: boolean; fields: boolean; styles: boolean }; result: ClientDataViewEvaluation;
  }>) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.error !== undefined) { entry.reject(new TypeError(data.error)); return; }
    const result = data.result;
    const fields = data.reuse.fields ? previous!.fields : {
      ...dataset!.fields, ...result.fields,
    };
    previous = { ...result, fields,
      activeMask: data.reuse.mask ? previous!.activeMask : result.activeMask,
      activeSourceIndices: data.reuse.mask ? previous!.activeSourceIndices : result.activeSourceIndices,
      styles: data.reuse.styles ? previous!.styles : result.styles,
    };
    entry.resolve(previous);
  };
  worker.onerror = (event) => { event.preventDefault(); disposed = true; fail(event.message || 'Client view worker failed.'); worker.terminate(); };
  worker.onmessageerror = () => { disposed = true; fail('Cannot decode client view worker response.'); worker.terminate(); };
  const evaluator: ClientDataAsyncEvaluator = {
    evaluate(nextDataset, state) {
      if (disposed) return Promise.reject(new Error('Client view worker has been disposed.'));
      const changedDataset = dataset !== nextDataset;
      // One evaluator belongs to one controller; updates remain ordered by the worker.
      if (changedDataset && pending.size > 0) return Promise.reject(new Error('Wait for pending evaluation before replacing worker data.'));
      const id = ++sequence;
      const result = new Promise<ClientDataViewEvaluation>((resolve, reject) => pending.set(id, { resolve, reject }));
      try {
        const serializableDataset = changedDataset ? { ...nextDataset, fields: Object.fromEntries(Object.entries(nextDataset.fields).map(([key, field]) => [key, { ...field, values: ArrayBuffer.isView(field.values) || Array.isArray(field.values) ? field.values : Array.from(field.values) }])) } : undefined;
        worker.postMessage({ id, state, ...(changedDataset ? { dataset: serializableDataset } : {}) });
        dataset = nextDataset;
      } catch (error) {
        pending.get(id)!.reject(error instanceof Error ? error : new Error(String(error))); pending.delete(id);
      }
      return result;
    },
    dispose() { disposed = true; worker.terminate(); fail('Client view worker has been disposed.'); },
  };
  let inFlight = false;
  let queued: { run(): void; reject(error: Error): void } | undefined;
  return {
    evaluate(nextDataset, state) {
      if (disposed) return Promise.reject(new Error('Client view worker has been disposed.'));
      return new Promise<ClientDataViewEvaluation>((resolve, reject) => {
        const run = () => {
          inFlight = true;
          void evaluator.evaluate(nextDataset, state).then(resolve, reject).finally(() => {
            inFlight = false;
            const next = queued; queued = undefined; next?.run();
          });
        };
        if (!inFlight) run();
        else {
          queued?.reject(new Error('Client evaluation superseded by a newer request.'));
          queued = { run, reject };
        }
      });
    },
    dispose() {
      queued?.reject(new Error('Client view worker has been disposed.')); queued = undefined;
      evaluator.dispose?.();
    },
  };
}
