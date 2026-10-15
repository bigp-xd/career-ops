# This fork: bridge-job preset

This checkout is pre-tailored for one person's search: a **full-time "bridge
job"** -- stable, contained, low-stakes, remote or hybrid -- that leaves her
energy to build her own thing on the side. It is NOT a part-time search.

## Onboarding overrides (apply on top of AGENTS.md → First Run)

Run this once, before `node doctor.mjs --json --init-templates`:

```bash
node presets/bridge/install.mjs
```

It copies the preset into place and never overwrites an existing file:

| Target | Copied from (instead of the default template) |
|--------|-----------------------------------------------|
| `modes/_profile.md` | `presets/bridge/_profile.md` |
| `modes/_custom.md` | `presets/bridge/_custom.md` |
| `portals.yml` | `presets/bridge/portals.yml` |

doctor then fills in only what the preset leaves out (`modes/_brief.md`,
`voice-dna.md`). In AGENTS.md Step 3, keep the installed `portals.yml`
rather than copying `templates/portals.example.yml`.

Then, during Steps 1-2:

1. After `cv.md` exists, edit the **Same-Field IC** row in `modes/_profile.md`
   for her actual field, and remove any archetype her CV can't support.
   Add her field's job titles to `title_filter.positive` in `portals.yml`.
2. Ask where she lives and which cities she could commute to for hybrid;
   add them to `location_filter.allow` in `portals.yml`, and replace the US
   entries if she is not in the US.
3. In `config/profile.yml`, set `target_roles` from the archetypes and add:

   ```yaml
   culture_screen:
     require:
       - "Predictable full-time hours, no on-call or routine evenings/weekends"
       - "Little or no travel"
       - "Stable company with clearly scoped role"
       - "Remote-friendly or low-meeting culture"
     deprioritize_if_absent: false
   ```

4. Offer to set up the `job-alerts` plugin so her Indeed / LinkedIn /
   ZipRecruiter alert emails flow into `data/pipeline.md`. Walk her through
   `plugins/job-alerts/README.md`; she runs the Gmail sign-in step herself.

Updates: this fork updates with `git pull` only (see AGENTS.md → Update Check).
The preset lives in her own files after install, so pulls never change it.
