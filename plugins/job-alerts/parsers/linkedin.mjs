// @ts-check
// LinkedIn job-alert emails. Job links carry the numeric posting id in the
// path (/jobs/view/{id} or /comm/jobs/view/{id}), so no id-less fallback.
import { safeUrl } from '../links.mjs';

const HOST = /(^|\.)linkedin\.com$/i;
const VIEW = /\/(?:comm\/)?jobs\/view\/(?:[^/]*?-)?(\d{6,})(?:\/|$)/i;

export const linkedin = {
  id: 'linkedin',
  label: 'LinkedIn',
  domain: 'linkedin.com',
  /** Alert senders (jobs-noreply@ seen on a real "Jobs that match your profile" email). LinkedIn's messages and invitations use other addresses. */
  senders: /^(jobalerts-noreply|jobs-listings|jobs-noreply)@linkedin\.com$/i,
  noise: [/\bconnections? work here$/i, /\balumni work here$/i],
  /** @type {import('../cards.mjs').JobKeyFn} */
  jobKey(href) {
    const u = safeUrl(href);
    if (!u || !HOST.test(u.hostname)) return null;
    const fromPath = VIEW.exec(u.pathname)?.[1];
    const fromQuery = u.searchParams.get('currentJobId');
    const id = fromPath ?? (fromQuery && /^\d{6,}$/.test(fromQuery) ? fromQuery : null);
    return id ? { key: `linkedin:${id}`, url: `https://www.linkedin.com/jobs/view/${id}/` } : null;
  },
};
