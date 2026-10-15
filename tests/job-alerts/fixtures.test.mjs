// @ts-check
// Every test/fixtures/<name>.eml with a <name>.expected.json is parsed the
// way the plugin parses live mail and compared job by job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMessage } from '../../plugins/job-alerts/mime.mjs';
import { senderAddress, isGoogleDmarcPass } from '../../plugins/job-alerts/auth.mjs';
import { boardForSender } from '../../plugins/job-alerts/boards.mjs';
import { parseAlert } from '../../plugins/job-alerts/parse.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const emails = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.eml')).sort() : [];

test('at least one fixture exists', () => assert.ok(emails.length > 0));

for (const name of emails) {
  const expectedFile = path.join(dir, name.replace(/\.eml$/, '.expected.json'));
  test(`fixture ${name}`, { skip: existsSync(expectedFile) ? false : 'no .expected.json yet' }, () => {
    const msg = parseMessage(readFileSync(path.join(dir, name)));
    const board = boardForSender(senderAddress(msg.get('from')));
    assert.ok(board, `"${msg.get('from')}" is not a known alert sender`);
    assert.ok(isGoogleDmarcPass(msg), 'fixture has no passing mx.google.com Authentication-Results header');
    const { jobs } = parseAlert(board, msg.html);
    assert.deepEqual(jobs, JSON.parse(readFileSync(expectedFile, 'utf8')));
    for (const job of jobs) assert.doesNotMatch(job.url, /unsubscribe|settings/i);
  });
}
