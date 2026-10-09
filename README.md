# Luxoplus queue

Customer queue, bilingual staff dashboard and waiting-room TV display for Lave Auto Luxoplus.
The existing static HTML/Supabase design is preserved. Source is in `queue/`.

Recovered from `Bromance365/luxoplus`, Claude branch `claude/kind-lamport-4aw5m0`, commit `15d84ef`.
Development continues locally on `codex/luxoplus-production-review`.

## Current status

Implemented and locally tested. **Production launch is pending owner approval.**
The existing public site remains the previous demo; no database project, staff invitation,
remote Git branch or production deployment was created during this review.

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
