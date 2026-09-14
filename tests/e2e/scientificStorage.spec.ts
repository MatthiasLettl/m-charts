import { expect, test, type Page } from '@playwright/test';

async function storedExperiment(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('m-charts-scientific-explorer', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{
        createdAt: number;
        count: number;
        first: unknown;
      }>((resolve, reject) => {
        const transaction = database.transaction('experiments');
        const request = transaction.objectStore('experiments').getAll();
        transaction.oncomplete = () => {
          const record = request.result[0];
          resolve({
            createdAt: record.createdAt,
            count: record.readings.length,
            first: record.readings[0],
          });
        };
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  });
}

test('experiment generates locally, persists, restores, and regenerates without dataset requests', async ({
  page,
}) => {
  const datasetRequests: string[] = [];
  await page.route(/^https?:\/\/[^/]+\/(api|data)\//, (route) => {
    datasetRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto('/scientific-explorer');
  await page
    .getByRole('button', { name: 'For developers', exact: true })
    .click();
  const status = page.getByTestId('experiment-storage');
  await expect(status).toHaveAttribute('data-storage', 'indexeddb');
  await expect(status).toHaveAttribute('data-source', 'generated');
  const initial = await storedExperiment(page);
  expect(initial.count).toBe(12000);
  await page.getByRole('button', { name: /Heat spike/ }).click();
  await expect(page.getByTestId('matching-count')).toHaveText('600');
  await page.reload();
  await page
    .getByRole('button', { name: 'For developers', exact: true })
    .click();
  await expect(status).toHaveAttribute('data-source', 'restored');
  expect(await storedExperiment(page)).toEqual(initial);
  await expect(page.getByTestId('matching-count')).toHaveText('12,000');
  await status.click();
  await expect(page.getByRole('dialog')).toContainText(
    'reused on your next visit',
  );
  await page.getByRole('button', { name: 'Regenerate on this device' }).click();
  await page
    .getByRole('button', { name: 'For developers', exact: true })
    .click();
  await expect(status).toHaveAttribute('data-source', 'generated');
  const regenerated = await storedExperiment(page);
  expect(regenerated.createdAt).toBeGreaterThan(initial.createdAt);
  expect(regenerated.first).toEqual(initial.first);
  expect(regenerated.count).toBe(initial.count);
  await page.reload();
  await page
    .getByRole('button', { name: 'For developers', exact: true })
    .click();
  await expect(status).toHaveAttribute('data-source', 'restored');
  expect((await storedExperiment(page)).createdAt).toBe(regenerated.createdAt);
  expect(datasetRequests).toEqual([]);
});

test('invalid cached experiment is regenerated and repaired locally', async ({
  page,
}) => {
  await page.goto('/scientific-explorer');
  await page
    .getByRole('button', { name: 'For developers', exact: true })
    .click();
  await expect(page.getByTestId('experiment-storage')).toHaveAttribute(
    'data-storage',
    'indexeddb',
  );
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('m-charts-scientific-explorer', 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('experiments', 'readwrite');
      const store = transaction.objectStore('experiments');
      const request = store.getAll();
      request.onsuccess = () =>
        store.put({ ...request.result[0], readings: [] });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await page
    .getByRole('button', { name: 'For developers', exact: true })
    .click();
  await expect(page.getByTestId('experiment-storage')).toHaveAttribute(
    'data-source',
    'generated',
  );
  expect((await storedExperiment(page)).count).toBe(12000);
});

for (const failure of ['unavailable', 'quota'] as const) {
  test(`storage ${failure} keeps generation and filtering local and usable`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((failure) => {
      if (failure === 'unavailable')
        Object.defineProperty(window, 'indexedDB', {
          get() {
            throw new DOMException('Storage denied', 'SecurityError');
          },
        });
      else
        IDBObjectStore.prototype.put = () => {
          throw new DOMException('Storage full', 'QuotaExceededError');
        };
    }, failure);
    await page.goto('/scientific-explorer');
    await page
      .getByRole('button', { name: 'For developers', exact: true })
      .click();
    const status = page.getByTestId('experiment-storage');
    await expect(status).toHaveAttribute('data-storage', 'memory');
    await expect(page.getByTestId('matching-count')).toHaveText('12,000');
    await page.getByRole('button', { name: /Heat spike/ }).click();
    await expect(page.getByTestId('matching-count')).toHaveText('600');
    await status.click();
    await expect(page.getByRole('dialog')).toContainText('unavailable or full');
    await page
      .getByRole('button', { name: 'Regenerate on this device' })
      .click();
    await page
      .getByRole('button', { name: 'For developers', exact: true })
      .click();
    await expect(status).toHaveAttribute('data-storage', 'memory');
    await expect(page.getByTestId('matching-count')).toHaveText('12,000');
    expect(errors).toEqual([]);
  });
}
