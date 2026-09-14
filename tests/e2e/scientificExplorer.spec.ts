import { expect, test, type Page } from '@playwright/test';
type View = 'timeline' | 'scatter' | 'histogram' | 'parallel' | 'density';
async function visibleViews(page: Page) {
  return (await page
    .locator('.sci-plot')
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid')!.replace('explorer-', '')),
    )) as View[];
}
async function showChart(page: Page, view: View) {
  if (
    view === 'timeline' ||
    (await page.getByTestId(`explorer-${view}`).count())
  )
    return;
  await page
    .getByRole('button', {
      name:
        view === 'parallel'
          ? 'Parallel'
          : view === 'density'
            ? 'Density'
            : view === 'scatter'
              ? 'Scatter'
              : 'Histogram',
      exact: true,
    })
    .click();
  await expect(page.getByTestId(`explorer-${view}`)).toHaveAttribute(
    'data-render-state',
    'ready',
  );
}
async function chooseTool(page: Page, tool: 'Zoom' | 'Filter') {
  await page
    .getByRole('button', {
      name: tool === 'Filter' ? 'Select' : 'Zoom',
      exact: true,
    })
    .click();
}
async function chartMenu(page: Page, title: string) {
  await page
    .getByRole('button', { name: `${title} options`, exact: true })
    .click();
}
test.skip(
  process.env.M_CHARTS_ENABLE_WEBGPU_E2E !== '1',
  'This showcase requires WebGPU. Run with M_CHARTS_ENABLE_WEBGPU_E2E=1.',
);
async function ready(page: Page) {
  await expect(page.getByTestId('explorer-timeline')).toBeVisible();
  for (const view of await visibleViews(page)) {
    await expect(page.getByTestId(`explorer-${view}`)).toHaveAttribute(
      'data-render-state',
      'ready',
    );
    await expect(page.getByTestId(`explorer-${view}`)).toHaveAttribute(
      'data-renderer',
      'webgpu',
    );
    const host = page
      .getByTestId(`explorer-${view}`)
      .locator('.sci-chart-host');
    await expect
      .poll(async () => {
        const diagnostics = JSON.parse(
          (await host.getAttribute('data-webgpu-diagnostics')) ?? '{}',
        );
        return diagnostics.aggregationBackendPreference;
      })
      .toBe('rust-wasm');
    // Point plots render directly; the three aggregate views must use WASM.
    if (view === 'histogram' || view === 'parallel' || view === 'density') {
      await expect
        .poll(async () => {
          const diagnostics = JSON.parse(
            (await host.getAttribute('data-webgpu-diagnostics')) ?? '{}',
          );
          return diagnostics.aggregationBackend;
        })
        .toBe('rust-wasm');
    }
  }
}
async function count(page: Page) {
  return Number(
    (await page.getByTestId('matching-count').innerText()).replaceAll(',', ''),
  );
}
async function linkedCount(page: Page, expected: number, filtered = true) {
  await expect(page.getByTestId('matching-count')).toHaveText(
    expected.toLocaleString('en'),
  );
  for (const view of await visibleViews(page)) {
    const chart = page.getByTestId(`explorer-${view}`);
    await expect(chart).toHaveAttribute(
      'data-selected-count',
      String(expected),
    );
    await expect(chart.locator('.sci-chart-host')).toHaveAttribute(
      'data-applied-selection-count',
      String(filtered ? expected : 0),
    );
  }
}
async function brush(
  page: Page,
  view: View,
  start: [number, number],
  end: [number, number],
  button: 'left' | 'right' | 'middle' = 'right',
  whileDragging?: () => Promise<void>,
) {
  await showChart(page, view);
  const chart = page.getByTestId(`explorer-${view}`);
  const host = await chart.locator('.sci-chart-host').boundingBox();
  if (!host) throw new Error('Missing chart host');
  const plot =
    view === 'parallel'
      ? { x: 0, y: 0, width: host.width, height: host.height }
      : await chart.locator('.sci-chart-axes').evaluate((svg) => {
          const lines = svg.querySelectorAll('line');
          const first = lines[0];
          const last = lines[lines.length - 1];
          return {
            x: Number(first.getAttribute('x1')),
            y: Number(first.getAttribute('y1')),
            width:
              Number(first.getAttribute('x2')) -
              Number(first.getAttribute('x1')),
            height:
              Number(last.getAttribute('y1')) -
              Number(first.getAttribute('y1')),
          };
        });
  const x = (n: number) => host.x + plot.x + plot.width * n;
  const y = (n: number) => host.y + plot.y + plot.height * n;
  await page.mouse.move(x(start[0]), y(start[1]));
  await page.mouse.down({ button });
  await page.mouse.move(x(end[0]), y(end[1]), { steps: 15 });
  await whileDragging?.();
  await page.mouse.up({ button });
}
async function usableLayout(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if ((page.viewportSize()?.width ?? 0) > 900) {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
    const grid = await page.locator('.sci-grid').boundingBox();
    expect(grid!.height).toBeGreaterThan(page.viewportSize()!.height / 2);
    expect(grid!.y + grid!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
  }
  for (const view of await visibleViews(page)) {
    const host = await page.getByTestId(`explorer-${view}`).boundingBox();
    expect(host!.height).toBeGreaterThan(100);
  }
}

test('desktop dashboard, scenarios, modal focus, isolate, empty recovery, and theme', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('link', { name: /Scientific data explorer/ }).click();
  await ready(page);
  await linkedCount(page, 12000, false);
  expect((await page.locator('.sci-grid').boundingBox())!.y).toBeLessThan(160);
  await page.getByTestId('explorer-scatter').locator('.sci-chart-host').click();
  await linkedCount(page, 12000, false);
  await usableLayout(page);
  await page.getByRole('button', { name: /Heat spike/ }).click();
  await linkedCount(page, 600);
  await usableLayout(page);
  await page
    .getByRole('button', { name: 'For developers', exact: true })
    .click();
  await page.getByRole('button', { name: 'Readings', exact: true }).click();
  await expect(page.locator('.sci-records tbody tr')).toHaveCount(6);
  await expect(page.locator('.sci-records tbody')).toContainText('Chamber B');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Readings', exact: true }),
  ).toBeFocused();
  await page
    .getByRole('button', { name: 'Filter to selection', exact: true })
    .click();
  await ready(page);
  for (const view of await visibleViews(page))
    await expect(page.getByTestId(`explorer-${view}`)).toHaveAttribute(
      'data-record-count',
      view === 'timeline' ? '4000' : '600',
    );
  // Isolated histogram membership must map back to the original experiment IDs.
  await brush(page, 'histogram', [0.4, 0.1], [0.58, 0.9]);
  await expect.poll(() => count(page)).toBeLessThan(600);
  const isolatedCount = await count(page);
  expect(isolatedCount).toBeGreaterThan(0);
  await ready(page);
  await linkedCount(page, isolatedCount);
  await page.getByLabel('Chamber B', { exact: true }).uncheck();
  await expect(page.getByTestId('matching-count')).toHaveText('0');
  for (const view of await visibleViews(page))
    await expect(page.getByTestId(`explorer-${view}`)).toHaveAttribute(
      'data-render-state',
      'empty',
    );
  await expect(
    page.getByText('No readings match this combination.'),
  ).toBeVisible();
  await usableLayout(page);
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await ready(page);
  await linkedCount(page, 12000, false);
  await page
    .getByRole('button', { name: 'For developers', exact: true })
    .click();
  await expect(page.locator('.sci-event-list')).toContainText('plot.update');
  await page
    .getByRole('button', { name: 'Close inspector', exact: true })
    .click();
  await page.getByTestId('theme-mode-switch').click();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await usableLayout(page);
  expect(errors).toEqual([]);
});

test('native right brushes intersect; left zoom is local; Select tool and precise ranges stay linked', async ({
  page,
}) => {
  await page.goto('/scientific-explorer');
  await ready(page);
  await brush(page, 'timeline', [0.4, 0.01], [0.55, 0.99]);
  await expect.poll(() => count(page)).toBeLessThan(12000);
  const timeCount = await count(page);
  expect(timeCount).toBeGreaterThan(1700);
  expect(timeCount).toBeLessThan(1900);
  await linkedCount(page, timeCount);
  // Zoom must never turn into a cohort constraint.
  await chooseTool(page, 'Zoom');
  await brush(page, 'scatter', [0.05, 0.05], [0.95, 0.95], 'left');
  await linkedCount(page, timeCount);
  await expect(
    page.getByRole('button', {
      name: 'Clear Temperature × pressure filter',
      exact: true,
    }),
  ).toHaveCount(0);
  await brush(page, 'scatter', [0.3, 0.05], [0.95, 0.95]);
  await brush(page, 'histogram', [0.5, 0.01], [0.9, 0.99]);
  await brush(page, 'parallel', [2 / 3, 0.25], [2 / 3, 0.75]);
  await brush(page, 'density', [0.3, 0.05], [0.95, 0.95]);
  const finalCount = await count(page);
  expect(finalCount).toBeGreaterThan(0);
  expect(finalCount).toBeLessThan(timeCount);
  await linkedCount(page, finalCount);
  await page
    .getByRole('button', { name: 'For developers', exact: true })
    .click();
  await expect(page.locator('.sci-event-list')).toContainText(
    'selectionchange',
  );
  await expect(page.locator('.sci-event-list')).toContainText('brushcommit');
  await page
    .getByRole('button', { name: 'Close inspector', exact: true })
    .click();
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await ready(page);
  await chooseTool(page, 'Filter');
  await brush(page, 'timeline', [0.4, 0.5], [0.55, 0.5], 'left');
  await linkedCount(page, 1800);
  await chartMenu(page, 'Temperature distribution');
  await page
    .getByRole('button', {
      name: 'Set Temperature distribution ranges',
      exact: true,
    })
    .click();
  await page.getByLabel('Temperature minimum').fill('35');
  await page.getByLabel('Temperature maximum').fill('40');
  await page.getByRole('button', { name: 'Apply range' }).click();
  const precise = await count(page);
  expect(precise).toBeGreaterThan(0);
  expect(precise).toBeLessThan(1800);
  await linkedCount(page, precise);
});

test('mobile ranges, help dialog, and horizontal layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/scientific-explorer');
  await ready(page);
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page.getByRole('dialog')).toContainText('Drag to filter');
  await page.keyboard.press('Escape');
  await chartMenu(page, 'Experiment timeline');
  await page
    .getByRole('button', { name: 'Set Time window ranges', exact: true })
    .click();
  await page.getByLabel('Time minimum').fill('48');
  await page.getByLabel('Time maximum').fill('66');
  await page.getByRole('button', { name: 'Apply range' }).click();
  await linkedCount(page, 1800);
  await expect(
    page.getByRole('button', { name: 'Set Time window ranges', exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await linkedCount(page, 12000, false);
});

test('viewport undo, inspection, lasso, append, and editable parallel brushes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/scientific-explorer');
  await ready(page);
  const scatter = page.getByTestId('explorer-scatter');
  const scatterHost = scatter.locator('.sci-chart-host');
  await chooseTool(page, 'Zoom');
  const initial = JSON.parse(
    (await scatterHost.getAttribute('data-viewport'))!,
  );
  await brush(page, 'scatter', [0.2, 0.1], [0.8, 0.9], 'left');
  await expect
    .poll(
      async () =>
        JSON.parse((await scatterHost.getAttribute('data-viewport'))!).x.min,
    )
    .toBeGreaterThan(initial.x.min);
  const rect = await scatterHost.boundingBox();
  if (!rect) throw new Error('Missing scatter');
  await page.mouse.click(rect.x + 150, rect.y + 35, { button: 'middle' });
  await expect
    .poll(
      async () =>
        JSON.parse((await scatterHost.getAttribute('data-viewport'))!).x.min,
    )
    .toBe(initial.x.min);
  await linkedCount(page, 12000, false);
  // Native hover has an actual record readout, not just a cursor change.
  const position = await scatter.locator('.sci-chart-axes').evaluate((svg) => {
    const lines = svg.querySelectorAll('line');
    const first = lines[0];
    const last = lines[lines.length - 1];
    return {
      x: Number(first.getAttribute('x1')),
      y: Number(first.getAttribute('y1')),
      width:
        Number(first.getAttribute('x2')) - Number(first.getAttribute('x1')),
      height:
        Number(last.getAttribute('y1')) - Number(first.getAttribute('y1')),
    };
  });
  // An observed point in the unfiltered synthetic experiment.
  const rows = (
    await import('../../apps/demo/src/routes/scientific/sensorModel.ts')
  ).createSensorReadings();
  const row = rows[6000];
  await page.mouse.move(
    rect.x + position.x + ((row.temperature - 18) / 28) * position.width,
    rect.y + position.y + ((123 - row.pressure) / 28) * position.height,
  );
  await expect(scatter.locator('.sci-hover')).toContainText('TC-');
  await page.mouse.move(10, 10);
  await expect(scatter.locator('.sci-hover')).toHaveCount(0);
  await brush(page, 'scatter', [0.1, 0.2], [0.45, 0.95]);
  const first = await count(page);
  expect(first).toBeGreaterThan(0);
  await page.keyboard.down('Control');
  await brush(page, 'scatter', [0.55, 0.15], [0.9, 0.7]);
  await page.keyboard.up('Control');
  await expect.poll(() => count(page)).toBeGreaterThan(first);
  await linkedCount(page, await count(page));
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await ready(page);
  const box = await scatterHost.boundingBox();
  if (!box) throw new Error('Missing scatter');
  const points = [
    [0.08, 0.9],
    [0.2, 0.55],
    [0.72, 0.1],
    [0.9, 0.5],
    [0.45, 0.95],
    [0.08, 0.9],
  ];
  await page.mouse.move(
    box.x + position.x + points[0][0] * position.width,
    box.y + position.y + points[0][1] * position.height,
  );
  await page.keyboard.down('Space');
  await page.mouse.down({ button: 'right' });
  for (const [x, y] of points.slice(1))
    await page.mouse.move(
      box.x + position.x + x * position.width,
      box.y + position.y + y * position.height,
      { steps: 5 },
    );
  await expect(scatter.locator('[data-overlay-kind="lasso"]')).toBeVisible();
  expect(
    await scatter.locator('[data-overlay-kind="lasso"]').getAttribute('points'),
  ).toContain(',');
  await page.mouse.up({ button: 'right' });
  await expect(scatter.locator('[data-overlay-kind="lasso"]')).toHaveCount(0);
  await page.keyboard.up('Space');
  const lassoCount = await count(page);
  expect(lassoCount).toBeGreaterThan(0);
  expect(lassoCount).toBeLessThan(12000);
  await linkedCount(page, lassoCount);
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await ready(page);
  await brush(page, 'parallel', [2 / 3, 0.2], [2 / 3, 0.7]);
  const band = page
    .getByTestId('explorer-parallel')
    .locator('.parallel-fast-axis-brush-band');
  await expect(band).toHaveCount(1);
  const beforeMove = await count(page);
  const bandBox = await band.boundingBox();
  if (!bandBox) throw new Error('Missing parallel brush');
  const center = {
    x: bandBox.x + bandBox.width / 2,
    y: bandBox.y + bandBox.height / 2,
  };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(center.x, center.y + 15, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(() => count(page)).not.toBe(beforeMove);
  await linkedCount(page, await count(page));
  await band.dblclick({ button: 'right' });
  await linkedCount(page, 12000, false);
});

test('unavailable WebGPU shows recoverable chart errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'gpu', { value: undefined }),
  );
  await page.goto('/scientific-explorer');
  for (const view of ['timeline', 'scatter', 'histogram']) {
    await expect(page.getByTestId(`explorer-${view}`)).toHaveAttribute(
      'data-render-state',
      'error',
    );
    await expect(
      page.getByTestId(`explorer-${view}`).getByRole('alert'),
    ).toContainText('Chart unavailable');
  }
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
});

test('live brush previews track pointer geometry and parallel bands stay centered', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/scientific-explorer');
  await ready(page);
  await chooseTool(page, 'Zoom');
  for (const view of ['timeline', 'scatter', 'density', 'histogram'] as const) {
    for (const button of ['left', 'right'] as const) {
      await chooseTool(page, 'Zoom');
      const chart = page.getByTestId(`explorer-${view}`);
      const overlayKind =
        button === 'left' ? 'rectangle-zoom' : 'rectangle-selection';
      await brush(page, view, [0.15, 0.2], [0.8, 0.8], button, async () => {
        const overlay = chart.locator(`[data-overlay-kind="${overlayKind}"]`);
        await expect(overlay).toBeVisible();
        const bounds = await overlay.boundingBox();
        expect(bounds!.width).toBeGreaterThan(30);
        expect(bounds!.height).toBeGreaterThan(20);
        const style = await overlay.evaluate((el) => ({
          stroke: getComputedStyle(el).stroke,
          fill: getComputedStyle(el).fill,
          pointer: getComputedStyle(el.parentElement!).pointerEvents,
        }));
        expect(style.stroke).not.toBe('none');
        expect(style.fill).not.toBe('none');
        expect(style.pointer).toBe('none');
        if (view === 'scatter' && button === 'left')
          await page.screenshot({ path: testInfo.outputPath('live-zoom.png') });
      });
      await expect(chart.locator('.sci-live-brush')).toHaveCount(0);
      await page
        .getByRole('button', { name: 'Reset all', exact: true })
        .click();
    }
  }
  // Application-owned left selection receives the same native live preview.
  await chooseTool(page, 'Filter');
  await brush(page, 'scatter', [0.2, 0.2], [0.7, 0.7], 'left', async () => {
    await expect(
      page.getByTestId('explorer-scatter').locator('.sci-live-brush'),
    ).toBeVisible();
  });
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await chooseTool(page, 'Zoom');
  await showChart(page, 'parallel');
  const parallel = page.getByTestId('explorer-parallel');
  const axis = parallel.locator('.sci-axis-guide[data-axis="pressure"]');
  const axisBounds = (await axis.boundingBox())!;
  const axisX = axisBounds.x + axisBounds.width / 2;
  for (const button of ['left', 'right'] as const) {
    await page.mouse.move(axisX, axisBounds.y + axisBounds.height * 0.2);
    await page.mouse.down({ button });
    await page.mouse.move(axisX, axisBounds.y + axisBounds.height * 0.65, {
      steps: 12,
    });
    const band =
      button === 'left'
        ? parallel.locator('.parallel-fast-axis-viewport-box')
        : axis.locator('.parallel-fast-axis-brush-band');
    await expect(band).toBeVisible();
    const bounds = (await band.boundingBox())!;
    expect(Math.abs(bounds.x + bounds.width / 2 - axisX)).toBeLessThan(1);
    expect(bounds.height).toBeGreaterThan(20);
    if (button === 'right')
      await page.screenshot({
        path: testInfo.outputPath('parallel-live-brush.png'),
      });
    await page.mouse.up({ button });
  }
  // Moving and resizing preserves the horizontal alignment.
  const band = axis.locator('.parallel-fast-axis-brush-band');
  const bounds = (await band.boundingBox())!;
  await page.mouse.move(axisX, bounds.y + bounds.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(axisX, bounds.y + bounds.height / 2 + 8, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  const moved = (await band.boundingBox())!;
  expect(Math.abs(moved.x + moved.width / 2 - axisX)).toBeLessThan(1);
});

test('live replay preserves navigation; reset restores a repeatable starting point', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/scientific-explorer');
  await ready(page);
  await page.getByRole('button', { name: 'Live data', exact: true }).click();
  await ready(page);
  await expect(
    page.getByRole('button', { name: 'Pause replay', exact: true }),
  ).toBeVisible();
  await expect.poll(() => count(page)).toBeGreaterThan(1200);
  await page.getByRole('button', { name: 'Pause replay', exact: true }).click();
  await chooseTool(page, 'Zoom');
  await brush(page, 'timeline', [0.2, 0.1], [0.8, 0.9], 'left');
  const host = page.getByTestId('explorer-timeline').locator('.sci-chart-host');
  const zoom = await host.getAttribute('data-viewport');
  await page
    .getByRole('button', { name: 'Resume replay', exact: true })
    .click();
  await expect.poll(() => count(page)).toBeGreaterThan(1200);
  await page.getByRole('button', { name: 'Pause replay', exact: true }).click();
  await expect(host).toHaveAttribute('data-viewport', zoom!);
  const paused = await count(page);
  await page
    .getByRole('button', { name: 'Resume replay', exact: true })
    .click();
  await expect.poll(() => count(page)).toBeGreaterThan(paused);
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await ready(page);
  await linkedCount(page, 1200, false);
  await expect(page.getByTestId('stream-status')).toContainText('Paused');
  await expect
    .poll(
      async () => JSON.parse((await host.getAttribute('data-viewport'))!).x.min,
    )
    .toBe(0);
  await usableLayout(page);
});

test('alternate charts clear hidden filters and Reset all restores all interaction defaults', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/scientific-explorer');
  await ready(page);
  await showChart(page, 'parallel');
  await brush(page, 'parallel', [2 / 3, 0.2], [2 / 3, 0.7], 'left');
  await expect.poll(() => count(page)).toBeLessThan(12000);
  await showChart(page, 'scatter');
  await linkedCount(page, 12000, false);
  await showChart(page, 'density');
  await chooseTool(page, 'Zoom');
  await chartMenu(page, 'Vibration & pressure');
  await page
    .getByRole('button', { name: 'Expand Vibration & pressure', exact: true })
    .click();
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await ready(page);
  await expect(
    page.getByRole('button', { name: 'Scatter', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Histogram', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sci-expanded')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Select', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Filter to selection', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await linkedCount(page, 12000, false);
  await usableLayout(page);
});

test('live data starts automatically and loops while retaining the viewport', async ({
  page,
}) => {
  await page.goto('/scientific-explorer');
  await ready(page);
  await page.getByRole('button', { name: 'Live data', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Pause replay', exact: true }),
  ).toBeVisible();
  await chooseTool(page, 'Zoom');
  await brush(page, 'timeline', [0.2, 0.1], [0.8, 0.9], 'left');
  const host = page.getByTestId('explorer-timeline').locator('.sci-chart-host');
  const viewport = await host.getAttribute('data-viewport');
  await expect(page.getByTestId('stream-status')).toContainText('Loop 2', {
    timeout: 60000,
  });
  await page.getByRole('button', { name: 'Pause replay', exact: true }).click();
  await expect(host).toHaveAttribute('data-viewport', viewport!);
});
