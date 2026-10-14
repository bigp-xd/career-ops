# job-alerts plugin — design

Status: approved 2026-10-14 · Branch: `feat/job-alerts-plugin` (fork `bigp-xd/career-ops`)

## Why

A non-technical candidate (digital services coordinator: event coordination +
graphic design, open to design / UX / events / coordinator roles, remote or
hybrid) will run career-ops through Codex on their own computer, cloned from
this fork. They want listings from Indeed, LinkedIn and ZipRecruiter.

career-ops does not scan those boards, and should not: LinkedIn scraping is
refused by policy (CONTRIBUTING.md), Glassdoor/Dice were rejected for needing
stealth automation (docs/SUPPORTED_JOB_BOARDS.md), and both remaining boards
forbid scraping. The candidate's budget is zero, which rules out SerpApi and
Apify.

All three boards send free job-alert emails. Reading email the candidate
already receives breaks no site's terms. The bundled `plugins/gmail` plugin
already reads a Gmail label, but it is generic: it drops any link containing
`click` or `track` (which removes alert links that carry tracking parameters),
gives every job in a digest the email's subject as its title, and collects
footer links. This plugin replaces it for alert emails with per-site parsers.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Source | Job-alert emails in Gmail | Free, within every site's terms, candidate uses Gmail |
| Boards | Indeed, ZipRecruiter, LinkedIn in one plugin | One setup and one failure point for a non-technical user |
| Location | `plugins.local/job-alerts/`, force-added to git | `update-system.mjs apply` prunes unknown files under `plugins/`; `plugins.local/` is user layer and never touched. Gitignored by default, so `git add -f` once; git tracks it afterwards |
| Distribution | Candidate clones the fork; updates via `git pull` | PRs land on the fork's `main` |
| Network | Only `oauth2.googleapis.com`, `gmail.googleapis.com` | The plugin never fetches from Indeed / LinkedIn / ZipRecruiter |
| Gmail code | Copied into the plugin, not imported from `plugins/gmail` | An upstream change to the bundled plugin cannot break it |
| Dependencies | None | Plain Node, same as every bundled plugin |

## Layout

```
plugins.local/job-alerts/
  manifest.json        id job-alerts, hooks [ingest], requiredEnv GMAIL_CLIENT_ID /
                       GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN, allowedHosts the two
                       Google hosts, humanInTheLoop true
  index.mjs            ingest hook: list label → fetch raw messages → gate → parse → Job[]
  gmail.mjs            token refresh, message list (paginated), raw message fetch
  mime.mjs             RFC 822 / MIME parsing of the raw message (headers, HTML part)
  auth.mjs             sender-domain and Gmail DMARC gates
  boards.mjs           the three board descriptors + sender → board lookup
  cards.mjs            board-agnostic HTML → job-card extraction
  links.mjs            URL helpers: layered decoding, id-less ("opaque") link fallback
  parse.mjs            parseAlert(board, html) + shared clean-up (whitespace, control
                       characters, length caps)
  parsers/indeed.mjs   per-board link → job-id rules and noise phrases
  parsers/linkedin.mjs
  parsers/ziprecruiter.mjs
  state.mjs            processed-message record
  connect-gmail.mjs    one-time helper that prints (or, with --write, saves) a refresh token
  tools/sanitize-eml.mjs  strips personal data from a downloaded alert before it becomes a fixture
  skill.md             how Codex / Claude drives it (loaded via `node plugins.mjs skill job-alerts`)
  README.md            step-by-step human setup
  DESIGN.md            this file
  PLAN.md              implementation plan
  test/                node:test suites + fixtures/ (sanitized .eml, one or more per board)
```

Messages are fetched with Gmail's `format=raw` and parsed locally by
`mime.mjs`, so the `.eml` files downloaded from Gmail run through exactly the
same code path in tests as live mail does in production.

## Data flow

1. `node plugins.mjs run job-alerts` (the candidate says "check my job alerts" to Codex).
2. The engine loads the plugin with `ctx.env` (the three Gmail values from `.env`)
   and `ctx.settings` (from `config/plugins.yml`: `label`, default `"Job Alerts"`;
   `days_back`, default `7`).
3. `gmail.mjs` exchanges the refresh token for an access token and lists messages
   matching `label:"<label>" newer_than:<days_back>d`, all through `ctx.fetch`.
4. For each message not already in the processed record (newest first, four
   at a time, within a 12-second budget):
   - **Sender gate:** the `From` address domain must be `indeed.com`,
     `linkedin.com` or `ziprecruiter.com` (or a subdomain); that picks the
     parser. Mail from anywhere else is ignored silently. Within a board:
     - a **confirmed alert sender** (each board's `senders` pattern, taken
       from real sample emails) gets the full treatment, including the
       "format may have changed" warning;
     - **any other address on the board's domain** (an alert type not seen
       yet, LinkedIn messages, Indeed application receipts) is read for
       id-bearing job links only, never the opaque-link fallback, and is
       skipped quietly when it has none; the run log names such senders once,
       so a missed alert type can be added to `senders`.
   - **Authenticity gate:** the topmost `Authentication-Results` header
     (Gmail's own) must have authserv-id `mx.google.com` and report
     `dmarc=pass` with `header.from` equal to the From address's domain.
     The From address is read with quoted display names removed, and a
     header with more than one address is refused, so an address hidden in
     a display name cannot pose as the sender.
   - The parser receives the decoded HTML part and returns jobs. All three
     boards send HTML alerts, so there is no plain-text fallback.
5. Every job is cleaned in `parse.mjs` and returned as
   `{ title, company, location, url }`. The engine dedups against
   `data/pipeline.md` and appends new leads.
6. From the pipeline onward nothing changes: `pipeline` mode evaluates leads, and
   the existing AGENTS.md rule applies — an aggregator listing is unconfirmed
   until the same role is found at the employer.

## Parser contract

`parseAlert(board, html) → { jobs: Job[], warnings: string[] }`

Each parser:

- Finds every job card in the alert and extracts title, company and location
  from the card's own text, not from the subject line.
- Produces a canonical URL from the card's link, without any network request:
  - LinkedIn: `https://www.linkedin.com/jobs/view/{id}/` (id from `/jobs/view/{id}` or
    `/comm/jobs/view/{id}`; tracking query dropped).
  - Indeed: every link is `cts.indeed.com/v3/<base64url(gzip(JSON))>`; the JSON's
    `u` is the real target, and a job target carries `jk`. The payload is
    decoded locally (gunzip capped at 64 KiB). Canonical
    `https://www.indeed.com/viewjob?jk={jk}` (two-letter country host kept). A
    decodable payload without `jk` ("This is a bad match", Yes/No, profile and
    footer links) is never a job; only non-cts Indeed links fall back to the
    opaque link. Older formats with `jk` directly in the URL or in an encoded
    redirect are still read.
  - ZipRecruiter: real alert links are opaque `www.ziprecruiter.com/km/<token>`
    tracking links with no job id, so they are kept as links (and warned
    about). A posting URL with `jid=` (direct or inside a redirect) is
    canonicalised to `https://www.ziprecruiter.com{path}?jid={jid}`.
  - When a link carries no extractable id, keep the original link (it still
    opens the posting in a browser) and add a warning. Never follow the redirect.
    Login-like query parameters (`auth_token`, `contact_id`, `expires`,
    `email`, …) are removed first: ZipRecruiter puts a login for the
    recipient's account on every job link, and a lead must not carry it.
- Ignores everything that is not a job card: logos, footer, "see all jobs",
  settings, unsubscribe, app-store badges.
- Returns `jobs: []` plus a warning when it recognizes the sender but finds no
  cards (the format probably changed).

Shared clean-up in `parse.mjs`: collapse whitespace, strip control characters,
cap title/company/location at 200 characters, drop a job missing a title or a
URL. `index.mjs` then dedups on `ctx.normalizePostingUrl(url)` across all
emails in the run.

Email content is untrusted external content (AGENTS.md): parsers only extract
these four fields; nothing in an email is treated as an instruction.

## Error handling

| Situation | Behaviour |
| --- | --- |
| Missing Gmail values in `.env` | Throw one error naming the missing keys and pointing at README setup |
| Token refresh fails (expired / revoked) | Throw with a hint: re-run `connect-gmail.mjs`; mention the 7-day expiry of apps left in Testing |
| Label has no messages | Return `[]`, log the query |
| One message fails to fetch | Warn, skip, do not mark processed |
| DMARC fails | Warn with the subject, mark processed |
| Sender is not on any board's domain (other mail, the candidate forwarding an alert) | Ignore silently, mark processed |
| Sender is on a board's domain but not a confirmed alert sender | Read id-bearing job links only; if none, skip quietly, mark processed, name the sender once in the run log |
| Known sender, zero cards found | Warn with subject + date, **do not** mark processed, so a parser fix picks it up on the next run |
| Link without an id | Keep the original link, warn once per board per run |
| Known sender, no HTML part | Warn, **do not** mark processed |
| Many unread alerts (the engine kills an ingest hook after 15 s) | Stop starting new emails after 12 s, return the jobs found so far, save progress, log how many emails remain and to run again |
| Label name contains `"` | Throw: it would break the Gmail search |
| `--dry-run` | Parse and return as normal; do not write the processed record |

## State

`{DATA_ROOT}/data/job-alerts-state.json` — `{ "processed_message_ids": [...] }`.
`DATA_ROOT` from `getCareerOpsRoot()` in `path-resolver.mjs`, as AGENTS.md
requires for new scripts. Capped at the most recent 5,000 ids. `data/*` is
gitignored, so it never reaches the fork.

## connect-gmail.mjs

Standalone CLI, not part of the ingest hook.

1. Reads `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` from `.env` in the data root
   (error with README pointer if absent).
2. Starts a `node:http` listener on `127.0.0.1` with a random free port
   (Google's supported loopback flow for desktop apps).
3. Prints a Google sign-in URL: scope `gmail.readonly`, `access_type=offline`,
   `prompt=consent`, PKCE (S256), random `state`.
4. On the redirect, checks `state`, exchanges the code (with the PKCE verifier)
   at the token endpoint and prints the refresh token in a single clearly
   marked block (same default as `plugins/h1b-sponsor/token.mjs`).
   With `--write` it instead sets `GMAIL_REFRESH_TOKEN` in the data root's
   `.env` (file mode 600) and prints only a confirmation, so the token never
   has to pass through a chat with an AI agent.
5. Times out after 5 minutes and closes the listener.

Known limitation: `node:http` and global `fetch` would fail `plugin-audit.mjs`,
which only runs for registry installs. If the plugin is ever published to the
registry, this helper has to move out of the plugin folder.

## Human setup (README.md outline)

1. Google Cloud: create a project, enable the Gmail API, configure the OAuth
   consent screen (External), create a "Desktop app" OAuth client, then
   **publish the app** (In production) so the refresh token
   does not expire after 7 days. Accept the "Google hasn't verified this app"
   screen during sign-in (expected for a personal app).
2. Put the client id and secret in `.env`; run
   `node plugins.local/job-alerts/connect-gmail.mjs --write`, which signs in
   and saves the refresh token into `.env`.
3. Create job alerts on Indeed, LinkedIn and ZipRecruiter (example searches for
   design, UX, events and coordinator roles).
4. Gmail filter: `from:(indeed.com OR linkedin.com OR ziprecruiter.com)` → apply
   label "Job Alerts" (optionally skip the inbox).
5. Enable: add the `job-alerts` block to `config/plugins.yml`, run
   `node plugins.mjs enable job-alerts`. Keep the bundled `gmail` plugin
   disabled, or point it at a different label, to avoid duplicate leads.
6. Updates: every change to the plugin bumps `manifest.json` `version`, which
   the engine treats as an honest update and re-pins silently after
   `git pull`. If it ever reports "files changed … without a version bump",
   run `node plugins.mjs trust job-alerts`.
7. Daily use: "check my job alerts" in Codex, then "process the pipeline".

## Testing

- Fixtures: at least one real alert email per board, saved from Gmail
  ("Download message"), with the recipient's name, email address and any
  personal tracking tokens replaced. Committed under `test/fixtures/`.
- Per-parser tests: expected jobs (title, company, location, URL) for each
  fixture; footer and logo links excluded; links without an id handled as
  specified.
- `index.mjs` tests with a fake `ctx.fetch`: DMARC failure skipped, unknown
  sender ignored, zero-card email warned and left unprocessed, processed ids
  respected, `dryRun` writes no state, missing env produces the named error.
- `connect-gmail.mjs`: unit-test URL construction, PKCE, and state checking;
  the live sign-in is verified by hand.
- Run with `node --test 'plugins.local/job-alerts/test/*.test.mjs'`. The repo's
  `test-all.mjs` must still pass (the plugin changes no system file).
- Before handover: a dry run against a real Gmail label, then the README
  followed from scratch on a fresh clone of the fork.

## Out of scope

- The candidate's personal setup (CV, profile, portals, targeting), done by
  onboarding in Codex on their machine.
- Email providers other than Gmail.
- Looking up the employer's own posting automatically (pipeline mode already
  does this).
- Publishing to the plugin registry.
