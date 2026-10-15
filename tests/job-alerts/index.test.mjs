// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createIngest, readSettings } from '../../plugins/job-alerts/index.mjs';
import { buildEml, fakeGmail, fakeCtx, linkedinCard, alertHtml } from './helpers.mjs';

const tmpState = () => path.join(mkdtempSync(path.join(tmpdir(), 'job-alerts-')), 'data', 'state.json');
const savedIds = (file) => JSON.parse(readFileSync(file, 'utf8')).processed_message_ids;
/** @param {...{ n: number, id: string, title: string, company: string, location: string }} cards */
const alert = (...cards) => buildEml({ html: alertHtml(cards.map(linkedinCard)) });
const designer = (n, id = String(4000000000 + n)) => ({ n, id, title: `Designer ${n}`, company: 'Acme', location: 'Remote' });

test('turns a LinkedIn alert into one job per card and remembers the email', async () => {
  const statePath = tmpState();
  const { fetch } = fakeGmail({ messages: { m1: alert(
    { n: 1, id: '4012345678', title: 'Graphic Designer', company: 'Acme', location: 'Toronto, ON' },
    { n: 2, id: '4098765432', title: 'Event Coordinator', company: 'Beta', location: 'Remote' },
  ) } });
  const { ctx } = fakeCtx({ fetch });
  assert.deepEqual(await createIngest({ statePath })(ctx), [
    { title: 'Graphic Designer', company: 'Acme', location: 'Toronto, ON', url: 'https://www.linkedin.com/jobs/view/4012345678/' },
    { title: 'Event Coordinator', company: 'Beta', location: 'Remote', url: 'https://www.linkedin.com/jobs/view/4098765432/' },
  ]);
  assert.deepEqual(savedIds(statePath), ['m1']);
});

test('lists a job once when two alerts repeat it with different tracking links', async () => {
  const { fetch } = fakeGmail({ messages: { m1: alert(designer(1, '4012345678')), m2: alert(designer(2, '4012345678')) } });
  const jobs = await createIngest({ statePath: tmpState() })(fakeCtx({ fetch }).ctx);
  assert.equal(jobs.length, 1);
});

test('ignores mail that is not from an alert sender, without a warning', async () => {
  const statePath = tmpState();
  const { fetch } = fakeGmail({ messages: { m1: buildEml({ from: 'LinkedIn <messages-noreply@linkedin.com>', html: '<p>You have a new message</p>' }) } });
  const { ctx, logs } = fakeCtx({ fetch });
  assert.deepEqual(await createIngest({ statePath })(ctx), []);
  assert.ok(!logs.some(l => l.includes('⚠')));
  assert.deepEqual(savedIds(statePath), ['m1']);
});

test("skips an alert that fails Gmail's anti-spoofing check", async () => {
  const statePath = tmpState();
  const spoof = buildEml({ auth: ['mx.google.com; dmarc=fail (p=REJECT) header.from=linkedin.com'], html: alertHtml([linkedinCard(designer(1))]) });
  const { ctx, logs } = fakeCtx({ fetch: fakeGmail({ messages: { m1: spoof } }).fetch });
  assert.deepEqual(await createIngest({ statePath })(ctx), []);
  assert.ok(logs.some(l => l.includes('anti-spoofing')));
  assert.deepEqual(savedIds(statePath), ['m1']);
});

test('warns and retries later when a known alert has no recognisable jobs', async () => {
  const statePath = tmpState();
  const { ctx, logs } = fakeCtx({ fetch: fakeGmail({ messages: { m1: buildEml({ html: '<p>A brand-new layout</p>' }) } }).fetch });
  assert.deepEqual(await createIngest({ statePath })(ctx), []);
  assert.ok(logs.some(l => l.includes('format may have changed')));
  assert.deepEqual(savedIds(statePath), []);
});

test('does not re-read emails it has already processed', async () => {
  const statePath = tmpState();
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify({ processed_message_ids: ['m1'] }));
  /** @type {string[]} */
  const read = [];
  const { fetch } = fakeGmail({ messages: { m1: alert(designer(1)) }, onRaw: (id) => read.push(id) });
  assert.deepEqual(await createIngest({ statePath })(fakeCtx({ fetch }).ctx), []);
  assert.deepEqual(read, []);
});

test('a dry run writes no state', async () => {
  const statePath = tmpState();
  const { fetch } = fakeGmail({ messages: { m1: alert(designer(1)) } });
  const jobs = await createIngest({ statePath })(fakeCtx({ fetch, dryRun: true }).ctx);
  assert.equal(jobs.length, 1);
  assert.equal(existsSync(statePath), false);
});

test('missing Gmail keys produce one clear error', async () => {
  const { ctx } = fakeCtx({ fetch: fakeGmail().fetch, env: { GMAIL_CLIENT_ID: 'x' } });
  await assert.rejects(createIngest({ statePath: tmpState() })(ctx), /missing GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in \.env/);
});

test('settings: labels with spaces are quoted, double quotes and bad days_back are refused', async () => {
  assert.throws(() => readSettings({ label: 'My "Jobs"' }), /double quote/);
  assert.throws(() => readSettings({ days_back: 0 }), /days_back/);
  assert.throws(() => readSettings({ days_back: 2.5 }), /days_back/);
  assert.deepEqual(readSettings({}), { label: 'Job Alerts', daysBack: 7 });
  assert.deepEqual(readSettings({ label: ' My Job Alerts ', days_back: '3' }), { label: 'My Job Alerts', daysBack: 3 });
  const { fetch, calls } = fakeGmail();
  await createIngest({ statePath: tmpState() })(fakeCtx({ fetch, settings: { label: 'My Job Alerts' } }).ctx);
  const list = calls.find(c => c.url.includes('/messages?'));
  assert.equal(new URL(/** @type {any} */ (list).url).searchParams.get('q'), 'label:"My Job Alerts" newer_than:7d');
});

test('an empty label explains where to look', async () => {
  const { ctx, logs } = fakeCtx({ fetch: fakeGmail().fetch });
  assert.deepEqual(await createIngest({ statePath: tmpState() })(ctx), []);
  assert.ok(logs.some(l => l.includes('"Job Alerts"') && l.includes('Gmail filter')));
});

test('stops before the engine time limit and keeps the rest for the next run', async () => {
  const statePath = tmpState();
  let t = 0;
  /** @type {Record<string, Buffer>} */
  const messages = {};
  for (let i = 1; i <= 10; i++) messages[`m${i}`] = alert(designer(i));
  const { fetch } = fakeGmail({ messages, onRaw: () => { t += 4000; } });
  const { ctx, logs } = fakeCtx({ fetch });
  const jobs = await createIngest({ statePath, now: () => t })(ctx);
  assert.equal(jobs.length, 4);
  assert.deepEqual(savedIds(statePath), ['m1', 'm2', 'm3', 'm4']);
  assert.ok(logs.some(l => l.includes('6 alert email(s) not read yet')));
});

test('one unreadable email is retried later; the others still count', async () => {
  const statePath = tmpState();
  const { fetch } = fakeGmail({ messages: { m1: new Error('HTTP 500'), m2: alert(designer(2)) } });
  const { ctx, logs } = fakeCtx({ fetch });
  assert.equal((await createIngest({ statePath })(ctx)).length, 1);
  assert.deepEqual(savedIds(statePath), ['m2']);
  assert.ok(logs.some(l => l.includes('could not read email m1')));
});

test('an expired Gmail login says how to fix it', async () => {
  const { ctx } = fakeCtx({ fetch: fakeGmail({ tokenError: 'HTTP 400 invalid_grant' }).fetch });
  await assert.rejects(createIngest({ statePath: tmpState() })(ctx), /connect-gmail\.mjs --write[\s\S]*Testing/);
});

test('decodes accented, quoted-printable alerts end to end', async () => {
  const html = alertHtml([linkedinCard({ n: 1, id: '4012345678', title: 'Diseñadora Gráfica', company: 'Café &amp; Co', location: 'Montréal, QC' })]);
  const { fetch } = fakeGmail({ messages: { m1: buildEml({ html, htmlEncoding: 'quoted-printable' }) } });
  const [job] = await createIngest({ statePath: tmpState() })(fakeCtx({ fetch }).ctx);
  assert.deepEqual([job.title, job.company, job.location], ['Diseñadora Gráfica', 'Café & Co', 'Montréal, QC']);
});

const JK = '0123456789abcdef';
const indeedAuth = ['mx.google.com; dkim=pass; dmarc=pass (p=REJECT) header.from=indeed.com'];

test('reads id-bearing jobs from an unrecognised sender on a board domain', async () => {
  const statePath = tmpState();
  const html = `<a href="https://www.indeed.com/viewjob?jk=${JK}">Graphic Designer</a><p>Acme</p><p>Remote</p>` +
    '<a href="https://engage.indeed.com/f/a/XYZ123">Update your profile today</a>';
  const { fetch } = fakeGmail({ messages: { m1: buildEml({ from: 'Indeed <alert@indeed.com>', auth: indeedAuth, html }) } });
  const { ctx, logs } = fakeCtx({ fetch });
  assert.deepEqual(await createIngest({ statePath })(ctx), [
    { title: 'Graphic Designer', company: 'Acme', location: 'Remote', url: `https://www.indeed.com/viewjob?jk=${JK}` },
  ]);
  assert.ok(!logs.some(l => l.includes('⚠')));
  assert.deepEqual(savedIds(statePath), ['m1']);
});

test('other mail from a board domain with no job links is skipped quietly, naming the sender once', async () => {
  const statePath = tmpState();
  const other = (n) => buildEml({ from: 'Indeed <donotreply@indeed.com>', auth: indeedAuth, html: `<p>Your application ${n} was sent</p>` });
  const { fetch } = fakeGmail({ messages: { m1: other(1), m2: other(2) } });
  const { ctx, logs } = fakeCtx({ fetch });
  assert.deepEqual(await createIngest({ statePath })(ctx), []);
  assert.ok(!logs.some(l => l.includes('⚠')));
  assert.equal(logs.filter(l => l.includes('donotreply@indeed.com')).length, 1);
  assert.deepEqual(savedIds(statePath), ['m1', 'm2']);
});
