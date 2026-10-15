// @ts-check
// What earlier runs already did: which Gmail messages were handled (so each
// alert is read once) and which jobs were handed to the pipeline (so a job
// repeated by a later alert is not added again after the pipeline entry has
// been processed).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getCareerOpsRoot } from '../../path-resolver.mjs';

export const STATE_CAP = 5000;

/** @typedef {{ processed: Set<string>, emitted: Set<string> }} State */

export function defaultStatePath() {
  return path.join(getCareerOpsRoot(), 'data', 'job-alerts-state.json');
}

/** @param {unknown} list */
const stringSet = (list) => new Set(Array.isArray(list) ? list.filter(x => typeof x === 'string') : []);

/** A missing or unreadable file means nothing done yet. @param {string} file @returns {State} */
export function loadState(file) {
  if (!existsSync(file)) return { processed: new Set(), emitted: new Set() };
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return { processed: stringSet(data.processed_message_ids), emitted: stringSet(data.emitted_keys) };
  } catch {
    return { processed: new Set(), emitted: new Set() };
  }
}

/** Atomic write; keeps the newest `cap` entries of each list (a Set iterates in insertion order). @param {string} file @param {State} state @param {number} [cap] */
export function saveState(file, { processed, emitted }, cap = STATE_CAP) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const data = { processed_message_ids: [...processed].slice(-cap), emitted_keys: [...emitted].slice(-cap) };
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}
