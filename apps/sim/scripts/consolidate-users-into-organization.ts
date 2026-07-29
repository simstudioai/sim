#!/usr/bin/env bun

/**
 * Consolidates every user on a self-hosted deployment into one organization so
 * org-scoped enterprise features apply deployment-wide.
 *
 * Membership alone is not enough. Session policies and SSO provisioning resolve
 * the governing org from the user's `member` row, but whitelabeling, PII
 * redaction, permission groups, data drains, and audit scoping all resolve it
 * from `workspace.organization_id`. This script therefore does both: it adds
 * every user to the target org AND attaches their personal/grandfathered
 * workspaces to it.
 *
 * All writes go through the same helpers the product uses
 * (`createOrganizationWithOwner`, `ensureUserInOrganization`,
 * `attachOwnedWorkspacesToOrganization`), so the storage ledger, billed-account
 * routing, owner permissions, and advisory locks stay consistent. It does not
 * hand-roll SQL against `member` or `workspace`.
 *
 * Dry run by default — pass `--apply` to write.
 *
 * This is a one-time backfill for users and workspaces that predate
 * instance-organization mode. Once `INSTANCE_ORG_NAME` is set, new users join
 * the organization at signup and their workspaces are created org-owned, so
 * the script does not need to run again. With `INSTANCE_ORG_NAME` set it needs
 * no arguments at all — it targets that organization by default.
 *
 * Usage:
 *   # Backfill into the configured instance organization
 *   DATABASE_URL=... INSTANCE_ORG_NAME="Acme Inc" \
 *     bun run apps/sim/scripts/consolidate-users-into-organization.ts --apply
 *
 *   # Preview, creating a new org
 *   DATABASE_URL=... bun run apps/sim/scripts/consolidate-users-into-organization.ts \
 *     --org-name "Acme Inc" --owner-email admin@acme.com
 *
 *   # Execute
 *   DATABASE_URL=... bun run apps/sim/scripts/consolidate-users-into-organization.ts \
 *     --org-name "Acme Inc" --owner-email admin@acme.com --apply
 *
 *   # Consolidate into an org that already exists
 *   DATABASE_URL=... bun run apps/sim/scripts/consolidate-users-into-organization.ts \
 *     --org-id org_2f1c... --apply
 *
 * Options:
 *   --org-id <id>            Consolidate into this existing organization.
 *   --org-slug <slug>        Consolidate into the organization with this slug.
 *   --org-name <name>        Organization name; created if no match exists.
 *   --owner-email <email>    Owner of the organization. Required when creating.
 *   --exclude-emails <csv>   Comma-separated emails to leave out.
 *   --skip-workspaces        Add members only; do not attach workspaces.
 *   --apply                  Perform the writes. Omit for a dry run.
 *   --help                   Print this message.
 *
 * Safe to re-run: membership and workspace attachment are both idempotent, so a
 * partially completed run can simply be executed again.
 *
 * Users who already belong to a *different* organization are reported and
 * skipped — Sim allows one organization per user, and moving them would revoke
 * their workspace permissions in the org they are leaving. Their workspaces are
 * left alone too. Resolve those cases before re-running if they must be merged.
 */

import { db } from '@sim/db'
import { member, organization, session, user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { normalizeEmail } from '@sim/utils/string'
import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm'
import {
  createOrganizationWithOwner,
  OrganizationSlugInvalidError,
  OrganizationSlugTakenError,
} from '@/lib/billing/organizations/create-organization'
import { ensureUserInOrganization } from '@/lib/billing/organizations/membership'
import { isBillingEnabled, isOrganizationsEnabled } from '@/lib/core/config/env-flags'
import { getInstanceOrganizationConfig } from '@/lib/organizations/instance-org'
import { attachOwnedWorkspacesToOrganization } from '@/lib/workspaces/organization-workspaces'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

const logger = createLogger('ConsolidateUsersIntoOrganization')

/** Keeps `IN (...)` lists well under Postgres's 65535 bound-parameter ceiling. */
const QUERY_CHUNK_SIZE = 1000

interface Options {
  orgId?: string
  orgSlug?: string
  orgName?: string
  ownerEmail?: string
  excludeEmails: Set<string>
  skipWorkspaces: boolean
  apply: boolean
}

interface TargetOrganization {
  id: string | null
  name: string
  slug: string
  ownerUserId: string
  ownerEmail: string
  mustBeCreated: boolean
}

interface UserRow {
  id: string
  email: string
  name: string
}

const USAGE = `
Consolidate every user into a single organization.

  --org-id <id>            Consolidate into this existing organization
  --org-slug <slug>        Consolidate into the organization with this slug
  --org-name <name>        Organization name; created if no match exists
  --owner-email <email>    Owner of the organization (required when creating)
  --exclude-emails <csv>   Comma-separated emails to leave out
  --skip-workspaces        Add members only; do not attach workspaces
  --apply                  Perform the writes (default is a dry run)
  --help                   Print this message

Example:
  DATABASE_URL=... bun run apps/sim/scripts/consolidate-users-into-organization.ts \\
    --org-name "Acme Inc" --owner-email admin@acme.com --apply
`

function parseArgs(argv: string[]): Options {
  const options: Options = {
    excludeEmails: new Set<string>(),
    skipWorkspaces: false,
    apply: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const readValue = (): string => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`)
      }
      index += 1
      return value
    }

    switch (arg) {
      case '--org-id':
        options.orgId = readValue()
        break
      case '--org-slug':
        options.orgSlug = readValue()
        break
      case '--org-name':
        options.orgName = readValue()
        break
      case '--owner-email':
        options.ownerEmail = readValue()
        break
      case '--exclude-emails':
        for (const email of readValue().split(',')) {
          const trimmed = email.trim()
          if (trimmed) options.excludeEmails.add(normalizeEmail(trimmed))
        }
        break
      case '--skip-workspaces':
        options.skipWorkspaces = true
        break
      case '--apply':
        options.apply = true
        break
      case '--help':
      case '-h':
        console.log(USAGE)
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  /**
   * On a deployment already running instance-organization mode, the target is
   * unambiguous — consolidating anywhere else would split the deployment across
   * two organizations. Defaulting to it also makes the backfill a single
   * argument-free command.
   */
  if (!options.orgId && !options.orgSlug && !options.orgName) {
    const instanceConfig = getInstanceOrganizationConfig()
    if (instanceConfig) {
      options.orgName = instanceConfig.name
      options.orgSlug = instanceConfig.slug
      options.ownerEmail = options.ownerEmail ?? instanceConfig.ownerEmail ?? undefined
    }
  }

  if (!options.orgId && !options.orgSlug && !options.orgName) {
    throw new Error(
      'One of --org-id, --org-slug, or --org-name is required (or set INSTANCE_ORG_NAME)'
    )
  }

  return options
}

/** Mirrors the slug derivation used by `POST /api/v1/admin/organizations`. */
function slugifyOrganizationName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [row] = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  return row ?? null
}

async function findOrganizationOwner(
  organizationId: string
): Promise<{ userId: string; email: string } | null> {
  const [row] = await db
    .select({ userId: member.userId, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
    .limit(1)
  return row ?? null
}

/**
 * Resolves the organization to consolidate into, creating nothing. When the org
 * does not exist yet the returned `id` is `null` and `mustBeCreated` is true, so
 * a dry run can describe the plan without writing.
 *
 * An existing organization must already have an `owner` member row: workspace
 * attachment routes the billed account to that owner and throws without one.
 */
async function resolveTargetOrganization(options: Options): Promise<TargetOrganization> {
  const existingWhere = options.orgId
    ? eq(organization.id, options.orgId)
    : options.orgSlug
      ? eq(organization.slug, options.orgSlug)
      : eq(organization.slug, slugifyOrganizationName(options.orgName as string))

  const [existing] = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .where(existingWhere)
    .limit(1)

  if (existing) {
    const owner = await findOrganizationOwner(existing.id)
    if (!owner) {
      throw new Error(
        `Organization ${existing.id} has no member row with role "owner". Workspace attachment ` +
          'routes the billed account to the org owner and cannot run without one.'
      )
    }
    return {
      id: existing.id,
      name: existing.name,
      slug: existing.slug,
      ownerUserId: owner.userId,
      ownerEmail: owner.email,
      mustBeCreated: false,
    }
  }

  if (options.orgId) {
    throw new Error(`No organization found with id ${options.orgId}`)
  }
  if (!options.orgName) {
    throw new Error(
      `No organization found with slug ${options.orgSlug}. Pass --org-name to create it.`
    )
  }
  if (!options.ownerEmail) {
    throw new Error('--owner-email is required when the organization must be created')
  }

  const owner = await findUserByEmail(options.ownerEmail)
  if (!owner) {
    throw new Error(`No user found with email ${options.ownerEmail}`)
  }

  const ownerMembership = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, owner.id))
    .limit(1)
  if (ownerMembership.length > 0) {
    throw new Error(
      `Owner ${options.ownerEmail} already belongs to organization ${ownerMembership[0].organizationId}. ` +
        'Pass --org-id to consolidate into that organization instead of creating a new one.'
    )
  }

  return {
    id: null,
    name: options.orgName,
    slug: options.orgSlug?.trim() || slugifyOrganizationName(options.orgName),
    ownerUserId: owner.id,
    ownerEmail: owner.email,
    mustBeCreated: true,
  }
}

/** Workspaces the attach helper would pick up, counted per owning user. */
async function countAttachableWorkspacesByOwner(): Promise<Map<string, number>> {
  const rows = await db
    .select({ ownerId: workspace.ownerId, total: count() })
    .from(workspace)
    .where(
      and(
        isNull(workspace.organizationId),
        ne(workspace.workspaceMode, WORKSPACE_MODE.ORGANIZATION),
        isNull(workspace.archivedAt)
      )
    )
    .groupBy(workspace.ownerId)

  return new Map(rows.map((row) => [row.ownerId, row.total]))
}

async function countSessionsMissingActiveOrganization(userIds: string[]): Promise<number> {
  let total = 0
  for (let index = 0; index < userIds.length; index += QUERY_CHUNK_SIZE) {
    const chunk = userIds.slice(index, index + QUERY_CHUNK_SIZE)
    const [row] = await db
      .select({ total: count() })
      .from(session)
      .where(and(isNull(session.activeOrganizationId), inArray(session.userId, chunk)))
    total += row?.total ?? 0
  }
  return total
}

/**
 * Points live sessions at the organization. Better Auth stamps
 * `activeOrganizationId` from the user's member row at session creation, so
 * sessions that predate this run would otherwise carry `null` until the user
 * signs in again.
 */
async function backfillActiveOrganization(
  userIds: string[],
  organizationId: string
): Promise<number> {
  let updated = 0
  for (let index = 0; index < userIds.length; index += QUERY_CHUNK_SIZE) {
    const chunk = userIds.slice(index, index + QUERY_CHUNK_SIZE)
    const rows = await db
      .update(session)
      .set({ activeOrganizationId: organizationId })
      .where(and(isNull(session.activeOrganizationId), inArray(session.userId, chunk)))
      .returning({ id: session.id })
    updated += rows.length
  }
  return updated
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  console.log('\nConsolidate users into a single organization')
  console.log('===========================================\n')

  if (!isOrganizationsEnabled) {
    console.log(
      'WARNING: organizations are not enabled for this process. Set ORGANIZATIONS_ENABLED=true and\n' +
        '         NEXT_PUBLIC_ORGANIZATIONS_ENABLED=true on the app, or the org UI stays hidden even\n' +
        '         though the data written here is correct.\n'
    )
  }

  const target = await resolveTargetOrganization(options)

  const allUsers = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .orderBy(user.email)

  const excluded = allUsers.filter((row) => options.excludeEmails.has(normalizeEmail(row.email)))
  const candidates = allUsers.filter((row) => !options.excludeEmails.has(normalizeEmail(row.email)))

  const memberships = await db
    .select({ userId: member.userId, organizationId: member.organizationId })
    .from(member)
  const membershipByUser = new Map(memberships.map((row) => [row.userId, row.organizationId]))

  const alreadyInTarget: UserRow[] = []
  const inOtherOrganization: Array<UserRow & { organizationId: string }> = []
  const toAdd: UserRow[] = []

  for (const candidate of candidates) {
    const currentOrganizationId = membershipByUser.get(candidate.id)
    if (currentOrganizationId === undefined) {
      toAdd.push(candidate)
    } else if (target.id !== null && currentOrganizationId === target.id) {
      alreadyInTarget.push(candidate)
    } else {
      inOtherOrganization.push({ ...candidate, organizationId: currentOrganizationId })
    }
  }

  const attachableByOwner = options.skipWorkspaces
    ? new Map<string, number>()
    : await countAttachableWorkspacesByOwner()
  const consolidatedUsers = [...alreadyInTarget, ...toAdd]
  const consolidatedUserIds = new Set(consolidatedUsers.map((row) => row.id))
  const ownersToAttach = [...attachableByOwner.entries()].filter(([ownerId]) =>
    consolidatedUserIds.has(ownerId)
  )
  const workspacesToAttach = ownersToAttach.reduce((sum, [, total]) => sum + total, 0)
  const sessionsToBackfill = await countSessionsMissingActiveOrganization(
    consolidatedUsers.map((row) => row.id)
  )

  console.log('Target organization')
  console.log(`  name          ${target.name}`)
  console.log(`  slug          ${target.slug}`)
  console.log(`  id            ${target.id ?? '(will be created)'}`)
  console.log(`  owner         ${target.ownerEmail}`)
  console.log('')
  console.log('Users')
  console.log(`  total                     ${allUsers.length}`)
  console.log(`  already in target org     ${alreadyInTarget.length}`)
  console.log(`  to add as members         ${toAdd.length}`)
  console.log(`  in a different org        ${inOtherOrganization.length} (skipped)`)
  console.log(`  excluded by flag          ${excluded.length}`)
  console.log('')
  console.log('Workspaces')
  console.log(
    `  to attach                 ${workspacesToAttach}` +
      (options.skipWorkspaces ? ' (--skip-workspaces)' : ` across ${ownersToAttach.length} owners`)
  )
  console.log('')
  console.log('Sessions')
  console.log(`  activeOrganizationId to backfill  ${sessionsToBackfill}`)
  console.log('')

  if (inOtherOrganization.length > 0) {
    console.log('Users already in a different organization (not modified):')
    for (const row of inOtherOrganization) {
      console.log(`  ${row.email} -> ${row.organizationId}`)
    }
    console.log(
      '\n  Sim allows one organization per user. Moving them would revoke their permissions in\n' +
        '  the org they leave, so this script does not touch them. Remove them from that org in\n' +
        '  the UI (or delete the org) and re-run.\n'
    )
  }

  if (!options.apply) {
    console.log('Dry run — nothing was written. Re-run with --apply to execute.\n')
    return
  }

  let organizationId = target.id
  if (organizationId === null) {
    const created = await createOrganizationWithOwner({
      ownerUserId: target.ownerUserId,
      name: target.name,
      slug: target.slug,
    })
    organizationId = created.organizationId
    console.log(`Created organization ${organizationId}`)
  }

  const memberFailures: Array<{ email: string; reason: string }> = []
  let membersAdded = 0
  for (const candidate of toAdd) {
    if (candidate.id === target.ownerUserId) continue
    try {
      const result = await ensureUserInOrganization({
        userId: candidate.id,
        organizationId,
        role: 'member',
        skipBillingLogic: !isBillingEnabled,
        skipSeatValidation: !isBillingEnabled,
      })
      if (!result.success) {
        memberFailures.push({ email: candidate.email, reason: result.error ?? 'unknown error' })
      } else if (!result.alreadyMember) {
        membersAdded += 1
      }
    } catch (error) {
      memberFailures.push({ email: candidate.email, reason: getErrorMessage(error) })
    }
  }
  console.log(`Added ${membersAdded} members`)

  let workspacesAttached = 0
  const workspaceFailures: Array<{ email: string; reason: string }> = []
  if (!options.skipWorkspaces) {
    const failedMemberIds = new Set(
      memberFailures.map(
        (failure) => candidates.find((row) => row.email === failure.email)?.id ?? ''
      )
    )
    const emailByUserId = new Map(candidates.map((row) => [row.id, row.email]))

    for (const [ownerId] of ownersToAttach) {
      if (failedMemberIds.has(ownerId)) continue
      const email = emailByUserId.get(ownerId) ?? ownerId
      try {
        const result = await attachOwnedWorkspacesToOrganization({
          ownerUserId: ownerId,
          organizationId,
          externalMemberPolicy: 'keep-external',
        })
        workspacesAttached += result.attachedWorkspaceIds.length
      } catch (error) {
        workspaceFailures.push({ email, reason: getErrorMessage(error) })
      }
    }
    console.log(`Attached ${workspacesAttached} workspaces`)
  }

  const finalMemberIds = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId))
  const sessionsUpdated = await backfillActiveOrganization(
    finalMemberIds.map((row) => row.userId),
    organizationId
  )
  console.log(`Backfilled activeOrganizationId on ${sessionsUpdated} sessions`)

  console.log('')
  console.log('Summary')
  console.log(`  organization      ${organizationId}`)
  console.log(`  members total     ${finalMemberIds.length}`)
  console.log(`  members added     ${membersAdded}`)
  console.log(`  workspaces moved  ${workspacesAttached}`)
  console.log(`  skipped users     ${inOtherOrganization.length}`)
  console.log('')

  if (memberFailures.length > 0 || workspaceFailures.length > 0) {
    console.log('Failures:')
    for (const failure of memberFailures) {
      console.log(`  member    ${failure.email}: ${failure.reason}`)
    }
    for (const failure of workspaceFailures) {
      console.log(`  workspace ${failure.email}: ${failure.reason}`)
    }
    console.log('\nRe-running is safe — completed work is skipped on the next pass.\n')
    process.exitCode = 1
    return
  }

  console.log('Done. Restart the app if ORGANIZATIONS_ENABLED was changed in the same deploy.\n')
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    if (error instanceof OrganizationSlugInvalidError) {
      logger.error('Organization slug may only contain lowercase letters, numbers, "-", and "_"')
    } else if (error instanceof OrganizationSlugTakenError) {
      logger.error('That organization slug is already taken — pass --org-slug with a free value')
    } else {
      logger.error('Consolidation failed', { error: getErrorMessage(error) })
    }
    process.exit(1)
  })
