# Luxoplus QA — October 9, 2026

**Verdict: ready for owner review; production launch pending.**

Reviewed source: Claude Code session “Luxoplus queue website”, GitHub branch
`claude/kind-lamport-4aw5m0` at `15d84ef`. Current changes are local on
`codex/luxoplus-production-review`. The original empty Codex checkout was populated
from that branch; the older LaCie marketing page was not used or modified.

The public `luxoplus-file-attente-v2.netlify.app/config.js` was checked on October 9:
`demo: true` and a placeholder Supabase URL remain. No production project, invitation,
remote push or deployment was performed during this review.

## Verified locally

Command: `npm --prefix queue/dev run verify`.
Environment: Node 22, PGlite/Postgres in WebAssembly, Chromium, separate browser contexts,
320/390px mobile widths, 1280×720 and 1920×1080 TV sizes, device timezone Asia/Tokyo.

| Check | Result | Evidence |
|---|---|---|
| SQL behavior and permissions | PASS | 82 checks: RLS on all five tables, anonymous table access denied, non-staff Auth access denied, private helpers denied, registration/limits/estimates/lifecycle/retention/upgrade |
| Build | PASS | Public file allowlist; production fails without valid URL/public key; secret keys refused; inline JavaScript parses; generated CSP uses script hashes |
| TV suite | PASS | 14 checks: bays, next tickets, privacy, Montreal timezone, QR, new-ticket highlight, pause state, portrait layout, demo, browser errors |
| Full queue workflow | PASS | 36 checks: separate customer/staff/TV contexts, registration, duplicate-submit protection, recovery, English UI, invalid login, call/finish, XSS escaping, clear-with-history, password setup, mobile widths, full TV board, 20 bays, both simultaneous bilingual calls, CSP, logout |
| Dependency audit | PASS | `npm --prefix queue/dev audit`: no reported vulnerabilities in the locked dependencies |
| Diff whitespace | PASS | `git diff --check` |

Screenshots are saved locally in `dev/shots/` and excluded from Git/deployment.
The original Claude QA report is preserved as `dev/QA_REPORT_CLAUDE_2026-10-06.md`.

## Changes made after review

- Client estimates, cached estimate timestamps and demo day rollover now use Montreal time.
- Duplicate submissions remain disabled during polling and language/render updates.
- Bay reduction is rejected while the removed bay is occupied; previous-day services
  no longer block the current day's estimates or dashboard.
- Public TV responses and announcements identify tickets by number only, with no names.
- A serving ticket cannot be cancelled by a customer; staff controls the occupied bay.
- Clearing active tickets preserves completed jobs, revenue history and ticket numbers.
- Recovery requires both phone and ticket number; lookup budget checks are serialized.
- Staff UI is bilingual and includes invitation/password setup and reset handling.
- Customer copy explains there is no automatic SMS and the page must stay open for alerts.
- Added bilingual privacy notice, required retention setup and read-only postflight SQL.
- Supabase browser SDK is pinned and hosted locally; generated CSP allows inline scripts
  by hash. TV rows fit the panel and simultaneous calls queue both bilingual announcements.
- Added atomic bootstrap/upgrade SQL, production environment validation and root Netlify setup.

## Limits and remaining launch work

- **Real Supabase is untested.** PGlite tests exercise actual SQL roles and RLS, but do
  not establish hosted PostgREST, Realtime, SMTP, or real multi-connection behavior.
  Run postflight checks, Supabase security advisors and a real multi-device test after setup.
- **Retention job is prepared, not running.** Install `supabase/retention.sql` before
  enabling production, and verify the first successful scheduled execution.
- **Real email delivery is untested.** Staff recovery uses the real SDK with a local
  auth adapter. Configure and test the approved production sender/recipient.
- **TV audio is untested on hardware.** Browser tests exercise the chime and both
  voice calls; they do not prove speaker volume, available FR/EN voices or TV sleep behavior.
- **Owner validation remains required.** Approve inherited rates/hours/bays and the
  privacy notice, hosting arrangement and retention policy. No Loi 25 certification is claimed.
- Browser alerts are foreground/browser notifications, not background push or SMS.
- Ticket recovery uses phone + ticket number and rate limits, not identity verification
  by OTP. Tracking links are bearer access and must remain private.
- No Lighthouse/axe audit or physical iPhone/Safari/TV test was performed.

Launch actions and owner choices are listed in `RELEASE_APPROVAL.md`.

Implementation references reviewed: [Supabase functions](https://supabase.com/docs/guides/database/functions),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[password flows](https://supabase.com/docs/guides/auth/passwords),
[pg_cron](https://supabase.com/docs/guides/database/extensions/pg_cron) and
[current changelog](https://supabase.com/changelog.md).
