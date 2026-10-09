# Luxoplus QA — October 9, 2026

**Verdict: production deployed and verified; registrations paused for owner activation.**

Reviewed source: Claude Code session “Luxoplus queue website”, GitHub branch
`claude/kind-lamport-4aw5m0` at `15d84ef`. Reviewed changes are saved on GitHub branch
`codex/luxoplus-production-review`. The original empty Codex checkout was populated
from that branch; the older LaCie marketing page was not used or modified.

The site now runs with `APP_CONFIG.demo=false` and the dedicated Canadian Supabase
project `umicfoxlyfubcberbmrv`. Netlify deployment: `6ac95a27200ed99bd39436e0`.
Staff invitation to `vy@abundances.ai` was accepted by Supabase and the account was
authorized in `public.admins`. No staff password was chosen or changed by this agent.

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

## Verified on hosted production

- Public PostgREST board/status, registration, phone + ticket recovery and tracking pass.
- Anonymous direct queue/admin reads and staff RPC calls are rejected. RLS is enabled
  on all five tables; protected helpers are not anonymously executable.
- Staff RPCs were exercised using the approved Auth UUID and authenticated database
  role: dashboard access, call and completion pass. This does not replace a real
  browser login with the owner's chosen password, which remains pending.
- Separate Chromium contexts on the live site: 390px customer phone with Tokyo device
  timezone, 1280×720 TV and signed-out staff page. Tracking token removal, QR, called
  ticket and completion transitions pass. No uncaught browser errors were observed.
- Production CSP, nosniff, pages and pinned SDK routes pass. SQL, dev files, environment
  files and release documentation return 404. Netlify production environment variables
  are saved, and the deployed runtime uses the dedicated project/public key.
- Public Auth signup is disabled, the exact production `/admin.html` return URL is set,
  minimum password length is 12 and leaked-password protection is enabled.
- Daily retention job is active at 08:00 UTC. A temporary launch cron job successfully
  executed the same purge function; the temporary job was then removed.
- Performance advisors identified a missing service foreign-key index and lookup-log
  primary key; both are fixed in hosted SQL and the checked-in bootstrap/upgrade files.
  The 82 SQL checks pass again after these changes.
- All launch test tickets were removed; the queue, bays and revenue start empty.
  Registrations remain paused for the owner to activate after password setup.

Security advisors flag the deliberately public SECURITY DEFINER RPCs, authenticated
staff RPCs and four RLS tables with no direct-read policies. These are intentional:
public RPCs validate inputs/return limited data; staff RPCs assert membership; tables
are default-deny and direct privileges are revoked. Permission checks passed.
See [RPC advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
and [RLS policy guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
Remaining performance notices are an unused index on the new database and the default
fixed Auth connection allocation on the Micro instance; no scaling change is needed now.
See [index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
and [production configuration](https://supabase.com/docs/guides/deployment/going-into-prod).

## Limits and remaining owner checks

- **Owner login remains pending.** The invitation was accepted by Supabase; inbox
  delivery and the owner's password setup have not been observed. Recovery email
  delivery and authenticated browser Realtime remain to be checked after setup.
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
