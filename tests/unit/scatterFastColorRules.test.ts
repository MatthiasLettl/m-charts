import assert from 'node:assert/strict';

import type { FastScatterDisplayColumns } from '../../packages/m-charts/src/m-scatter/core/index.ts';
import { applyScatterColorRules } from '../../packages/m-charts/src/m-scatter/react/colorRules.ts';

const columns: FastScatterDisplayColumns = {
  color: new Uint8Array([
    10, 10, 10, 255,
    20, 20, 20, 255,
    30, 30, 30, 255,
    40, 40, 40, 255,
  ]),
  colorFormat: 'rgba8',
  ids: ['a', 'b', 'c', 'd'],
  sourceIndex: new Uint32Array([0, 1, 2, 3]),
  x: new Float32Array([0, 1, 2, 3]),
  y: {
    y: new Float32Array([0, 1, 2, 3]),
  },
};

const fixed = applyScatterColorRules(columns, [
  {
    color: '#ff0000',
    id: 'fixed',
    kind: 'fixed',
    parameterKey: 'y',
    range: { max: 2, min: 1 },
  },
]);

assert.notEqual(fixed, columns);
assert.notEqual(fixed.color, columns.color);
assert.deepEqual([...(fixed.color ?? [])], [
  10, 10, 10, 255,
  255, 0, 0, 255,
  255, 0, 0, 255,
  40, 40, 40, 255,
]);
assert.deepEqual([...(columns.color ?? [])].slice(4, 12), [
  20, 20, 20, 255,
  30, 30, 30, 255,
]);

const gradient = applyScatterColorRules(columns, [
  {
    endColor: '#ffffff',
    id: 'gradient',
    kind: 'gradient',
    parameterKey: 'y',
    range: { max: 3, min: 1 },
    startColor: '#000000',
  },
]);

assert.deepEqual([...(gradient.color ?? [])], [
  10, 10, 10, 255,
  0, 0, 0, 255,
  128, 128, 128, 255,
  255, 255, 255, 255,
]);

console.log('scatter-fast color rule tests passed');
