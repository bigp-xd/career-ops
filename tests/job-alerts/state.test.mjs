// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadProcessed, saveProcessed, defaultStatePath } from '../../plugins/job-alerts/state.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'job-alerts-state-'));

test('round-trips ids and creates the data directory', () => {
  const file = path.join(tmp(), 'data', 'job-alerts-state.json');
  saveProcessed(file, new Set(['a', 'b']));
  assert.deepEqual([...loadProcessed(file)], ['a', 'b']);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { processed_message_ids: ['a', 'b'] });
});

test('a missing or corrupt file means nothing processed yet', () => {
  const dir = tmp();
  assert.equal(loadProcessed(path.join(dir, 'nope.json')).size, 0);
  const bad = path.join(dir, 'bad.json');
  writeFileSync(bad, '{not json');
  assert.equal(loadProcessed(bad).size, 0);
});

test('keeps only the newest ids past the cap', () => {
  const file = path.join(tmp(), 'state.json');
  saveProcessed(file, new Set(['1', '2', '3', '4']), 2);
  assert.deepEqual([...loadProcessed(file)], ['3', '4']);
});

test('the default path is under the data root', () => {
  assert.match(defaultStatePath(), /[\\/]data[\\/]job-alerts-state\.json$/);
});
