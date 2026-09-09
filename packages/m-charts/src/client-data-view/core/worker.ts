import { createCachedClientDataViewEvaluator } from './evaluator.js';
import type { ClientDataSet, ClientDataViewEvaluation, ClientDataViewState } from './types.js';

// Module worker entry. No application code, network access, or transferred source buffers.
let dataset: ClientDataSet;
let evaluate: ReturnType<typeof createCachedClientDataViewEvaluator>;
let previous: ClientDataViewEvaluation | undefined;
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ id: number; dataset?: ClientDataSet; state: ClientDataViewState }>) => void;
  postMessage(message: unknown): void;
};
scope.onmessage = ({ data }) => {
  try {
    if (data.dataset !== undefined) {
      dataset = data.dataset;
      evaluate = createCachedClientDataViewEvaluator(dataset);
      previous = undefined;
    }
    const result = evaluate(data.state);
    const sourceFields = Object.keys(result.fields).filter((key) => result.fields[key] === dataset.fields[key]);
    const reuse = { mask: result.activeMask === previous?.activeMask, fields: result.fields === previous?.fields, styles: result.styles === previous?.styles };
    scope.postMessage({ id: data.id, reuse, sourceFields, result: {
      ...result,
      activeMask: reuse.mask ? undefined : result.activeMask,
      activeSourceIndices: reuse.mask ? undefined : result.activeSourceIndices,
      fields: reuse.fields ? undefined : Object.fromEntries(Object.entries(result.fields).filter(([key]) => !sourceFields.includes(key))),
      styles: reuse.styles ? undefined : result.styles,
    } });
    previous = result;
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
