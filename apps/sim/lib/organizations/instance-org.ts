/**
 * Instance-tier organization: one organization that every user on a deployment
 * belongs to.
 *
 * Org-scoped enterprise features — whitelabeling, PII redaction, permission
 * groups, data drains, audit scoping — resolve their settings from a
 * workspace's `organizationId`. A deployment where everyone works in personal
 * workspaces has no organization for those features to read, so enabling them
 * appears to do nothing. Setting `INSTANCE_ORG_NAME` turns on this mode: the
 * organization is provisioned on first use, every new user joins it, and their
 * workspaces are created org-owned.
 *
 * Only meaningful without billing. With billing on, organizations are created
 * and paid for through the normal subscription flow, so this module stays
 * inert.
 */

import { db } from '@sim/db'
import { member, organization, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq, sql } from 'drizzle-orm'
import {
  createOrganizationWithOwnerTx,
  validateOrganizationSlugOrThrow,
} from '@/lib/billing/organizations/create-organization'
import { env } from '@/lib/core/config/env'
import { isBillingEnabled } from '@/lib/core/config/env-flags'

const logger = createLogger('InstanceOrganization')

/** Bounds the wait for a concurrent provisioning attempt on another replica. */
const INSTANCE_ORG_LOCK_TIMEOUT_MS = 10_000

/**
 * Once provisioned, the instance organization's id never changes, so it is
 * cached for the life of the process. `null` is deliberately not cached — a
 * miss means provisioning has not happened yet, and the next caller should
 * retry rather than be told "no org" forever.
 */
let cachedInstanceOrganizationId: string | null = null

/** Derives a slug the same way the admin organization API does. */
function slugifyOrganizationName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

interface InstanceOrganizationConfig {
  name: string
  slug: string
  ownerEmail: string | null
}

/**
 * Reads instance-org configuration from the environment, or `null` when the
 * mode is off.
 *
 * Returns `null` when billing is enabled: paid organizations own their own
 * lifecycle, and silently folding every signup into one org would break
 * per-organization billing.
 */
export function getInstanceOrganizationConfig(): InstanceOrganizationConfig | null {
  if (isBillingEnabled) return null

  const name = env.INSTANCE_ORG_NAME?.trim()
  if (!name) return null

  const slug = env.INSTANCE_ORG_SLUG?.trim() || slugifyOrganizationName(name)
  if (!slug) {
    logger.error('INSTANCE_ORG_NAME does not yield a usable slug; set INSTANCE_ORG_SLUG', { name })
    return null
  }

  try {
    validateOrganizationSlugOrThrow(slug)
  } catch {
    logger.error(
      'Instance organization slug is invalid. Use lowercase letters, numbers, "-", and "_".',
      { slug }
    )
    return null
  }

  return { name, slug, ownerEmail: env.INSTANCE_ORG_OWNER_EMAIL?.trim() || null }
}

/** Whether this deployment runs in instance-organization mode. */
export function isInstanceOrganizationMode(): boolean {
  return getInstanceOrganizationConfig() !== null
}

/**
 * Returns the instance organization's id without creating it, or `null` when
 * the mode is off or provisioning has not run yet.
 */
export async function getInstanceOrganizationId(): Promise<string | null> {
  if (cachedInstanceOrganizationId) return cachedInstanceOrganizationId

  const config = getInstanceOrganizationConfig()
  if (!config) return null

  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, config.slug))
    .limit(1)

  if (row) cachedInstanceOrganizationId = row.id
  return row?.id ?? null
}

/**
 * Picks the user who will own the instance organization.
 *
 * `INSTANCE_ORG_OWNER_EMAIL` wins when it names an existing user. Otherwise the
 * user who triggered provisioning takes ownership, which on a fresh deployment
 * is whoever signs up first. Ownership can be moved later through
 * `POST /api/v1/admin/organizations/[id]/transfer-ownership`.
 */
async function resolveOwnerUserId(
  config: InstanceOrganizationConfig,
  fallbackUserId: string
): Promise<string> {
  if (!config.ownerEmail) return fallbackUserId

  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, config.ownerEmail))
    .limit(1)

  if (owner) return owner.id

  logger.warn(
    'INSTANCE_ORG_OWNER_EMAIL does not match any user yet; assigning ownership to the provisioning user instead',
    { ownerEmail: config.ownerEmail }
  )
  return fallbackUserId
}

/**
 * Returns the instance organization, creating it if this is the first call.
 *
 * Idempotent and safe to call concurrently: creation runs under a
 * transaction-scoped advisory lock keyed on the slug, and the row is re-checked
 * after the lock is held, so two replicas racing on the first signup produce
 * one organization rather than two or a unique-violation crash.
 *
 * Returns `null` when the mode is off, or when provisioning failed — callers
 * treat that as "no instance org" and carry on rather than failing the signup
 * that triggered it.
 */
export async function ensureInstanceOrganization(
  provisioningUserId: string
): Promise<string | null> {
  const config = getInstanceOrganizationConfig()
  if (!config) return null

  const existing = await getInstanceOrganizationId()
  if (existing) return existing

  try {
    const ownerUserId = await resolveOwnerUserId(config, provisioningUserId)

    /**
     * The re-check and the insert share one transaction so the advisory lock
     * covers both. `pg_advisory_xact_lock` releases at commit, so checking in
     * one transaction and creating in the next would leave a window where two
     * replicas each see no organization and each create one — and
     * `organization.slug` has no unique constraint to catch the duplicate.
     */
    const organizationId = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('lock_timeout', ${`${INSTANCE_ORG_LOCK_TIMEOUT_MS}ms`}, true)`
      )
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`instance-organization:${config.slug}`}, 0))`
      )

      const [row] = await tx
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.slug, config.slug))
        .limit(1)
      if (row) return row.id

      /**
       * The owner must not already belong to another organization — a user can
       * hold only one membership, so provisioning would fail on the member
       * insert. Surface it as a configuration problem instead.
       */
      const [ownerMembership] = await tx
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, ownerUserId))
        .limit(1)

      if (ownerMembership) {
        logger.error(
          'Cannot provision the instance organization: its owner already belongs to another organization. Move them out, or point INSTANCE_ORG_SLUG at that organization.',
          { ownerUserId, existingOrganizationId: ownerMembership.organizationId, slug: config.slug }
        )
        return null
      }

      const created = await createOrganizationWithOwnerTx(tx, {
        ownerUserId,
        name: config.name,
        slug: config.slug,
        metadata: { instanceOrganization: true },
      })

      logger.info('Provisioned the instance organization', {
        organizationId: created.organizationId,
        slug: config.slug,
        ownerUserId,
      })
      return created.organizationId
    })

    if (organizationId) cachedInstanceOrganizationId = organizationId
    return organizationId
  } catch (error) {
    /**
     * A slug collision means a concurrent replica won the race between our
     * lock release and insert; re-read rather than treating it as a failure.
     */
    const resolved = await getInstanceOrganizationId().catch(() => null)
    if (resolved) return resolved

    logger.error('Failed to provision the instance organization', {
      slug: config.slug,
      error: getErrorMessage(error),
    })
    return null
  }
}

/**
 * Adds a user to the instance organization, provisioning it if needed.
 *
 * Called from the signup hook, so it never throws: a deployment must not become
 * unable to register users because organization setup hit a problem. A user who
 * misses the join keeps working in a personal workspace and can be picked up
 * later by `apps/sim/scripts/consolidate-users-into-organization.ts`.
 *
 * No-ops when the mode is off or the user is already a member — which is the
 * case for the owner, whose membership is written during provisioning.
 *
 * The membership module is imported lazily to keep the organization and billing
 * graph out of the auth module's load path.
 */
export async function joinInstanceOrganization(userId: string): Promise<void> {
  if (!isInstanceOrganizationMode()) return

  try {
    const organizationId = await ensureInstanceOrganization(userId)
    if (!organizationId) return

    const { ensureUserInOrganization } = await import('@/lib/billing/organizations/membership')
    const result = await ensureUserInOrganization({
      userId,
      organizationId,
      role: 'member',
      skipBillingLogic: true,
      skipSeatValidation: true,
    })

    if (!result.success) {
      logger.error('Failed to add user to the instance organization', {
        userId,
        organizationId,
        reason: result.error,
      })
      return
    }

    if (!result.alreadyMember) {
      logger.info('Added user to the instance organization', { userId, organizationId })
    }
  } catch (error) {
    logger.error('Failed to add user to the instance organization', {
      userId,
      error: getErrorMessage(error),
    })
  }
}

/** Clears the cached id. Exported for tests. */
export function resetInstanceOrganizationCache(): void {
  cachedInstanceOrganizationId = null
}
