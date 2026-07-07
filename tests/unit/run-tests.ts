import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const testFiles = (await readdir(testDir))
  .filter((file) => file.endsWith('.test.ts'))
  .sort();

for (const testFile of testFiles) {
  await import(pathToFileURL(join(testDir, testFile)).href);
}

console.log(`Ran ${testFiles.length} unit test files.`);
