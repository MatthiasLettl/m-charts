import { defineConfig, devices } from '@playwright/test';

const enableWebgpu = process.env.M_CHARTS_ENABLE_WEBGPU_E2E === '1';
const webgpuArgs = enableWebgpu
  ? [
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
    baseURL: 'http://127.0.0.1:5176',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 5176',
    url: 'http://127.0.0.1:5176/',
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
