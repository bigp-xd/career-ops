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
