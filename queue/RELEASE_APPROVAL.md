# Luxoplus release approval — October 9, 2026

**Code prepared and locally tested. Production remains pending.** No paid service was
created, no real staff invitation was sent, and no remote push or deployment was made.

## Proposed launch

- Repository: `Bromance365/luxoplus`; local branch `codex/luxoplus-production-review`.
- Dedicated Supabase project: `luxoplus-file-attente`, Canada Central (`ca-central-1`).
- Available Supabase organization: **vy-eliteurbanit's projects**
  (`vercel_icfg_7DEp2bsFLT7C61pAMFQXmmii`). The owner must select this organization
  before the connector can quote its actual recurring project cost.
- Proposed staff recipient: **luxoplusmtl@gmail.com**, from the existing business config.
  Invitation email requires explicit owner approval. The recipient chooses the password.
- Proposed site: **luxoplus-file-attente-v2.netlify.app**, the previously deployed demo.
  Verify access before changing it. The original site/domain is a separate follow-up
  if its account remains inaccessible; no new Netlify site or custom domain is assumed.
- Database changes: dedicated queue schema, existing prices/settings, protected staff
  account, daily anonymization after 30 days. Tables from other businesses are untouched.
- Publishing: push the reviewed branch only after approval; confirm whether Netlify
  builds it automatically before pushing. Deploy the approved production artifact.

## Existing business defaults to validate

| Package | Sedan CAD before tax | SUV CAD before tax | Truck CAD before tax | Duration |
|---|---:|---:|---:|---:|
| Express | 29.99 | 39.99 | 49.99 | 30 min |
| Signature+ | 74.99 | 84.99 | 94.99 | 120 min |
| ABSOLUX | 234.99 | 254.99 | 279.99 | 300 min |

Hours: Monday–Saturday, 08:00–18:00 Montreal time. Two bays. Completion grace:
30 min after closing. These are inherited configuration values, not newly verified
business promises. The owner should approve or correct them before public use.

## Verification after approval

1. Quote the cost for the selected organization and obtain the connector's required
   cost confirmation before creating a project. Check whether a Luxoplus project
   already exists before retrying any ambiguous creation result.
2. Apply the schema, disable public signup, configure exact Auth redirect URLs,
   invite the approved staff recipient and add their UUID to `public.admins`.
3. Install the retention job; run postflight checks and Supabase security advisors.
4. Deploy with public environment keys and `LUX_DEMO=false`; verify actual CSP,
   asset routes and rejection of internal SQL/dev files.
5. Complete registration on one phone, recover on another, call from staff, confirm
   customer and TV transitions, finish service, and verify history and rates.
6. Verify invitation/reset email delivery and the actual TV speaker volume/FR+EN voices.
7. Confirm owner acceptance of privacy notice and operating settings. Mark the release
   production-ready only after these items pass.

The new release sends no automatic SMS. Browser alerts require the tracking page to
remain open. SMS integration is outside this release and would require a separate
provider, consent workflow and cost approval.

## Rollback and failed launch

Before publishing, retain the previous Netlify deploy ID and record the approved
settings/price values. Bootstrap and upgrade SQL run in transactions: an error aborts
the changes rather than leaving a partially installed public API.

If production verification fails, pause real registrations and preserve all tickets.
Restore a production-compatible artifact or show a maintenance page; do not silently
route active customers to a browser-only demo. Database rollback uses reviewed corrective
SQL and preserved records, never dropping the project or deleting service history.
Check that the restored build matches the database RPC contract before reopening.
