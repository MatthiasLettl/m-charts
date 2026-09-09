import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.M_CHARTS_E2E_PORT ?? 5176);
const baseURL = `http://127.0.0.1:${port}`;

const enableWebgpu = process.env.M_CHARTS_ENABLE_WEBGPU_E2E === '1';
const webgpuArgs = enableWebgpu
  ? process.platform === 'darwin'
    ? ['--enable-unsafe-webgpu']
    : [
      '--disable-vulkan-surface',
      '--enable-features=Vulkan,WebGPU,UseSkiaRenderer',
      '--enable-unsafe-webgpu',
      '--use-angle=vulkan',
      '--use-vulkan=native',
    ]
  : [];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    // macOS headless Chromium exposes an adapter but does not reliably present
    // WebGPU canvases. Explicit GPU runs use the native window compositor.
    headless: !(enableWebgpu && process.platform === 'darwin'),
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: webgpuArgs },
      },
    },
  ],
});
