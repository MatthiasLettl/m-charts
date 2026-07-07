import assert from 'node:assert/strict';

import {
  createLazySingleTableRecordIdentityArray,
  createLazySingleValueArray,
  isUsableRecordIndex,
  resolveRecordIndexFromLookupPayload,
} from '../../apps/demo/src/data/identity.ts';

assert.equal(isUsableRecordIndex(0, 3), true);
assert.equal(isUsableRecordIndex(2, 3), true);
assert.equal(isUsableRecordIndex(3, 3), false);
assert.equal(isUsableRecordIndex(-1, 3), false);
assert.equal(isUsableRecordIndex(1.25, 3), false);
assert.equal(isUsableRecordIndex(Number.NaN, 3), false);

assert.equal(
  resolveRecordIndexFromLookupPayload(
    { iSample: 0, lookupValue: 2, sample: { recordIndex: 1 } },
    { recordCount: 4 },
  ),
  2,
);

assert.equal(
  resolveRecordIndexFromLookupPayload(
    { iSample: 0, sample: { recordIndex: 3 } },
    { recordCount: 4 },
  ),
  3,
);

assert.equal(
  resolveRecordIndexFromLookupPayload({ iSample: 1 }, { recordCount: 4 }),
  null,
);

assert.equal(
  resolveRecordIndexFromLookupPayload(
    { iSample: 1 },
    { allowSampleIndexFallback: true, recordCount: 4 },
  ),
  1,
);

assert.equal(
  resolveRecordIndexFromLookupPayload({ lookupValue: 4 }, { recordCount: 4 }),
  null,
);

assert.equal(
  resolveRecordIndexFromLookupPayload(
    { lookupValue: 1.5, sample: { recordIndex: 2 } },
    { recordCount: 4 },
  ),
  2,
);

const lazyTables = createLazySingleValueArray(3, 'benchmark-primary');
assert.equal(lazyTables.length, 3);
assert.deepEqual(Array.from(lazyTables), [
  'benchmark-primary',
  'benchmark-primary',
  'benchmark-primary',
]);
assert.deepEqual(lazyTables.map((table, index) => `${index}:${table}`), [
  '0:benchmark-primary',
  '1:benchmark-primary',
  '2:benchmark-primary',
]);

const lazyIdentities = createLazySingleTableRecordIdentityArray(
  ['source-alpha', 'source-bravo'],
  'benchmark-primary',
);
assert.equal(lazyIdentities.length, 2);
assert.deepEqual(lazyIdentities[0], {
  id: 'source-alpha',
  sourceIndex: 0,
  table: 'benchmark-primary',
});
assert.deepEqual(Array.from(lazyIdentities, (record) => record.id), [
  'source-alpha',
  'source-bravo',
]);

console.log('identity tests passed');
