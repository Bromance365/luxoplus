# QA report — queue/ (luxoplus-file-attente v2)

Tested revision: working tree on branch `claude/kind-lamport-4aw5m0` · Environment: Node 22.22, Chromium (Playwright), in-memory store via `scripts/dev-server.mjs`. **Not tested on the deployed URL.**

| # | Check | Result | Evidence / reason |
|---|---|---|---|
| 1 | Unit + API tests (`npm test`) | PASS | 17/17: ETA maths, state machine, full/paused, config validation, Montreal day roll, daily join key, token never leaked, owner-only leave, forged/expired/wrong-role sessions, login rate limit, fail-closed without secrets, cross-origin + non-JSON refused, 8 concurrent joins, daily purge |
| 2 | Browser journey (`npm run e2e`) | PASS | 16/16: staff login (bad + good PIN), TV login + QR, customer without key blocked, join, sanitised name, persistence on reload, call → TV + phone update within one poll, start, done, thank-you, EN toggle, anonymous staff call = 401, no horizontal scroll at 390 px |
| 3 | Console errors/warnings | PASS | none, apart from the deliberate 401 negative tests |
| 4 | Dependencies | PASS | `npm audit`: 0 vulnerabilities (a dev-only type package with 7 advisories was removed) |
| 5 | Secrets | PASS | none in code; `STAFF_PIN` / `SESSION_SECRET` are Netlify env vars; missing → 503 |
| 6 | XSS | PASS | DOM built with `textContent`; names filtered server-side; CSP `script-src 'self'` |
| 7 | Real Netlify Blobs store | BLOCKED | no Netlify runtime in this sandbox; conditional writes tested on a memory store only. First deploy must be smoke-tested |
| 8 | Deployed URL, headers, HTTPS | BLOCKED | not deployed (needs owner approval) |
| 9 | iOS/Android notifications and vibration | BLOCKED | no devices. Web Notification works only while the page is open; iOS needs the page open or added to the home screen. No push server by design (no personal data) |
| 10 | TV on the real screen (distance, speech voice fr-CA) | BLOCKED | needs the shop display |
| 11 | Accessibility | PARTIAL | roles, labels, `aria-live`, focus rings, reduced motion, 44 px targets. No axe/Lighthouse run → BLOCKED for a formal score |
| 12 | Comparison with the existing `luxoplus-file-attente.netlify.app` | BLOCKED | the site is unreachable from this environment and its code was not provided; this is a new build, not an edit |
| 13 | Privacy (Law 25) | OPEN | minimal data and one-day retention implemented; notice at the counter, privacy contact and Netlify hosting location still to confirm by LUXOPLUS (see README) |

## Findings
| ID | Severity | Finding | Status |
|---|---|---|---|
| Q-1 | Low | The daily QR code is a deterrent only: anyone who photographs it can join remotely until midnight. Mitigations: per-IP limit (4 / 10 min), 40-ticket cap, staff remove/close | Open (documented) |
| Q-2 | Low | Rate limits are best-effort (non-atomic counters) | Open |
| Q-3 | Info | CSP keeps `style-src 'unsafe-inline'` for dynamic style attributes; scripts remain strict | Open |

## Verdict: **BLOCKED** — code and local tests are green; READY needs items 7–10 and 13 on the deployed URL.
