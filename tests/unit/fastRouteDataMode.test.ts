import assert from 'node:assert/strict';

import {
  FAST_ROUTE_TABLES_PARAM,
  formatFastRouteTableMode,
  isFastRouteMultiTableMode,
  parseFastRouteTableMode,
} from '../../apps/demo/src/data/fastRouteDataMode.ts';

assert.equal(FAST_ROUTE_TABLES_PARAM, 'tables');
assert.equal(parseFastRouteTableMode(new URLSearchParams()), 'single');
assert.equal(parseFastRouteTableMode(new URLSearchParams('tables=multi')), 'multi');
assert.equal(
  parseFastRouteTableMode(new URLSearchParams('mode=hover&theme=dark&tables=multi')),
  'multi',
);
assert.equal(parseFastRouteTableMode(new URLSearchParams('tables=single')), 'single');
assert.equal(parseFastRouteTableMode(new URLSearchParams('tables=nope')), 'single');
assert.equal(parseFastRouteTableMode(new URLSearchParams('dataMode=mixed&table=all')), 'single');
assert.equal(formatFastRouteTableMode('single'), null);
assert.equal(formatFastRouteTableMode('multi'), 'multi');
assert.equal(isFastRouteMultiTableMode('single'), false);
assert.equal(isFastRouteMultiTableMode('multi'), true);

console.log('fast route table mode tests passed');
