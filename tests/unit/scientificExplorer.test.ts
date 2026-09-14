import assert from 'node:assert/strict';
import { selectFastScatterSourceIndicesInBounds } from 'm-charts/m-scatter';
import { createSensorParallelBuffers } from '../../apps/demo/src/routes/scientific/parallelModel.ts';
import {
  createSensorReadings,
  createSensorXOrder,
  filterReadings,
  initialFilters,
  matchesRanges,
  summarizeReadings,
  type ExplorerFilters,
} from '../../apps/demo/src/routes/scientific/sensorModel.ts';

const readings = createSensorReadings();
assert.equal(readings.length, 12000);
assert.deepEqual(
  readings,
  createSensorReadings(),
  'The experiment is repeatable across visits.',
);
assert.equal(new Set(readings.map((row) => row.id)).size, readings.length);
assert.equal(filterReadings(readings, initialFilters()).length, 12000);
const heat: ExplorerFilters = {
  sensors: [1],
  anomalyOnly: false,
  views: { timeline: { time: [{ min: 48, max: 66 }] } },
};
const heatRows = filterReadings(readings, heat);
assert.equal(heatRows.length, 600);
assert.ok(heatRows.every((row) => row.anomaly === 'heat'));
const narrowed = filterReadings(readings, {
  ...heat,
  views: {
    ...heat.views,
    histogram: { temperature: [{ min: 35, max: 40 }] },
    parallel: { vibration: [{ min: 4, max: 6 }] },
  },
});
assert.ok(narrowed.length > 0 && narrowed.length < heatRows.length);
assert.deepEqual(
  narrowed,
  readings.filter(
    (row) =>
      row.sensor === 1 &&
      row.time >= 48 &&
      row.time <= 66 &&
      row.temperature >= 35 &&
      row.temperature <= 40 &&
      row.vibration >= 4 &&
      row.vibration <= 6,
  ),
);
assert.ok(
  narrowed.every((row) => readings[row.sourceIndex] === row),
  'Filtering preserves global identities, including isolate mode.',
);
assert.equal(filterReadings(readings, { ...heat, sensors: [] }).length, 0);
assert.equal(
  filterReadings(readings, {
    ...heat,
    views: {
      ...heat.views,
      histogram: { temperature: [{ min: 18, max: 19 }] },
    },
  }).length,
  0,
);
assert.deepEqual(summarizeReadings([]), {
  count: 0,
  anomalies: 0,
  temperature: null,
  pressure: null,
});
const boundary = { ...readings[0], temperature: 30, pressure: 110 };
assert.ok(
  matchesRanges(boundary, { temperature: [{ min: 30, max: 30 }] }),
  'Range bounds are inclusive.',
);
assert.ok(
  matchesRanges(boundary, { temperature: [{ min: 31, max: 29 }] }),
  'Reverse drags are normalized.',
);
assert.ok(
  matchesRanges(boundary, {
    temperature: [
      { min: 18, max: 20 },
      { min: 29, max: 31 },
    ],
    pressure: [{ min: 109, max: 111 }],
  }),
);
assert.ok(
  !matchesRanges(boundary, {
    temperature: [{ min: 29, max: 31 }],
    pressure: [{ min: 115, max: 120 }],
  }),
);
assert.equal(
  filterReadings(readings, { ...initialFilters(), anomalyOnly: true }).length,
  1667,
);

// Validate actual GPU input coordinates, not just labels or state metadata.
const buffers = createSensorParallelBuffers(
  heatRows,
  new Uint8Array(heatRows.length * 4).fill(255),
);
assert.deepEqual(buffers.domainsByAxis.temperature, {
  min: 18,
  max: 46,
  span: 28,
});
for (const index of [0, 200, 599]) {
  assert.ok(
    Math.abs(
      buffers.rawValuesByAxis.temperature[index] - heatRows[index].temperature,
    ) < 0.00001,
  );
  const expected = (heatRows[index].temperature - 18) / 28;
  assert.ok(
    Math.abs(buffers.normalizedValuesByAxis.temperature[index] - expected) <
      0.00001,
  );
}
assert.equal(
  buffers.webglSegmentBuffers,
  undefined,
  'WebGPU does not allocate WebGL segment buffers.',
);
const selected = filterReadings(readings, {
  ...heat,
  selections: {
    scatter: new Set(heatRows.slice(0, 30).map((row) => row.sourceIndex)),
    histogram: new Set(heatRows.slice(10, 50).map((row) => row.sourceIndex)),
  },
});
assert.deepEqual(
  selected,
  heatRows.slice(10, 30),
  'Native selections intersect by global identity.',
);
assert.equal(
  filterReadings(readings, {
    ...initialFilters(),
    selections: { scatter: new Set() },
  }).length,
  0,
  'An empty native selection remains an active filter.',
);
console.log(
  'Scientific explorer filters, exact selections, and GPU coordinate domains passed.',
);

const temperatures = Float32Array.from(readings, (row) => row.temperature);
const pressureValues = Float32Array.from(readings, (row) => row.pressure);
const exactIds = selectFastScatterSourceIndicesInBounds(
  {
    x: temperatures,
    xOrder: createSensorXOrder(temperatures),
    y: { pressure: pressureValues },
    sourceIndex: Uint32Array.from(readings, (row) => row.sourceIndex),
  },
  { x: { min: 35, max: 40 }, y: { min: 100, max: 112 }, yKey: 'pressure' },
);
assert.deepEqual(
  Array.from(exactIds),
  readings
    .filter(
      (row) =>
        row.temperature >= 35 &&
        row.temperature <= 40 &&
        row.pressure >= 100 &&
        row.pressure <= 112,
    )
    .map((row) => row.sourceIndex),
  'Native scatter rectangle selection matches app predicates on unsorted sensor columns.',
);

// Exercise the library's real predicate evaluator, not the demo's former scan.
const { evaluateClientDataView } = await import('m-charts/client-data-view');
const { sensorClientDataset, sensorClientState } = await import(
  '../../apps/demo/src/routes/scientific/clientQuery.ts'
);
const clientDataset = sensorClientDataset(readings);
const evaluate = (
  filters: ExplorerFilters,
  available = readings.length,
  omit?: 'timeline' | 'scatter' | 'histogram',
) =>
  Array.from(
    evaluateClientDataView(
      clientDataset,
      sensorClientState(filters, available, omit),
    ).activeSourceIndices,
    (index) => readings[index],
  );
assert.deepEqual(
  evaluate(heat),
  heatRows,
  'Worker predicates preserve exact inclusive cohort semantics.',
);
assert.deepEqual(
  evaluate({
    ...heat,
    selections: {
      scatter: new Set(heatRows.slice(10, 30).map((row) => row.sourceIndex)),
    },
  }),
  heatRows.slice(10, 30),
);
assert.equal(
  evaluate(heat, 12000, 'timeline').length,
  4000,
  'The source timeline keeps its full chamber context.',
);
assert.deepEqual(
  evaluate(heat, 12000, 'histogram'),
  heatRows,
  'Other charts receive the timeline filter.',
);
assert.equal(
  evaluate(heat, 4800).length,
  0,
  'Future readings never leak into a live cohort.',
);
assert.equal(
  evaluate(heat, 5700).length,
  300,
  'A paused prefix admits only already-arrived rows.',
);
assert.equal(
  evaluate({ ...initialFilters(), selections: { scatter: new Set() } }).length,
  0,
);
const compound = {
  ...heat,
  views: { ...heat.views, histogram: { temperature: [{ min: 35, max: 40 }] } },
};
assert.deepEqual(
  evaluate(compound, 12000, 'histogram'),
  heatRows,
  'Self-exclusion lets the histogram brush widen again.',
);
assert.ok(evaluate(compound).length < heatRows.length);
assert.deepEqual(evaluate(compound), filterReadings(readings, compound));
