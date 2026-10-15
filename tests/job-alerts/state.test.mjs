// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadState, saveState, defaultStatePath } from '../../plugins/job-alerts/state.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'job-alerts-state-'));

test('round-trips ids and creates the data directory', () => {
  const file = path.join(tmp(), 'data', 'job-alerts-state.json');
  saveState(file, { processed: new Set(['a', 'b']), emitted: new Set(['url:x']) });
  const state = loadState(file);
  assert.deepEqual([...state.processed], ['a', 'b']);
  assert.deepEqual([...state.emitted], ['url:x']);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { processed_message_ids: ['a', 'b'], emitted_keys: ['url:x'] });
});

test('a missing or corrupt file means nothing processed yet', () => {
  const dir = tmp();
  assert.equal(loadState(path.join(dir, 'nope.json')).processed.size, 0);
  const bad = path.join(dir, 'bad.json');
  writeFileSync(bad, '{not json');
  assert.equal(loadState(bad).processed.size, 0);
  assert.equal(loadState(bad).emitted.size, 0);
});

test('keeps only the newest ids past the cap', () => {
  const file = path.join(tmp(), 'state.json');
  saveState(file, { processed: new Set(['1', '2', '3', '4']), emitted: new Set(['a', 'b', 'c']) }, 2);
  assert.deepEqual([...loadState(file).processed], ['3', '4']);
  assert.deepEqual([...loadState(file).emitted], ['b', 'c']);
});

test('the default path is under the data root', () => {
  assert.match(defaultStatePath(), /[\\/]data[\\/]job-alerts-state\.json$/);
});

test('a state file written before emitted keys existed still loads', () => {
  const file = path.join(tmp(), 'old.json');
  writeFileSync(file, JSON.stringify({ processed_message_ids: ['m1'] }));
  const state = loadState(file);
  assert.deepEqual([...state.processed], ['m1']);
  assert.equal(state.emitted.size, 0);
});
