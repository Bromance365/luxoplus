# Luxoplus launch record — October 9, 2026

**Production deployed and activated.**

The owner approved the organization and staff recipient, then explicitly approved
US$10/month additional Micro compute plus usage overages before project creation.
The owner then authorized completing activation through the available access. The staff
account is confirmed, its signed-in dashboard was verified, and registrations were
enabled from that account on October 9. The public registration form was checked live.

## Deployed setup

- Live site: https://luxoplus-file-attente-v2.netlify.app
- Staff: https://luxoplus-file-attente-v2.netlify.app/admin.html
- TV: https://luxoplus-file-attente-v2.netlify.app/tv.html
- Staff invitation: **vy@abundances.ai**; authorized in `public.admins`.
  The owner chooses the password using the invitation email. Public contact details
  remain those of Luxoplus.
- Supabase: `luxoplus-file-attente`, `umicfoxlyfubcberbmrv`, Canada Central.
  Organization: **vy-eliteurbanit's projects** (`vercel_icfg_7DEp2bsFLT7C61pAMFQXmmii`).
- Netlify: existing site `1a3e5fcc-e8e7-4408-bbd3-a0f2ea91f586`, UREM team.
  Production deployment: `6ac95a27200ed99bd39436e0`.
  The site uses manual uploads; no Git build or new domain was configured.
- Repository: `Bromance365/luxoplus`, branch `codex/luxoplus-production-review`.
- Auth: public signup disabled; exact `/admin.html` redirect and default return URL;
  12-character minimum password and leaked-password protection.
- Retention: active daily job `luxoplus-personal-data-retention` at 08:00 UTC,
  anonymizing personal data older than 30 days. A temporary cron execution passed
  and its temporary job was removed.
- Netlify production variables saved: `LUX_DEMO=false`, dedicated Supabase URL and
  public publishable key. The production artifact contains no server secret or SQL.
- Dedicated database schema, indexes and protected staff access are installed.
  Other businesses' databases are untouched. Launch test data was removed.

## Activation completed

The account has a confirmed email, a password and a successful sign-in. The authenticated
staff dashboard showed an empty queue and successfully enabled registrations using its
normal staff RPC. No password was entered, read or changed by this agent.
The server also confirms an active queue Realtime subscription for the approved staff account.

Registrations now follow the configured business hours and service-duration limits.
The owner can pause them with **Inscriptions ouvertes · Suspendre** in the dashboard.
On the physical TV, open `/tv.html`, enable sound, and check volume and FR/EN voices.

Password setup was not observed directly; the confirmed account and signed-in dashboard
were verified. Physical TV audio and real phones/Safari have not been observed. Hosted public API,
mobile tracking, separate TV polling, staff database roles, call/completion, permissions,
headers and scheduled cleanup pass. See `QA_REPORT.md` for evidence and advisor notes.

## Inherited business settings

| Package | Sedan CAD before tax | SUV CAD before tax | Truck CAD before tax | Duration |
|---|---:|---:|---:|---:|
| Express | 29.99 | 39.99 | 49.99 | 30 min |
| Signature+ | 74.99 | 84.99 | 94.99 | 120 min |
| ABSOLUX | 234.99 | 254.99 | 279.99 | 300 min |

Monday–Saturday, 08:00–18:00 Montreal time. Two bays. Completion grace: 30 minutes
after closing. These values come from the recovered project and still require the
operator's independent business validation; activation uses these inherited values.

No automatic SMS is sent. Browser alerts require the tracking page to remain open.
SMS would require a separate provider, consent workflow and cost approval.

## Rollback

Previous demo deployment: `6ac5202a7f18a8ad0af75280` (October 6, 12:22 PM).
It is suitable as a rollback only while no real customer tickets exist.

If production fails after customers join, pause registrations and preserve all tickets.
Restore a production-compatible artifact or show maintenance; never send active
customers to the browser-only demo. Use corrective SQL and preserved records rather
than dropping the database or deleting service history. Bootstrap and upgrade SQL are
transactional. Check the restored frontend's RPC contract before reopening.
