import assert from 'node:assert/strict';

import {
  loadParallelDatasetWithMetrics,
  loadScatterDatasetWithMetrics,
} from '../../apps/demo/src/data/loadDataset.ts';
import type { ParallelDataset, ScatterDataset } from '../../apps/demo/src/data/types.ts';

const originalFetch = globalThis.fetch;

const validDataset: ScatterDataset = {
  metadata: {
    attributes: {
      category: 'category',
      color: 'color',
      id: 'id',
      opacity: 'opacity',
      rotation: 'rotation',
      shape: 'shape',
      size: 'size',
      styleGroup: 'styleGroup',
      x: 'x',
      y: ['a', 'b', 'c'],
    },
    categories: ['core', 'north', 'south', 'anomaly'],
    count: 2,
    createdAt: '2024-01-01T00:00:00.000Z',
    seed: 1,
    styleGroups: ['default', 'accent', 'muted', 'highlight', 'low-opacity', 'large'],
    styles: {
      color: {
        attribute: 'color',
        format: '#RRGGBB',
      },
      opacity: {
        attribute: 'opacity',
        max: 1,
        min: 0,
      },
      rotation: {
        attribute: 'rotation',
        max: 360,
        min: 0,
        nullable: true,
        unit: 'degrees',
      },
      shape: {
        attribute: 'shape',
        values: ['circle', 'rectangle', 'triangle', 'pin', 'arrow'],
      },
      size: {
        attribute: 'size',
        max: 24,
        min: 0,
        unit: 'point-size',
      },
    },
  },
  records: [
    {
      a: 10,
      b: 20,
      c: 30,
      category: 'core',
      color: '#2563EB',
      id: 'pt-000000',
      opacity: 0,
      rotation: 0,
      shape: 'circle',
      size: 0,
      styleGroup: 'default',
      x: 0,
    },
    {
      a: 11,
      b: 21,
      c: 31,
      category: 'north',
      color: '#059669',
      id: 'pt-000001',
      opacity: 1,
      rotation: 360,
      shape: 'rectangle',
      size: 24,
      styleGroup: 'accent',
      x: 1,
    },
  ],
};

const validParallelDataset: ParallelDataset = {
  metadata: {
    attributes: {
      id: 'id',
      parameters: ['throughput', 'latency', 'errorRate', 'cpuLoad', 'memoryUsage'],
    },
    count: 2,
    createdAt: '2024-01-01T00:00:00.000Z',
    seed: 1,
  },
  records: [
    {
      id: 'pc-000000',
      throughput: 420,
      latency: 48,
      errorRate: 0.2,
      cpuLoad: 68,
      memoryUsage: 54,
    },
    {
      id: 'pc-000001',
      throughput: 440,
      latency: 45,
      errorRate: 0.18,
      cpuLoad: 71,
      memoryUsage: 58,
    },
  ],
};

try {
  let requestedUrl: unknown = null;
  let requestedAccept: unknown = null;

  installJsonFetch(validDataset, 200, (input, init) => {
    requestedUrl = input;
    requestedAccept = (init?.headers as Record<string, string> | undefined)?.Accept;
  });

  const result = await loadScatterDatasetWithMetrics('/custom-dataset.json');
  assert.deepEqual(result.dataset, validDataset);
  assert.equal(requestedUrl, '/custom-dataset.json');
  assert.equal(requestedAccept, 'application/json');
  assert.equal(typeof result.metrics.fetchMs, 'number');
  assert.equal(typeof result.metrics.parseMs, 'number');

  installJsonFetch(validDataset, 404);
  await assert.rejects(
    () => loadScatterDatasetWithMetrics('/missing.json'),
    /Sample dataset not found at \/missing\.json/,
  );

  installJsonFetch(
    {
      ...validDataset,
      metadata: {
        ...validDataset.metadata,
        count: 3,
      },
    },
    200,
  );
  await assert.rejects(
    () => loadScatterDatasetWithMetrics('/bad-count.json'),
    /reports 3 records but contains 2/,
  );

  installJsonFetch(
    {
      ...validDataset,
      records: [
        {
          ...validDataset.records[0],
          x: Number.NaN,
        },
      ],
      metadata: {
        ...validDataset.metadata,
        count: 1,
      },
    },
    200,
  );
  await assert.rejects(
    () => loadScatterDatasetWithMetrics('/bad-record.json'),
    /invalid x at record index 0; expected finite number/,
  );

  installJsonFetch(
    {
      ...validDataset,
      records: [
        {
          ...validDataset.records[0],
          x: 2,
        },
        {
          ...validDataset.records[1],
          x: 1,
        },
      ],
    },
    200,
  );
  await assert.rejects(
    () => loadScatterDatasetWithMetrics('/unsorted-x.json'),
    /must be sorted by nondecreasing x; record index 1 has x 1 after 2/,
  );

  installJsonFetch(
    {
      ...validDataset,
      records: [
        {
          ...validDataset.records[0],
          category: 'unknown-category',
        },
      ],
      metadata: {
        ...validDataset.metadata,
        count: 1,
      },
    },
    200,
  );
  await assert.rejects(
    () => loadScatterDatasetWithMetrics('/bad-category.json'),
    /unknown category "unknown-category" at record index 0/,
  );

  installJsonFetch(
    {
      ...validDataset,
      records: [
        {
          ...validDataset.records[0],
          styleGroup: 'unknown-style',
        },
      ],
      metadata: {
        ...validDataset.metadata,
        count: 1,
      },
    },
    200,
  );
  await assert.rejects(
    () => loadScatterDatasetWithMetrics('/bad-style-group.json'),
    /unknown styleGroup "unknown-style" at record index 0/,
  );

  installJsonFetch(
    {
      ...validDataset,
      records: [
        {
          ...validDataset.records[0],
          color: 'red',
        },
      ],
      metadata: {
        ...validDataset.metadata,
        count: 1,
      },
    },
    200,
  );
  await assert.rejects(
    () => loadScatterDatasetWithMetrics('/bad-color.json'),
    /invalid color "red" at record index 0; expected #RRGGBB/,
  );

  installJsonFetch(
    {
      ...validDataset,
      records: [
        {
          ...validDataset.records[0],
          opacity: -0.1,
        },
      ],
      metadata: {
        ...validDataset.metadata,
        count: 1,
      },
    },
    200,
  );
  await assert.rejects(
    () => loadScatterDatasetWithMetrics('/bad-opacity.json'),
    /invalid opacity -0.1 at record index 0; expected 0 to 1/,
  );

  installJsonFetch(
    {
      ...validDataset,
      records: [
        {
          ...validDataset.records[0],
          size: 25,
        },
      ],
      metadata: {
        ...validDataset.metadata,
        count: 1,
      },
    },
    200,
  );
  await assert.rejects(
    () => loadScatterDatasetWithMetrics('/bad-size.json'),
    /invalid size 25 at record index 0; expected 0 to 24/,
  );

  installJsonFetch(
    {
      ...validDataset,
      records: [
        {
          ...validDataset.records[0],
          rotation: 361,
        },
      ],
      metadata: {
        ...validDataset.metadata,
        count: 1,
      },
    },
    200,
  );
  await assert.rejects(
    () => loadScatterDatasetWithMetrics('/bad-rotation.json'),
    /invalid rotation 361 at record index 0; expected null or 0 to 360 degrees/,
  );

  installJsonFetch(
    {
      ...validDataset,
      records: [
        {
          ...validDataset.records[0],
          rotation: null,
        },
      ],
      metadata: {
        ...validDataset.metadata,
        count: 1,
      },
    },
    200,
  );
  assert.equal(
    (await loadScatterDatasetWithMetrics('/nullable-rotation.json')).dataset.records[0]
      ?.rotation,
    null,
  );

  installJsonFetch(
    {
      ...validDataset,
      records: [
        {
          ...validDataset.records[0],
          shape: 'star',
        },
      ],
      metadata: {
        ...validDataset.metadata,
        count: 1,
      },
    },
    200,
  );
  await assert.rejects(
    () => loadScatterDatasetWithMetrics('/bad-shape.json'),
    /unknown shape "star" at record index 0/,
  );

  installJsonFetch(validParallelDataset, 200, (input, init) => {
    requestedUrl = input;
    requestedAccept = (init?.headers as Record<string, string> | undefined)?.Accept;
  });

  const parallelResult = await loadParallelDatasetWithMetrics('/parallel.json');
  assert.deepEqual(parallelResult.dataset, validParallelDataset);
  assert.equal(requestedUrl, '/parallel.json');
  assert.equal(requestedAccept, 'application/json');
  assert.equal(typeof parallelResult.metrics.fetchMs, 'number');
  assert.equal(typeof parallelResult.metrics.parseMs, 'number');

  const dynamicParallelDataset = {
    metadata: {
      ...validParallelDataset.metadata,
      attributes: {
        id: 'id',
        parameters: ['alpha', 'beta', 'gamma'],
      },
      count: 2,
    },
    records: [
      { alpha: 1, beta: 2, gamma: 3, id: 'dyn-1' },
      { alpha: 4, beta: 5, gamma: 6, id: 'dyn-2' },
    ],
  };
  installJsonFetch(dynamicParallelDataset, 200);
  assert.deepEqual(
    (await loadParallelDatasetWithMetrics('/parallel-dynamic.json')).dataset,
    dynamicParallelDataset,
  );

  const preselectedParallelDataset = {
    ...validParallelDataset,
    records: [
      { ...validParallelDataset.records[0], selected: true },
      validParallelDataset.records[1],
    ],
  };
  installJsonFetch(preselectedParallelDataset, 200);
  assert.deepEqual(
    (await loadParallelDatasetWithMetrics('/parallel-preselected.json')).dataset,
    preselectedParallelDataset,
  );

  installJsonFetch(validParallelDataset, 404);
  await assert.rejects(
    () => loadParallelDatasetWithMetrics('/missing-parallel.json'),
    /Parallel dataset not found at \/missing-parallel\.json/,
  );

  installJsonFetch(
    {
      ...validParallelDataset,
      metadata: {
        ...validParallelDataset.metadata,
        count: 3,
      },
    },
    200,
  );
  await assert.rejects(
    () => loadParallelDatasetWithMetrics('/parallel-bad-count.json'),
    /reports 3 records but contains 2/,
  );

  installJsonFetch(
    {
      ...validParallelDataset,
      records: [
        {
          ...validParallelDataset.records[0],
          id: '',
        },
      ],
      metadata: {
        ...validParallelDataset.metadata,
        count: 1,
      },
    },
    200,
  );
  await assert.rejects(
    () => loadParallelDatasetWithMetrics('/parallel-bad-id.json'),
    /invalid id at record index 0; expected non-empty string/,
  );

  installJsonFetch(
    {
      ...validParallelDataset,
      records: [
        validParallelDataset.records[0],
        {
          ...validParallelDataset.records[1],
          id: validParallelDataset.records[0].id,
        },
      ],
    },
    200,
  );
  await assert.rejects(
    () => loadParallelDatasetWithMetrics('/parallel-duplicate-id.json'),
    /duplicate id "pc-000000" at record index 1/,
  );

  installJsonFetch(
    {
      ...validParallelDataset,
      records: [
        {
          ...validParallelDataset.records[0],
          errorRate: Number.NaN,
        },
      ],
      metadata: {
        ...validParallelDataset.metadata,
        count: 1,
      },
    },
    200,
  );
  await assert.rejects(
    () => loadParallelDatasetWithMetrics('/parallel-bad-record.json'),
    /invalid errorRate at record index 0; expected finite number/,
  );

  installJsonFetch(
    {
      ...validParallelDataset,
      records: [
        {
          ...validParallelDataset.records[0],
          selected: 'yes',
        },
      ],
      metadata: {
        ...validParallelDataset.metadata,
        count: 1,
      },
    },
    200,
  );
  await assert.rejects(
    () => loadParallelDatasetWithMetrics('/parallel-bad-selected.json'),
    /invalid selected at record index 0; expected boolean when present/,
  );

  installJsonFetch(
    {
      ...validParallelDataset,
      metadata: {
        ...validParallelDataset.metadata,
        attributes: {
          ...validParallelDataset.metadata.attributes,
          parameters: ['latency', 'latency'],
        },
      },
    },
    200,
  );
  await assert.rejects(
    () => loadParallelDatasetWithMetrics('/parallel-bad-parameters.json'),
    /invalid metadata\.attributes\.parameters/,
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('loadDataset tests passed');

function installJsonFetch(
  payload: unknown,
  status: number,
  inspectRequest?: (input: unknown, init: RequestInit | undefined) => void,
): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    inspectRequest?.(input, init);

    return new Response(JSON.stringify(payload), {
      status,
    });
  }) as typeof fetch;
}
