// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { senderAddress, domainOf, isGoogleDmarcPass } from '../auth.mjs';
import { boardForSender } from '../boards.mjs';
import { parseMessage } from '../mime.mjs';
import { buildEml } from './helpers.mjs';

test('senderAddress reads the address inside angle brackets, lower-cased', () => {
  assert.equal(senderAddress('LinkedIn Job Alerts <JobAlerts-NoReply@LinkedIn.com>'), 'jobalerts-noreply@linkedin.com');
  assert.equal(senderAddress('"jobs@linkedin.com" <attacker@evil.test>'), 'attacker@evil.test');
  assert.equal(senderAddress('alert@indeed.com'), 'alert@indeed.com');
  assert.equal(senderAddress('No Address Here'), '');
  assert.equal(senderAddress(''), '');
  assert.equal(domainOf('a@jobalert.indeed.com'), 'jobalert.indeed.com');
});

test('senderAddress ignores addresses hidden in a quoted display name and refuses address lists', () => {
  assert.equal(senderAddress('"<jobalerts-noreply@linkedin.com>" <me@attacker.test>'), 'me@attacker.test');
  assert.equal(senderAddress('"LinkedIn <jobalerts-noreply@linkedin.com>" me@attacker.test'), '');
  assert.equal(senderAddress('Name <a@x.test>, <jobalerts-noreply@linkedin.com>'), '');
  assert.equal(senderAddress('<jobalerts-noreply@linkedin.com> <me@attacker.test>'), '');
});

test("a DMARC pass only counts for the sender's own domain", () => {
  const msg = (from, auth) => parseMessage(buildEml({ from, auth: [auth] }));
  const linkedinFrom = 'LinkedIn <jobalerts-noreply@linkedin.com>';
  assert.equal(isGoogleDmarcPass(msg(linkedinFrom, 'mx.google.com; dmarc=pass (p=NONE) header.from=attacker.test')), false);
  assert.equal(isGoogleDmarcPass(msg(linkedinFrom, 'mx.google.com; dmarc=pass (p=REJECT)')), false);
  assert.equal(isGoogleDmarcPass(msg(linkedinFrom, 'mx.google.com; dmarc=pass (p=REJECT) header.from=LinkedIn.com')), true);
  const spoof = msg('"<jobalerts-noreply@linkedin.com>" <me@attacker.test>', 'mx.google.com; dmarc=pass (p=NONE) header.from=attacker.test');
  assert.equal(boardForSender(senderAddress(spoof.get('from'))), null);
  assert.equal(isGoogleDmarcPass(msg('Indeed <donotreply@match.indeed.com>', 'mx.google.com; dkim=pass; dmarc=pass (p=REJECT) header.from=match.indeed.com')), true);
});

test('isGoogleDmarcPass trusts only the topmost, Gmail-written header', () => {
  const msg = (auth) => parseMessage(buildEml({ auth }));
  assert.equal(isGoogleDmarcPass(msg(['mx.google.com; dkim=pass; dmarc=pass (p=REJECT) header.from=linkedin.com'])), true);
  assert.equal(isGoogleDmarcPass(msg(['mx.google.com; dmarc=fail (p=REJECT) header.from=linkedin.com'])), false);
  assert.equal(isGoogleDmarcPass(msg(['mx.google.com; dmarc=fail', 'mx.google.com; dmarc=pass'])), false);
  assert.equal(isGoogleDmarcPass(msg(['spoofer.example; dmarc=pass'])), false);
  assert.equal(isGoogleDmarcPass(msg([])), false);
});

test('boardForSender matches alert senders only', () => {
  assert.equal(boardForSender('jobalerts-noreply@linkedin.com')?.id, 'linkedin');
  assert.equal(boardForSender('messages-noreply@linkedin.com'), null);
  assert.equal(boardForSender('alert@jobalert.indeed.com')?.id, 'indeed');
  assert.equal(boardForSender('alerts@ziprecruiter.com')?.id, 'ziprecruiter');
  assert.equal(boardForSender('jobalerts-noreply@notlinkedin.com'), null);
  assert.equal(boardForSender('jobalerts-noreply@linkedin.com.evil.test'), null);
  assert.equal(boardForSender(''), null);
});
