import assert from 'node:assert/strict';

import {
  createScatterWebgpuDatasetGenerator,
  SCATTER_WEBGPU_DATASET_FORMAT_VERSION,
} from '../../apps/demo/src/data/scatterWebgpuDatasetFormat.ts';

function generate(count: number, pageSize: number) {
  const generator = createScatterWebgpuDatasetGenerator({ count, pageSize, seed: 1 });
  const pages = Array.from({ length: generator.pageCount }, () =>
    generator.createNextPage(),
  );
  return { manifest: generator.createManifest(), pages };
}

const first = generate(29, 7);
const second = generate(29, 7);

assert.equal(first.manifest.version, SCATTER_WEBGPU_DATASET_FORMAT_VERSION);
assert.equal(first.manifest.pages.length, 5);
assert.equal(first.manifest.count, 29);
assert.equal(first.manifest.styleStrideBytes, 4);
assert.deepEqual(first.manifest, second.manifest);

for (let index = 0; index < first.pages.length; index += 1) {
  const firstPage = first.pages[index];
  const secondPage = second.pages[index];
  assert.ok(firstPage !== null && secondPage !== null);
  assert.deepEqual(
    new Uint8Array(firstPage.coordinateBuffer),
    new Uint8Array(secondPage.coordinateBuffer),
  );
  assert.deepEqual(
    new Uint8Array(firstPage.styleBuffer),
    new Uint8Array(secondPage.styleBuffer),
  );
  assert.equal(firstPage.coordinateBuffer.byteLength, firstPage.manifest.count * 4);
  assert.equal(firstPage.styleBuffer.byteLength, firstPage.manifest.count * 4);
}

assert.equal(first.manifest.domains.timestampNs?.max, 26);
assert.throws(
  () => createScatterWebgpuDatasetGenerator({ count: 10, pageSize: 4 }).createManifest(),
  /before all 3 pages/u,
);

console.log('scatter WebGPU shared dataset format tests passed');
