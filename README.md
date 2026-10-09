# Luxoplus queue

Customer queue, bilingual staff dashboard and waiting-room TV display for Lave Auto Luxoplus.
The existing static HTML/Supabase design is preserved. Source is in `queue/`.

Recovered from `Bromance365/luxoplus`, Claude branch `claude/kind-lamport-4aw5m0`, commit `15d84ef`.
Reviewed release is saved on GitHub branch `codex/luxoplus-production-review`.

## Current status

**Production deployed and activated October 9, 2026.**
Live site: https://luxoplus-file-attente-v2.netlify.app.
Dedicated Canadian Supabase project: `umicfoxlyfubcberbmrv`.
Staff account `vy@abundances.ai` is confirmed and the signed-in dashboard was verified.
Registrations are enabled and follow the configured Monday–Saturday 08:00–18:00 hours.
Database/API checks, mobile/TV transitions and scheduled retention were verified live.
Physical TV sound remains to be checked at the garage.

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
