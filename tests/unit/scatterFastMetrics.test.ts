import assert from 'node:assert/strict';

import { createFastScatterGpuTimer } from '../../packages/m-charts/src/m-scatter/core/index.ts';

const fallbackTimer = createFastScatterGpuTimer({
  getExtension: () => null,
} as unknown as WebGL2RenderingContext);

assert.equal(fallbackTimer.supported, false);
assert.doesNotThrow(() => {
  fallbackTimer.begin();
  fallbackTimer.end();
});
assert.equal(fallbackTimer.poll(), null);

let queryDeleted = false;
const supportedTimer = createFastScatterGpuTimer({
  QUERY_RESULT: 0x8866,
  QUERY_RESULT_AVAILABLE: 0x8867,
  beginQuery: (_target: number, query: WebGLQuery) => {
    assert.deepEqual(query, { id: 1 });
  },
  createQuery: () => ({ id: 1 }) as unknown as WebGLQuery,
  deleteQuery: () => {
    queryDeleted = true;
  },
  endQuery: () => {},
  getExtension: () => ({
    GPU_DISJOINT_EXT: 0x8fbb,
    TIME_ELAPSED_EXT: 0x88bf,
  }),
  getParameter: () => false,
  getQueryParameter: (_query: WebGLQuery, parameter: number) =>
    parameter === 0x8867 ? true : 2_500_000,
  isContextLost: () => false,
} as unknown as WebGL2RenderingContext);

assert.equal(supportedTimer.supported, true);
supportedTimer.begin();
supportedTimer.end();
assert.deepEqual(supportedTimer.poll(), {
  disjoint: false,
  durationMs: 2.5,
});
assert.equal(queryDeleted, true);
