import { expect, test } from '@playwright/test';

test.setTimeout(60_000);
test.skip(process.env.M_CHARTS_ENABLE_WEBGPU_E2E !== '1', 'Requires WebGPU.');

test('scatter follows unknown bounds, preserves zoom, and resumes after fit once', async ({ page }) => {
  await page.goto('/m-scatter-webgpu?points=1000000&webgpuData=stream-local&__e2eStreamDelayMs=500&__e2eStreamUnknownDomain=1');
  const controls = page.getByTestId('streaming-viewport-controls');
  await expect(controls).toHaveAttribute('data-following', 'true');
  const bounds = async () => JSON.parse((await controls.getAttribute('data-bounds'))!).x.max as number;
  const first = await bounds();
  await expect.poll(bounds).toBeGreaterThan(first);
  const host = page.getByLabel('WebGPU scatter-fast point canvas host');
  const box = await host.boundingBox();
  if (box === null) throw new Error('Scatter canvas is missing');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.85, { steps: 5 });
  await page.mouse.up();
  await expect(controls).toHaveAttribute('data-following', 'false');
  await expect(page).toHaveURL(/xMin=/);
  const zoomMax = new URL(page.url()).searchParams.get('xMax');
  const pausedBounds = await bounds();
  await expect.poll(bounds).toBeGreaterThan(pausedBounds);
  expect(new URL(page.url()).searchParams.get('xMax')).toBe(zoomMax);
  await controls.getByRole('button', { name: 'Resume following', exact: true }).click();
  await expect(controls).toHaveAttribute('data-following', 'true');
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('xMax'))).toBeGreaterThan(Number(zoomMax));
  await controls.getByRole('button', { name: 'Fit once', exact: true }).click();
  await expect(controls).toHaveAttribute('data-following', 'false');
  await page.getByRole('button', { name: 'Show all / Resume following', exact: true }).click();
  await expect(controls).toHaveAttribute('data-following', 'true');
});

for (const backend of ['rust-wasm', 'typescript']) {
  test(`histogram preserves a live zoom and fits latest full data (${backend})`, async ({ page }) => {
    await page.goto(`/m-histogram-webgpu?points=1000000&webgpuData=stream-local&aggregationBackend=${backend}&__e2eStreamDelayMs=2000`);
    const controls = page.getByTestId('streaming-viewport-controls');
    await expect(controls).toHaveAttribute('data-following', 'true');
    const frame = page.locator('.histogram-fast-overlay-plot-frame').last();
    const box = await frame.boundingBox();
    if (box === null) throw new Error('Histogram frame is missing');
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 5 });
    await page.mouse.up();
    await expect(controls).toHaveAttribute('data-following', 'false');
    await expect(page).toHaveURL(/histViewport.signalValue.xMax=/);
    const zoomMax = new URL(page.url()).searchParams.get('histViewport.signalValue.xMax');
    await expect(page.getByTestId('histogram-webgpu-stream-progress')).toHaveAttribute('data-loaded-count', '1000000');
    expect(new URL(page.url()).searchParams.get('histViewport.signalValue.xMax')).toBe(zoomMax);
    const full = JSON.parse((await controls.getAttribute('data-bounds'))!).subplotById.signalValue;
    await page.getByRole('button', { name: 'Show all / Resume following', exact: true }).click();
    await expect(controls).toHaveAttribute('data-following', 'true');
    await expect.poll(() => Number(new URL(page.url()).searchParams.get('histViewport.signalValue.xMax'))).toBeCloseTo(full.x.max, 4);
    await controls.getByRole('button', { name: 'Fit once', exact: true }).click();
    await expect(controls).toHaveAttribute('data-following', 'false');
    // A saved inspection viewport must survive asynchronous plot creation.
    const saved = new URL(page.url());
    saved.searchParams.set('histViewport.signalValue.xMin', '45');
    saved.searchParams.set('histViewport.signalValue.xMax', '65');
    await page.goto(saved.href);
    await expect(page.getByTestId('streaming-viewport-controls')).toHaveAttribute('data-following', 'false');
    expect(new URL(page.url()).searchParams.get('histViewport.signalValue.xMax')).toBe('65');
    await expect.poll(() => page.evaluate(() =>
      window.__histogramFastRouteStateTestHook?.()?.viewport?.subplotById.signalValue?.x.max,
    )).toBe(65);
  });
}

test('parallel preserves an axis zoom across streamed batches and resumes full domains', async ({ page }) => {
  await page.goto('/m-parallel-webgpu?points=1000000&webgpuData=stream-local&__e2eStreamDelayMs=500');
  const controls = page.getByTestId('streaming-viewport-controls');
  await expect(controls).toHaveAttribute('data-following', 'true');
  const axis = page.locator('.parallel-fast-axis-guide[data-axis="signalValue"]');
  const box = await axis.locator('.parallel-fast-axis-line').boundingBox();
  if (box === null) throw new Error('Parallel signal axis is missing');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await expect(controls).toHaveAttribute('data-following', 'false');
  await expect(page).toHaveURL(/pf.signalValue.max=/);
  const zoom = new URL(page.url()).searchParams.get('pf.signalValue.max');
  const progress = page.getByTestId('parallel-webgpu-stream-progress');
  const loaded = Number(await progress.getAttribute('data-loaded-count'));
  await expect.poll(async () => Number(await progress.getAttribute('data-loaded-count'))).toBeGreaterThan(loaded);
  expect(new URL(page.url()).searchParams.get('pf.signalValue.max')).toBe(zoom);
  await page.getByRole('button', { name: 'Show all / Resume following', exact: true }).click();
  await expect(controls).toHaveAttribute('data-following', 'true');
  await expect(page).not.toHaveURL(/pf.signalValue.max=/);
});
