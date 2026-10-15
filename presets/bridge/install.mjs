#!/usr/bin/env node
/**
 * Install the bridge-job preset into the user layer.
 *
 * Copies presets/bridge/{_profile.md,_custom.md,portals.yml} to their
 * user-layer locations under the data root. Never overwrites an existing
 * file, so it is safe to run more than once. Run it BEFORE
 * `node doctor.mjs --json --init-templates`, so doctor only fills in what
 * the preset does not cover.
 *
 *   node presets/bridge/install.mjs
 */
import { constants, copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getCareerOpsRoot } from '../../path-resolver.mjs';

const PRESET_DIR = dirname(fileURLToPath(import.meta.url));
const root = getCareerOpsRoot();

const FILES = [
  ['_profile.md', 'modes/_profile.md'],
  ['_custom.md', 'modes/_custom.md'],
  ['portals.yml', 'portals.yml'],
];

for (const [src, dest] of FILES) {
  const target = join(root, dest);
  if (existsSync(target)) {
    console.log(`kept      ${dest} (already exists)`);
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(PRESET_DIR, src), target, constants.COPYFILE_EXCL);
  console.log(`installed ${dest}`);
}
