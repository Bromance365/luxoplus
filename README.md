# Luxoplus queue

Customer queue, bilingual staff dashboard and waiting-room TV display for Lave Auto Luxoplus.
The existing static HTML/Supabase design is preserved. Source is in `queue/`.

Recovered from `Bromance365/luxoplus`, Claude branch `claude/kind-lamport-4aw5m0`, commit `15d84ef`.
Reviewed release is saved on GitHub branch `codex/luxoplus-production-review`.

## Current status

**Production deployed October 9, 2026; registrations paused for owner activation.**
Live site: https://luxoplus-file-attente-v2.netlify.app.
Dedicated Canadian Supabase project: `umicfoxlyfubcberbmrv`.
Staff invitation sent to `vy@abundances.ai`; accept it and set a password, then use
the staff dashboard's “Inscriptions suspendues · Rouvrir” button when ready.
Database/API checks, mobile/TV transitions and scheduled retention were verified live.
Owner password setup and physical TV sound remain to be checked by the owner.

- [QA report](queue/QA_REPORT.md): verified results and remaining limits.
- [Release approval](queue/RELEASE_APPROVAL.md): exact launch actions and owner decisions.
- [Setup and usage](queue/README.md): install, configure, run and operate the queue.

```sh
npm --prefix queue/dev ci
npm --prefix queue/dev run verify
node queue/build.mjs
```

Node 22+ and Chromium are required for tests. Set `CHROMIUM` to an existing browser executable
if no Playwright browser installation is available. There is no framework build dependency.
