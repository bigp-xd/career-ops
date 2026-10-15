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
import { defaultStatePath, loadState, saveState } from './state.mjs';

const REQUIRED_ENV = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'];

// The engine stops waiting for an ingest hook after 15 s, but cannot stop the
// hook: anything it saves after that marks emails read whose jobs the engine
// never appended. So: no new batch after budgetMs, any batch still running at
// hardMs is abandoned (its emails stay unread), and nothing is saved past
// saveByMs.
export const DEFAULTS = { label: 'Job Alerts', daysBack: 7, budgetMs: 12_000, hardMs: 13_500, saveByMs: 14_000, concurrency: 4, maxList: 500 };

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
 * @typedef {{ id: string, boardId: string, jobs: import('./parse.mjs').Job[], warnings: string[], done: boolean, other?: string }} MessageResult
 * `done` = record the message as processed (false means retry on the next run).
 * `other` = sender address of board-domain mail skipped for having no job links.
 */

/** @param {string} s */
const fold = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Keys under which a lead counts as already handed over: its canonical URL,
 * and (when the company is known) board + title + company + location, which
 * catches the same job behind a different id-less tracking link.
 * @param {any} ctx @param {string} boardId @param {import('./parse.mjs').Job} job
 */
function leadKeys(ctx, boardId, job) {
  const keys = [`url:${ctx.normalizePostingUrl?.(job.url) || job.url}`];
  if (job.company) keys.push(`fp:${boardId}|${fold(job.title)}|${fold(job.company)}|${fold(job.location)}`);
  return keys;
}

/** Resolves to the promise's value, or null if `ms` passes first. @template T @param {Promise<T>} p @param {number} ms @returns {Promise<T | null>} */
function withinDeadline(p, ms) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * @param {{ statePath?: string, budgetMs?: number, hardMs?: number, saveByMs?: number, concurrency?: number, now?: () => number }} [opts]
 */
export function createIngest({
  statePath, budgetMs = DEFAULTS.budgetMs, hardMs = DEFAULTS.hardMs, saveByMs = DEFAULTS.saveByMs,
  concurrency = DEFAULTS.concurrency, now = Date.now,
} = {}) {
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

    const state = loadState(file);
    const todo = ids.filter(id => !state.processed.has(id));
    /** @type {import('./parse.mjs').Job[]} */
    const jobs = [];
    const seen = new Set();
    const warnings = new Set();
    const others = new Set();
    let read = 0;
    for (let i = 0; i < todo.length; i += concurrency) {
      const remaining = started + hardMs - now();
      if (now() - started >= budgetMs || remaining <= 0) break;
      const batch = todo.slice(i, i + concurrency).map(id => readOne(ctx, token, id, remaining));
      const results = await withinDeadline(Promise.all(batch), remaining);
      if (!results) break; // too slow: these emails stay unread for the next run
      for (const r of results) {
        read++;
        for (const w of r.warnings) warnings.add(w);
        if (r.other) others.add(r.other);
        if (r.done) state.processed.add(r.id);
        for (const job of r.jobs) {
          const keys = leadKeys(ctx, r.boardId, job);
          if (keys.some(k => seen.has(k) || state.emitted.has(k))) continue;
          keys.forEach(k => seen.add(k));
          jobs.push(job);
        }
      }
    }

    for (const w of warnings) ctx.log(`job-alerts: ⚠ ${w}`);
    if (others.size) ctx.log(`job-alerts: skipped other mail with no job links from ${[...others].join(', ')} (not a known alert sender).`);
    const left = todo.length - read;
    if (left > 0) {
      ctx.log(ctx.dryRun
        ? `job-alerts: dry run stopped at the time limit; ${left} alert email(s) not shown. A real run (without --dry-run) saves progress and continues where it stopped.`
        : `job-alerts: ${left} alert email(s) not read yet (time limit). Run it again to continue.`);
    }
    ctx.log(`job-alerts: read ${read} new email(s), found ${jobs.length} job(s).`);
    if (ctx.dryRun) return jobs;
    if (now() - started > saveByMs) {
      ctx.log('job-alerts: ran out of time before saving; nothing was marked as read, so these emails are read again next time.');
      return [];
    }
    for (const k of seen) state.emitted.add(k);
    saveState(file, state);
    return jobs;
  };
}

/** @param {any} ctx @param {string} token @param {string} id @param {number} timeoutMs @returns {Promise<MessageResult>} */
async function readOne(ctx, token, id, timeoutMs) {
  /** @param {string} warning @param {boolean} done @param {string} [boardId] */
  const skip = (warning, done, boardId = '') => ({ id, boardId, jobs: [], warnings: warning ? [warning] : [], done });
  let msg;
  try {
    msg = parseMessage(await fetchRawMessage(ctx.fetch, token, id, { timeoutMs }));
  } catch (err) {
    return skip(`could not read email ${id} (${String(/** @type {Error} */ (err).message).slice(0, 120)}); will retry next run`, false);
  }
  const subject = cleanField(msg.get('subject')).slice(0, 100) || '(no subject)';
  const date = cleanField(msg.get('date'));
  const address = senderAddress(msg.get('from'));
  // A confirmed alert sender gets the full treatment, including the "format
  // changed" warning. Any other address on a board's own domain (an alert
  // type not seen yet, a recruiter message) is read for id-bearing job links
  // only; if it would only yield id-less cards it is flagged and kept unread,
  // otherwise skipped quietly.
  const alertBoard = boardForSender(address);
  const board = alertBoard ?? boardForDomain(address);
  if (!board) return skip('', true);
  if (!isGoogleDmarcPass(msg)) return skip(`skipped "${subject}": it failed Gmail's anti-spoofing check`, true, board.id);
  if (!msg.html) {
    return alertBoard ? skip(`${board.label} alert "${subject}" (${date}) has no HTML part; it will be retried`, false, board.id) : { ...skip('', true, board.id), other: address };
  }
  const { jobs, warnings } = parseAlert(board, msg.html, { allowOpaque: Boolean(alertBoard) });
  if (jobs.length > 0) return { id, boardId: board.id, jobs, warnings, done: true };
  if (alertBoard) {
    return skip(`found no jobs in ${board.label} alert "${subject}" (${date}); the email format may have changed, so it will be retried`, false, board.id);
  }
  if (parseAlert(board, msg.html).jobs.length > 0) {
    return skip(`"${subject}" from ${address} looks like a ${board.label} job alert, but that address is not a confirmed alert sender, so it was not imported. Add it to senders in plugins/job-alerts/parsers/${board.id}.mjs and it will be read on the next run.`, false, board.id);
  }
  return { ...skip('', true, board.id), other: address };
}

export default { ingest: createIngest() };
