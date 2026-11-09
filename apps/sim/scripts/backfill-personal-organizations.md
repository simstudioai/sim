# Personal organizations: rollout

Every account outside a team gets a personal organization (`organization.kind = 'personal'`)
that holds its personal workspaces. The release that introduces it must roll out in this order.

1. **Migrations** `0455_personal_organizations` (adds `organization.kind`, default `team`) and
   `0456_personal_organization_team_settings` (refuses team configuration on personal
   organizations). Both are additive; the previous release keeps working against them.
2. **Every process on the new release, fully rolled out**: the app, background workers and
   Trigger.dev tasks. Deploy workers and tasks with or before the app, never after it.
3. **Then** run `scripts/backfill-personal-organizations.ts` (dry run first, then `--apply`).
   It is idempotent and resumable (`--after <cursor>`).

## Why the order matters

Only the new release knows a personal organization bills its owner. Code from the previous
release reading a workspace inside a personal organization treats that organization as the
payer:

- usage, plan and limits resolve to an organization with no subscription (free-plan limits),
  so a paid owner's runs can be limited as free while that code serves them;
- storage written by that code lands on the organization's storage counter instead of the
  owner's, drifting both ledgers until the payer next changes;
- invitations, SSO admission and the organization creation route refuse the owner as
  "already in another organization".

Before the backfill runs, the new release creates personal organizations only for new signups,
for accounts that open the workspace list without belonging to any organization and without a
workspace, and for members removed from a team. Their workspaces are new and belong to accounts
without a paid plan, so the exposure during a rolling deploy is limited to those accounts' new
storage counters; running the backfill only after step 2 completes keeps every existing paid
account off the previous release's code path.
