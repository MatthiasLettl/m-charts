import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const manifest = resolve(root, 'packages/m-charts-wasm/Cargo.toml');
const binaryPath = resolve(
  root,
  'packages/m-charts-wasm/target/wasm32-unknown-unknown/release/m_charts_wasm.wasm',
);
const outputPath = resolve(
  root,
  'packages/m-charts/src/plot-engine-webgpu/core/aggregationWasmBinary.ts',
);

const rustupCargo = resolve(homedir(), '.cargo/bin/cargo');
execFileSync(existsSync(rustupCargo) ? rustupCargo : 'cargo', [
  'build',
  '--manifest-path',
  manifest,
  '--target',
  'wasm32-unknown-unknown',
  '--release',
], { cwd: root, stdio: 'inherit' });

const binary = readFileSync(binaryPath);
const hash = createHash('sha256').update(binary).digest('hex');
const base64 = binary.toString('base64');
const chunks = base64.match(/.{1,100}/gu) ?? [];
const source = `// Generated shared aggregation binary. Run pnpm build:aggregation-wasm; do not edit.\n` +
  `export const M_CHARTS_AGGREGATION_WASM_SHA256 = '${hash}';\n` +
  `export const M_CHARTS_AGGREGATION_WASM_BASE64 = [\n` +
  chunks.map((chunk) => `  '${chunk}',`).join('\n') +
  `\n].join('');\n` +
  `// Compatibility names retained for the existing scatter WebGPU backend.\n` +
  `export const FAST_SCATTER_AGGREGATION_WASM_SHA256 = M_CHARTS_AGGREGATION_WASM_SHA256;\n` +
  `export const FAST_SCATTER_AGGREGATION_WASM_BASE64 = M_CHARTS_AGGREGATION_WASM_BASE64;\n`;

if (check) {
  if (readFileSync(outputPath, 'utf8') !== source) {
    throw new Error('Shared aggregation WASM is stale. Run pnpm build:aggregation-wasm.');
  }
  console.log(`aggregation-wasm: verified ${binary.length} bytes (${hash})`);
} else {
  writeFileSync(outputPath, source);
  console.log(`aggregation-wasm: wrote ${binary.length} bytes (${hash})`);
}
