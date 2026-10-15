// @ts-check
// job-alerts — reads Indeed, LinkedIn and ZipRecruiter job-alert emails from
// a Gmail label and returns one lead per job. Design: DESIGN.md.
//
// Network only through ctx.fetch (manifest allowedHosts: Google's token and
// Gmail endpoints). Nothing here contacts the job boards themselves.
import { isGoogleDmarcPass, senderAddress } from './auth.mjs';
import { boardForDomain, boardForSender } from './boards.mjs';
import { fetchRawMessage, getAccessToken, listMessageIds } from './gmail.mjs';
import { parseMessage } from './mime.mjs';
import { cleanField, parseAlert } from './parse.mjs';
import { defaultStatePath, loadProcessed, saveProcessed } from './state.mjs';

const REQUIRED_ENV = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'];

// The engine kills an ingest hook after 15 s; stop starting new emails at 12 s.
export const DEFAULTS = { label: 'Job Alerts', daysBack: 7, budgetMs: 12_000, concurrency: 4, maxList: 500 };

/** Validated settings from config/plugins.yml. @param {Record<string, unknown>} [settings] */
export function readSettings(settings = {}) {
  const label = String(settings.label ?? DEFAULTS.label).trim();
  if (!label) throw new Error('job-alerts: label must not be empty (config/plugins.yml)');
  if (label.includes('"')) throw new Error(`job-alerts: label ${JSON.stringify(label)} contains a double quote, which Gmail search cannot take. Rename the label.`);
  const daysBack = Number(settings.days_back ?? DEFAULTS.daysBack);
  if (!Number.isInteger(daysBack) || daysBack <= 0) throw new Error(`job-alerts: days_back must be a positive whole number, got ${JSON.stringify(settings.days_back)}`);
  return { label, daysBack };
}

/**
 * @typedef {{ id: string, jobs: import('./parse.mjs').Job[], warnings: string[], done: boolean, other?: string }} MessageResult
 * `done` = record the message as processed (false means retry on the next run).
 * `other` = sender address of board-domain mail skipped for having no job links.
 */

/**
 * @param {{ statePath?: string, budgetMs?: number, concurrency?: number, now?: () => number }} [opts]
 */
export function createIngest({ statePath, budgetMs = DEFAULTS.budgetMs, concurrency = DEFAULTS.concurrency, now = Date.now } = {}) {
  /** @param {any} ctx */
  return async function ingest(ctx) {
    const started = now();
    const env = ctx.env ?? {};
    const missing = REQUIRED_ENV.filter(k => !env[k]);
    if (missing.length) throw new Error(`job-alerts: missing ${missing.join(', ')} in .env (see plugins/job-alerts/README.md, step 2)`);
    const { label, daysBack } = readSettings(ctx.settings);
    const file = statePath ?? defaultStatePath();

    const token = await getAccessToken(ctx.fetch, {
      clientId: env.GMAIL_CLIENT_ID, clientSecret: env.GMAIL_CLIENT_SECRET, refreshToken: env.GMAIL_REFRESH_TOKEN,
    });
    const ids = await listMessageIds(ctx.fetch, token, `label:"${label}" newer_than:${daysBack}d`, DEFAULTS.maxList);
    if (ids.length === 0) {
      ctx.log(`job-alerts: no emails in the Gmail label "${label}" from the last ${daysBack} day(s). Check the label name in config/plugins.yml and the Gmail filter (README, step 4).`);
      return [];
    }

    const processed = loadProcessed(file);
    const todo = ids.filter(id => !processed.has(id));
    /** @type {import('./parse.mjs').Job[]} */
    const jobs = [];
    const seen = new Set();
    const warnings = new Set();
    const others = new Set();
    let read = 0;
    for (let i = 0; i < todo.length; i += concurrency) {
      if (now() - started >= budgetMs) break;
      const results = await Promise.all(todo.slice(i, i + concurrency).map(id => readOne(ctx, token, id)));
      for (const r of results) {
        read++;
        for (const w of r.warnings) warnings.add(w);
        if (r.other) others.add(r.other);
        if (r.done) processed.add(r.id);
        for (const job of r.jobs) {
          const key = ctx.normalizePostingUrl?.(job.url) || job.url;
          if (seen.has(key)) continue;
          seen.add(key);
          jobs.push(job);
        }
      }
    }

    for (const w of warnings) ctx.log(`job-alerts: ⚠ ${w}`);
    if (others.size) ctx.log(`job-alerts: skipped other mail with no job links from ${[...others].join(', ')} (not a known alert sender).`);
    const left = todo.length - read;
    if (left > 0) ctx.log(`job-alerts: ${left} alert email(s) not read yet (time limit). Run it again to continue.`);
    ctx.log(`job-alerts: read ${read} new email(s), found ${jobs.length} job(s).`);
    if (!ctx.dryRun) saveProcessed(file, processed);
    return jobs;
  };
}

/** @param {any} ctx @param {string} token @param {string} id @returns {Promise<MessageResult>} */
async function readOne(ctx, token, id) {
  /** @param {string} warning @param {boolean} done */
  const skip = (warning, done) => ({ id, jobs: [], warnings: warning ? [warning] : [], done });
  let msg;
  try {
    msg = parseMessage(await fetchRawMessage(ctx.fetch, token, id));
  } catch (err) {
    return skip(`could not read email ${id} (${String(/** @type {Error} */ (err).message).slice(0, 120)}); will retry next run`, false);
  }
  const subject = cleanField(msg.get('subject')).slice(0, 100) || '(no subject)';
  const date = cleanField(msg.get('date'));
  const address = senderAddress(msg.get('from'));
  // A confirmed alert sender gets the full treatment, including the "format
  // changed" warning. Any other address on a board's own domain (an alert
  // type not seen yet, a recruiter message) is read for id-bearing job links
  // only, and skipped quietly when it has none.
  const alertBoard = boardForSender(address);
  const board = alertBoard ?? boardForDomain(address);
  if (!board) return skip('', true);
  if (!isGoogleDmarcPass(msg)) return skip(`skipped "${subject}": it failed Gmail's anti-spoofing check`, true);
  if (!msg.html) {
    return alertBoard ? skip(`${board.label} alert "${subject}" (${date}) has no HTML part; it will be retried`, false) : { ...skip('', true), other: address };
  }
  const { jobs, warnings } = parseAlert(board, msg.html, { allowOpaque: Boolean(alertBoard) });
  if (jobs.length === 0) {
    if (!alertBoard) return { ...skip('', true), other: address };
    return { id, jobs: [], warnings: [...warnings, `found no jobs in ${board.label} alert "${subject}" (${date}); the email format may have changed, so it will be retried`], done: false };
  }
  return { id, jobs, warnings, done: true };
}

export default { ingest: createIngest() };
