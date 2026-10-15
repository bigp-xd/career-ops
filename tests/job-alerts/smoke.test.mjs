// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginDir = path.join(repoRoot, 'plugins', 'job-alerts');

test('manifest passes the engine validator', async () => {
  const { validateManifest } = await import(pathToFileURL(path.join(repoRoot, 'plugins', '_engine.mjs')).href);
  const manifest = JSON.parse(readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
  const valid = validateManifest(manifest, pluginDir, 'job-alerts');
  assert.ok(valid, 'validateManifest returned null — see the warning printed above');
  assert.deepEqual(valid.hooks, ['ingest']);
  assert.deepEqual(valid.allowedHosts, ['oauth2.googleapis.com', 'gmail.googleapis.com']);
});

test('entry exports exactly the declared hook', async () => {
  const mod = await import(pathToFileURL(path.join(pluginDir, 'index.mjs')).href);
  assert.deepEqual(Object.keys(mod.default), ['ingest']);
  assert.equal(typeof mod.default.ingest, 'function');
});
