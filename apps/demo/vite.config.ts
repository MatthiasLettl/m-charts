import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'm-charts/plot-engine': new URL('../../packages/m-charts/src/plot-engine/index.ts', import.meta.url).pathname,
      'm-charts/plot-engine-webgpu': new URL('../../packages/m-charts/src/plot-engine-webgpu/index.ts', import.meta.url).pathname,
      'm-charts/m-scatter': new URL('../../packages/m-charts/src/m-scatter/index.ts', import.meta.url).pathname,
      'm-charts/m-scatter-webgpu': new URL('../../packages/m-charts/src/m-scatter-webgpu/index.ts', import.meta.url).pathname,
      'm-charts/m-parallel': new URL('../../packages/m-charts/src/m-parallel/index.ts', import.meta.url).pathname,
      'm-charts/m-histogram': new URL('../../packages/m-charts/src/m-histogram/index.ts', import.meta.url).pathname,
      'm-charts/scatter': new URL('../../packages/m-charts/src/m-scatter/index.ts', import.meta.url).pathname,
      'm-charts/parallel': new URL('../../packages/m-charts/src/m-parallel/index.ts', import.meta.url).pathname,
      'm-charts/histogram': new URL('../../packages/m-charts/src/m-histogram/index.ts', import.meta.url).pathname,
      'm-charts': new URL('../../packages/m-charts/src/index.ts', import.meta.url).pathname,
    },
  },
});
