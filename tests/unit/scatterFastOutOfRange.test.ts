import assert from 'node:assert/strict';

import {
  computeFastScatterOutOfRangeMarkers,
  type FastScatterOutOfRangeMarker,
  type FastScatterPlotRect,
  type FastScatterPlotSpec,
  type FastScatterPointColumns,
  type FastScatterViewport,
} from '../../packages/m-charts/src/m-scatter/core/index.ts';

const spec: FastScatterPlotSpec = {
  xLabel: 'encoded x',
  plots: [{ id: 'main', label: 'Metric', yKey: 'metric' }],
};

const rect: FastScatterPlotRect = {
  heightCssPx: 100,
  id: 'main',
  widthCssPx: 200,
  xCssPx: 10,
  yCssPx: 20,
};

const viewport: FastScatterViewport = {
  x: { min: 0, max: 100 },
  yByPlot: {
    main: { min: 0, max: 10 },
  },
};

{
  const result = computeFastScatterOutOfRangeMarkers({
    columns: columns([10, 20, 90], [11, -1, 5], [101, 102, 103]),
    minBinSizeCssPx: 50,
    plotRects: [rect],
    spec,
    viewport,
  });

  assert.equal(result.candidateCount, 2);
  assert.equal(result.markerCount, 2);
  assert.equal(result.durationMs >= 0, true);
  assertMarker(result.markers[0], {
    axis: 'y',
    count: 1,
    plotId: 'main',
    side: 'top',
    sourceIndex: 101,
    xCssPx: 35,
    yCssPx: 26,
  });
  assertMarker(result.markers[1], {
    axis: 'y',
    count: 1,
    plotId: 'main',
    side: 'bottom',
    sourceIndex: 102,
    xCssPx: 35,
    yCssPx: 114,
  });
}

{
  const result = computeFastScatterOutOfRangeMarkers({
    columns: columns([-2, 102, 50], [2, 8, 5]),
    minBinSizeCssPx: 50,
    plotRects: [rect],
    spec,
    viewport,
  });

  assert.equal(result.candidateCount, 2);
  assert.equal(result.markerCount, 2);
  assertMarker(result.markers[0], {
    axis: 'x',
    count: 1,
    plotId: 'main',
    side: 'left',
    sourceIndex: 0,
    xCssPx: 16,
    yCssPx: 95,
  });
  assertMarker(result.markers[1], {
    axis: 'x',
    count: 1,
    plotId: 'main',
    side: 'right',
    sourceIndex: 1,
    xCssPx: 204,
    yCssPx: 45,
  });
}

{
  const result = computeFastScatterOutOfRangeMarkers({
    columns: columns([5, 6, 7, 55, 85, 95], [11, 12, 30, -2, 40, 50], [
      10, 11, 12, 13, 14, 15,
    ]),
    maxMarkersPerSide: 2,
    minBinSizeCssPx: 50,
    plotRects: [rect],
    spec,
    viewport,
  });

  assert.equal(result.candidateCount, 6);
  assert.equal(result.markerCount, 3);
  assert.deepEqual(
    result.markers.map((marker) => [marker.side, marker.count, marker.sourceIndex]),
    [
      ['top', 3, 10],
      ['top', 2, 14],
      ['bottom', 1, 13],
    ],
  );
}

{
  const result = computeFastScatterOutOfRangeMarkers({
    columns: columns([0, 1, 2], [0, 5, 10]),
    plotRects: [rect],
    spec,
    viewport,
  });

  assert.equal(result.candidateCount, 0);
  assert.equal(result.markerCount, 0);
  assert.deepEqual(result.markers, []);
}

{
  const categoryViewport: FastScatterViewport = {
    x: { min: 0.5, max: 2.5 },
    yByPlot: {
      main: { min: 0.5, max: 1.5 },
    },
  };
  const result = computeFastScatterOutOfRangeMarkers({
    columns: columns([0, 1, 2, 3], [1, 0, 2, 1]),
    plotRects: [rect],
    spec,
    viewport: categoryViewport,
  });

  assert.deepEqual(
    result.markers.map((marker) => marker.side),
    ['top', 'bottom', 'left', 'right'],
  );
}

{
  const nsHour = 3_600_000_000_000;
  const datetimeViewport: FastScatterViewport = {
    x: { min: nsHour, max: 2 * nsHour },
    yByPlot: {
      main: { min: 0, max: 10 },
    },
  };
  const result = computeFastScatterOutOfRangeMarkers({
    columns: columns([nsHour, 2 * nsHour, 3 * nsHour], [12, 8, 5]),
    plotRects: [rect],
    spec,
    viewport: datetimeViewport,
  });

  assert.equal(result.candidateCount, 2);
  assert.deepEqual(
    result.markers.map((marker) => marker.side),
    ['top', 'right'],
  );
}

{
  const pointCount = 10_000;
  const x = new Float64Array(pointCount);
  const y = new Float32Array(pointCount);
  for (let index = 0; index < pointCount; index += 1) {
    x[index] = index % 100;
    y[index] = index % 2 === 0 ? 20 : -10;
  }

  const result = computeFastScatterOutOfRangeMarkers({
    columns: { ids: [], x, y: { metric: y } },
    maxMarkersPerSide: 3,
    minBinSizeCssPx: 10,
    plotRects: [rect],
    spec,
    viewport,
  });

  assert.equal(result.candidateCount, pointCount);
  assert.equal(result.markerCount, 6);
  assert.equal(result.markers.every((marker) => marker.count > 1), true);
}

{
  const result = computeFastScatterOutOfRangeMarkers({
    columns: columns([10, 11, 12, 13], [20, 20, 20, 20]),
    plotRects: [rect],
    sampleStride: 2,
    spec,
    viewport,
  });

  assert.equal(result.candidateCount, 4);
  assert.equal(result.markers.reduce((total, marker) => total + marker.count, 0), 4);
}

function columns(
  x: readonly number[],
  y: readonly number[],
  sourceIndex?: readonly number[],
): FastScatterPointColumns {
  return {
    ids: x.map((_, index) => `point-${index}`),
    sourceIndex: sourceIndex === undefined ? undefined : Uint32Array.from(sourceIndex),
    x: Float64Array.from(x),
    y: {
      metric: Float64Array.from(y),
    },
  };
}

function assertMarker(
  actual: FastScatterOutOfRangeMarker | undefined,
  expected: FastScatterOutOfRangeMarker,
): void {
  assert.deepEqual(actual, expected);
}
