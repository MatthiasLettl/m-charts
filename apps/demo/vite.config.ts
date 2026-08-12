import type { ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

import { createWebgpuServerStreamResponse } from '../../api/webgpu-stream.ts';
import { WEBGPU_SERVER_STREAM_ENDPOINT } from './src/data/webgpuServerStreamProtocol.ts';

export default defineConfig({
  plugins: [react(), webgpuServerStreamDevelopmentPlugin()],
  resolve: {
    alias: {
      'm-charts/plot-engine': new URL('../../packages/m-charts/src/plot-engine/index.ts', import.meta.url).pathname,
      'm-charts/plot-engine-webgpu': new URL('../../packages/m-charts/src/plot-engine-webgpu/index.ts', import.meta.url).pathname,
      'm-charts/m-scatter': new URL('../../packages/m-charts/src/m-scatter/index.ts', import.meta.url).pathname,
      'm-charts/m-scatter-webgpu': new URL('../../packages/m-charts/src/m-scatter-webgpu/index.ts', import.meta.url).pathname,
      'm-charts/m-parallel': new URL('../../packages/m-charts/src/m-parallel/index.ts', import.meta.url).pathname,
      'm-charts/m-parallel-webgpu': new URL('../../packages/m-charts/src/m-parallel-webgpu/index.ts', import.meta.url).pathname,
      'm-charts/m-histogram-webgpu': new URL('../../packages/m-charts/src/m-histogram-webgpu/index.ts', import.meta.url).pathname,
      'm-charts/m-histogram': new URL('../../packages/m-charts/src/m-histogram/index.ts', import.meta.url).pathname,
      'm-charts/scatter': new URL('../../packages/m-charts/src/m-scatter/index.ts', import.meta.url).pathname,
      'm-charts/parallel': new URL('../../packages/m-charts/src/m-parallel/index.ts', import.meta.url).pathname,
      'm-charts/histogram': new URL('../../packages/m-charts/src/m-histogram/index.ts', import.meta.url).pathname,
      'm-charts': new URL('../../packages/m-charts/src/index.ts', import.meta.url).pathname,
    },
  },
});

function webgpuServerStreamDevelopmentPlugin(): Plugin {
  return {
    name: 'm-charts-webgpu-server-stream-development',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url ?? '/', 'http://localhost');
        if (requestUrl.pathname !== WEBGPU_SERVER_STREAM_ENDPOINT) {
          next();
          return;
        }
        const controller = new AbortController();
        request.once('aborted', () => controller.abort());
        response.once('close', () => {
          if (!response.writableEnded) controller.abort();
        });
        const webRequest = new Request(requestUrl, {
          method: request.method ?? 'GET',
          signal: controller.signal,
        });
        try {
          await writeWebResponse(
            response,
            createWebgpuServerStreamResponse(webRequest),
          );
        } catch (error) {
          if (controller.signal.aborted) return;
          next(error);
        }
      });
    },
  };
}

async function writeWebResponse(
  target: ServerResponse,
  source: Response,
): Promise<void> {
  target.statusCode = source.status;
  source.headers.forEach((value, key) => target.setHeader(key, value));
  if (source.body === null) {
    target.end();
    return;
  }
  const reader = source.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!target.write(result.value)) {
        await new Promise<void>((resolve) => target.once('drain', resolve));
      }
    }
    target.end();
  } finally {
    reader.releaseLock();
  }
}
