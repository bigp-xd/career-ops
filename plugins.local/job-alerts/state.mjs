// @ts-check
// Which Gmail messages have been handled, so each alert is read once.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getCareerOpsRoot } from '../../path-resolver.mjs';

export const STATE_CAP = 5000;

export function defaultStatePath() {
  return path.join(getCareerOpsRoot(), 'data', 'job-alerts-state.json');
}

/** @param {string} file @returns {Set<string>} */
export function loadProcessed(file) {
  if (!existsSync(file)) return new Set();
  try {
    const ids = JSON.parse(readFileSync(file, 'utf8')).processed_message_ids;
    return new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Atomic write; keeps the newest `cap` ids (a Set iterates in insertion order). @param {string} file @param {Set<string>} ids @param {number} [cap] */
export function saveProcessed(file, ids, cap = STATE_CAP) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ processed_message_ids: [...ids].slice(-cap) }, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}
