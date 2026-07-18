import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = resolve(root, 'packages/m-charts-wasm/Cargo.toml');
const rustupCargo = resolve(homedir(), '.cargo/bin/cargo');
const cargo = existsSync(rustupCargo) ? rustupCargo : 'cargo';

execFileSync(cargo, ['fmt', '--manifest-path', manifest, '--check'], {
  cwd: root,
  stdio: 'inherit',
});
execFileSync(cargo, [
  'clippy',
  '--manifest-path',
  manifest,
  '--target',
  'wasm32-unknown-unknown',
  '--release',
  '--',
  '-D',
  'warnings',
], { cwd: root, stdio: 'inherit' });
