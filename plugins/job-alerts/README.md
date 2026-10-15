# Job alerts → career-ops

Reads your **Indeed, LinkedIn and ZipRecruiter job-alert emails** in Gmail and
adds every job in them to your career-ops pipeline. It only reads one Gmail
label, with read-only access, and never visits the job sites itself.

Setup takes about 20 minutes, once. After that you tell Codex
**"check my job alerts"**.

## 1. Create your Google app (one time, about 10 minutes)

Google only lets a program read Gmail through an app you register. It is free
and private to you.

1. Go to <https://console.cloud.google.com/> and sign in with the Gmail
   account that receives your job alerts.
2. Project picker (top bar) → **New project** → name it `career-ops` →
   **Create**, and make sure it is selected.
3. In the search bar type **Gmail API**, open it, click **Enable**.
4. Left menu → **APIs & Services → OAuth consent screen** (newer consoles call
   it **Google Auth Platform**). Choose **External**, app name `career-ops`,
   your email as support and developer contact, then save.
5. **Audience** (or **Publishing status**) → **Publish app** → confirm.
   Do not skip this: an app left in "Testing" signs you out every 7 days.
6. **Clients** (or **Credentials**) → **Create client** → application type
   **Desktop app** → name `career-ops` → **Create**. Keep the window with the
   **Client ID** and **Client secret** open.

## 2. Connect your Gmail

Open a terminal window in the career-ops folder. Run this yourself rather than
asking Codex to, because it waits for you to sign in:

```bash
node plugins/job-alerts/connect-gmail.mjs --write
```

1. It asks for the **Client ID** and **Client secret** from step 1.6. Paste
   each one and press Enter; it saves them for you. (Google shows the client
   secret only once. On that screen, click **Download JSON** to keep a copy.)
2. It prints a link. Open it in your browser and pick your Gmail account.
   Google warns that the app is not verified; that is expected for your own
   app. Click **Advanced → Go to career-ops**, then allow **Read your email
   messages**.
3. The terminal shows `✓ Saved GMAIL_REFRESH_TOKEN`. You are connected.

## 3. Turn on job alerts

Create alerts for the roles you want, for example "graphic designer",
"UX designer", "event coordinator", "marketing coordinator",
"digital producer", in your city or "Remote".

- **Indeed:** run a search → turn on **Get new jobs for this search by email**.
- **LinkedIn:** Jobs → run a search → turn on **Set alert**; in the alert
  settings choose email, daily.
- **ZipRecruiter:** run a search → **Create alert** (or **Get emails for new jobs**).

Button names change from time to time; ask Codex if you cannot find one.

## 4. Put the alerts in one Gmail label

1. In Gmail, click the filter icon at the right of the search box.
2. **From:** `indeed.com OR linkedin.com OR ziprecruiter.com`
3. **Create filter** → tick **Apply the label** → **New label** → `Job Alerts`.
4. Tick **Also apply filter to matching conversations** → **Create filter**.
   (Optional: tick **Skip the Inbox**.)

LinkedIn messages and other non-alert emails can land in the label too; the
plugin ignores them.

## 5. Turn the plugin on

1. If `config/plugins.yml` does not exist, copy it:

   ```bash
   cp config/plugins.example.yml config/plugins.yml
   ```

2. Add this under `plugins:` in `config/plugins.yml` (leave `gmail`
   `enabled: false`, otherwise you get duplicate leads):

   ```yaml
     job-alerts:
       enabled: true
       label: "Job Alerts"
       days_back: 7
   ```

3. Approve it once:

   ```bash
   node plugins.mjs enable job-alerts --confirm
   ```

4. Try it without changing anything:

   ```bash
   node plugins.mjs run job-alerts --dry-run
   ```

## Daily use

Say **"check my job alerts"** to Codex, then **"process the pipeline"**.

## Updates

This copy of career-ops is a fork. Get updates with `git pull` only. Never run
`node update-system.mjs apply` and never accept a "career-ops update
available" offer: the official updater deletes this plugin. (Codex is already
told not to offer it.)

## Privacy

- Access is read-only, and only the label above is ever searched.
- Your Google keys stay in `.env` on your computer; `.env` is never committed.
- Nothing is sent anywhere except Google's Gmail API.
