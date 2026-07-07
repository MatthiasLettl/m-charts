import assert from 'node:assert/strict';

import {
  DEFAULT_FAST_SCATTER_HEATMAP_BIN_SIZE_PX,
  DEFAULT_FAST_SCATTER_VISUALIZATION_MODE,
  FAST_SCATTER_HEATMAP_BIN_SIZE_PARAM,
  FAST_SCATTER_VISUALIZATION_PARAM,
  formatHeatmapBinSizeSearchParam,
  formatFastScatterVisualizationMode,
  normalizeHeatmapBinSizePx,
  normalizeFastScatterVisualizationMode,
  parseFastScatterVisualizationMode,
  parseHeatmapBinSizeSearchParam,
} from '../../apps/demo/src/state/viewSearchParams.ts';

assert.equal(
  parseFastScatterVisualizationMode(new URLSearchParams()),
  DEFAULT_FAST_SCATTER_VISUALIZATION_MODE,
);
assert.equal(
  parseFastScatterVisualizationMode(
    new URLSearchParams(`${FAST_SCATTER_VISUALIZATION_PARAM}=bubble`),
  ),
  'bubble',
);
assert.equal(
  parseFastScatterVisualizationMode(
    new URLSearchParams(`${FAST_SCATTER_VISUALIZATION_PARAM}=heatmap`),
  ),
  'heatmap',
);
assert.equal(
  parseFastScatterVisualizationMode(
    new URLSearchParams(`${FAST_SCATTER_VISUALIZATION_PARAM}=invalid`),
  ),
  DEFAULT_FAST_SCATTER_VISUALIZATION_MODE,
);
assert.equal(formatFastScatterVisualizationMode('heatmap'), 'heatmap');
assert.equal(
  normalizeFastScatterVisualizationMode('invalid'),
  DEFAULT_FAST_SCATTER_VISUALIZATION_MODE,
);

assert.equal(
  parseHeatmapBinSizeSearchParam(new URLSearchParams()),
  DEFAULT_FAST_SCATTER_HEATMAP_BIN_SIZE_PX,
);
assert.equal(
  parseHeatmapBinSizeSearchParam(
    new URLSearchParams(`${FAST_SCATTER_HEATMAP_BIN_SIZE_PARAM}=16`),
  ),
  16,
);
assert.equal(
  parseHeatmapBinSizeSearchParam(
    new URLSearchParams(`${FAST_SCATTER_HEATMAP_BIN_SIZE_PARAM}=2`),
  ),
  4,
);
assert.equal(
  parseHeatmapBinSizeSearchParam(
    new URLSearchParams(`${FAST_SCATTER_HEATMAP_BIN_SIZE_PARAM}=72`),
  ),
  64,
);
assert.equal(
  parseHeatmapBinSizeSearchParam(
    new URLSearchParams(`${FAST_SCATTER_HEATMAP_BIN_SIZE_PARAM}=invalid`),
  ),
  DEFAULT_FAST_SCATTER_HEATMAP_BIN_SIZE_PX,
);
assert.equal(formatHeatmapBinSizeSearchParam(2), '4');
assert.equal(formatHeatmapBinSizeSearchParam(72), '64');
assert.equal(normalizeHeatmapBinSizePx(12.6), 13);
assert.equal(
  normalizeHeatmapBinSizePx(''),
  DEFAULT_FAST_SCATTER_HEATMAP_BIN_SIZE_PX,
);

console.log('scatter-fast view search param tests passed');
