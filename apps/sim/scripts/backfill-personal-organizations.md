# Personal organizations: rollout and rollback

Every account outside a team gets a personal organization (`organization.kind = 'personal'`)
that holds its personal workspaces; on an instance-organization deployment it joins the instance
organization instead. The release that introduces it must roll out in this order.

## Rollout

1. **Migrations** `0455_personal_organizations` (adds `organization.kind`, default `team`),
   `0456_personal_organization_team_settings` and `0457_personal_organization_team_only_tables`
   (refuse team configuration, and organization rows that could not follow a person into a team,
   on personal organizations) and `0458_personal_organization_single_owner` (a personal
   organization has exactly one member, its owner). All are additive; the previous release keeps
   working against them. The migrator (`packages/db/scripts/migrate.ts`) runs DDL under a short
   `lock_timeout`, so installing a trigger fails fast instead of queueing traffic behind its lock;
   rerun on a timeout.
2. **Every process on the new release, fully rolled out**: the app, background workers and
   Trigger.dev tasks. Deploy workers and tasks with or before the app, never after it, and keep the
   rollout short: until it finishes, a process on the previous release reads a personal
   organization the new release created as a team without a plan, and refuses that person's
   invitation or SSO join. From here signup, the product shell, leaving a team and the backfill
   create personal organizations, and new personal workspaces land in them. The release serves the
   Platform UI; anyone the backfill has not reached yet is provisioned on their first visit.
3. **Dry run** `scripts/backfill-personal-organizations.ts` (no `--apply`): prints the number of
   accounts still to provision.
4. **Backfill** with `--apply --report <path>`, in batches (`--batch-size`, default 200). It is
   idempotent and resumable (`--after <cursor>` from the last printed cursor); rerun until the dry
   run reports zero, and review `skippedWorkspaceIds` (Projects shared across owners) and
   `failures` in the report.
5. **Verify** (read-only):

   ```sql
   -- Accounts in no organization (expect only accounts created since, which the shell
   -- provisions on their first visit):
   SELECT count(*) FROM "user" u WHERE NOT EXISTS (SELECT 1 FROM member m WHERE m.user_id = u.id);
   -- Personal organizations without exactly one member (expect 0):
   SELECT o.id FROM organization o LEFT JOIN member m ON m.organization_id = o.id
   WHERE o.kind = 'personal' GROUP BY o.id HAVING count(m.id) <> 1;
   -- Personal-organization owners still owning organization-less workspaces (expect only the
   -- report's skipped shared-Project workspaces):
   SELECT count(*) FROM workspace w JOIN member m ON m.user_id = w.owner_id
   JOIN organization o ON o.id = m.organization_id
   WHERE o.kind = 'personal' AND w.organization_id IS NULL;
   -- Workspaces in a personal organization in organization mode (expect 0):
   SELECT count(*) FROM workspace w JOIN organization o ON o.id = w.organization_id
   WHERE o.kind = 'personal' AND w.workspace_mode <> 'personal';
   ```

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

Rolling every process out first keeps personal organizations away from that code;
`pause-personal-organizations` is off by default and turned on only to roll back. Once the new
release serves, accounts that already own workspaces keep them organization-less (they open inside the
personal organization's shell, billed exactly as before) until the backfill attaches them; the
backfill is the only path that moves existing workspaces (and their payer bookkeeping) into
personal organizations, and attaching changes no payer. Workspace chats stay keyed to their
workspace and the organization's chat list shows each person's workspace chats, so neither the
backfill nor a rollback touches chats. A workspace chat's private memory stays in its owner's
personal graph either way: the memory scope names only a team organization.

## Rollback

Rollback is one short maintenance window: pause, revert, and deploy the previous release
straight after, in that order and without stopping in between. The new release's product shell
serves only people in an organization, and while the flag is on nothing creates one, so from the
moment an account is reverted until the previous release is live, that account sees Access
denied on every product page (and `/workspace` returns to the same page). So does anyone else in
no organization during the window: new signups, people leaving a team, and former members of a
deleted team. The previous release is what serves organization-less accounts, and it cannot run
while personal organizations remain, so the window cannot be avoided, only kept short: never
batch the revert over hours.

1. **Before the window**, size it: run the dry run below for the count, and rehearse the revert on
   a copy of the database from the host you will run it from; the run prints `elapsedSeconds` and
   `organizationsPerSecond` after every batch and in its report. Each organization is one
   transaction of about twenty sequential statements, so the round trip to the database sets the
   pace: from a host in the database's region expect on the order of 10 to 30 organizations a
   second from one process; over a tunnel with tens of milliseconds of latency, closer to one.
   The window is roughly the count divided by the rehearsed rate, plus the deploy. Run it from
   inside the region.
2. **Turn the `pause-personal-organizations` flag on in both places**: AppConfig
   (`enabled: true`) and the `PAUSE_PERSONAL_ORGANIZATIONS=true` secret. The flag fails open: a
   process that cannot fetch AppConfig falls back to the secret, which is unset on hosted
   deployments, and would go on creating personal organizations. Processes read the secret when
   they start, so set it and restart the app, background workers and Trigger.dev tasks first, then
   turn AppConfig on and wait a minute for every process's cached flags (about 30 seconds) to
   refresh. Self-hosted deployments without AppConfig set only the secret. From here nothing
   creates a personal organization and new personal workspaces are created organization-less.
3. **Dry run** `scripts/revert-personal-organizations.ts` (no `--apply`): prints the number of
   personal organizations still to revert. `--apply` refuses while the flag is off.
4. **Revert immediately** with `--apply --report <path>` in one run (idempotent; resumable with
   `--after` only to recover from a crash). Each personal organization's workspaces (and Projects)
   return to organization-less personal, its invitations are released, and the organization and
   its owner membership are deleted, under the backfill's locks. A personal organization holding
   its owner's own content (organization chats, memory spaces, Search, go links, ...) is skipped
   and listed in `skippedWithContent` with the first table found. Decide that before the window
   (the rehearsal lists them): rerun with `--delete-content` to delete that content with its
   organization, or leave those organizations in place, knowing the previous release treats them
   as described under "Why the order matters".
5. **Verify**: `SELECT count(*) FROM organization WHERE kind = 'personal'` equals the number of
   organizations deliberately kept, and the first verification query above counts every account
   whose personal organization was reverted.
6. **Roll the release back** right away. Migrations 0455 to 0458 stay: they are additive, and with
   no personal organizations left their triggers never fire. The previous release ignores the
   flag and the secret; turn both off before rolling forward again.
