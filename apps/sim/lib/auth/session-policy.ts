import { db } from '@sim/db'
import type { SessionPolicySettings } from '@sim/db/schema'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { MIN_IDLE_TIMEOUT_HOURS } from '@/lib/api/contracts/organization'
import { getMemberOrganizationId, invalidateMembershipCache } from '@/lib/auth/security-policy'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled } from '@/lib/core/config/env-flags'

const logger = createLogger('SessionPolicy')

/** How long a resolved org session policy is served from process memory. */
export const SESSION_POLICY_CACHE_TTL_MS = 60 * 1000

const HOUR_MS = 60 * 60 * 1000

export interface ResolvedSessionPolicy {
  maxSessionHours: number | null
  idleTimeoutHours: number | null
}

interface PolicyCacheEntry {
  policy: ResolvedSessionPolicy
  fetchedAt: number
}

const policyCache = new Map<string, PolicyCacheEntry>()

const NO_POLICY: ResolvedSessionPolicy = {
  maxSessionHours: null,
  idleTimeoutHours: null,
}

/**
 * Resolves the EFFECTIVE session policy for an organization, served from a
 * short TTL cache. Returns a no-op policy for personal (org-less) sessions
 * and — mirroring data-retention's plan-gated effective settings — for
 * hosted orgs no longer on an Enterprise plan: stored limits stop enforcing
 * automatically on downgrade, since the enterprise-gated settings UI can no
 * longer manage them.
 */
export async function getSessionPolicy(
  organizationId: string | null | undefined
): Promise<ResolvedSessionPolicy> {
  if (!organizationId) return NO_POLICY

  const cached = policyCache.get(organizationId)
  if (cached && Date.now() - cached.fetchedAt < SESSION_POLICY_CACHE_TTL_MS) {
    return cached.policy
  }

  try {
    const [row] = await db
      .select({ settings: organization.sessionPolicySettings })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    const settings: SessionPolicySettings = row?.settings ?? {}
    const hasBounds = Boolean(settings.maxSessionHours || settings.idleTimeoutHours)
    const isEntitled =
      !hasBounds || !isBillingEnabled || (await isOrganizationOnEnterprisePlan(organizationId))
    const policy: ResolvedSessionPolicy = isEntitled
      ? {
          maxSessionHours: settings.maxSessionHours ?? null,
          idleTimeoutHours: settings.idleTimeoutHours ?? null,
        }
      : NO_POLICY
    policyCache.set(organizationId, { policy, fetchedAt: Date.now() })
    return policy
  } catch (error) {
    logger.error('Failed to resolve session policy; applying no policy', {
      organizationId,
      error,
    })
    return NO_POLICY
  }
}

/** Drops the cached policy for an org so the next read is fresh. */
export function invalidateSessionPolicyCache(organizationId: string): void {
  policyCache.delete(organizationId)
}

/**
 * Clamps a proposed session `expiresAt` to the org policy:
 * `min(proposed, createdAt + maxSessionHours, now + idleTimeoutHours)`.
 *
 * Better Auth's sliding refresh rewrites `expiresAt` to `now + expiresIn`
 * (30 days) on every refresh, which would silently stretch a shortened
 * session back out — so this clamp must run in BOTH the session create and
 * session update database hooks. The idle floor guards values that bypassed
 * contract validation (legacy rows, direct DB writes).
 */
export function clampSessionExpiry(
  policy: ResolvedSessionPolicy,
  createdAt: Date,
  proposedExpiresAt: Date,
  now: Date = new Date()
): Date {
  let clamped = proposedExpiresAt.getTime()
  if (policy.maxSessionHours) {
    clamped = Math.min(clamped, createdAt.getTime() + policy.maxSessionHours * HOUR_MS)
  }
  if (policy.idleTimeoutHours) {
    const idleHours = Math.max(policy.idleTimeoutHours, MIN_IDLE_TIMEOUT_HOURS)
    clamped = Math.min(clamped, now.getTime() + idleHours * HOUR_MS)
  }
  return new Date(clamped)
}

/**
 * Session shape shared by the Better Auth create/update database hooks —
 * the fields the clamp guards need.
 */
interface ClampableSession {
  userId?: string | null
  impersonatedBy?: string | null
  createdAt?: Date | string | null
  expiresAt?: Date | string | null
}

/**
 * Applies the org session policy to a session's proposed `expiresAt` from a
 * Better Auth database hook. The governing org is the user's MEMBERSHIP —
 * never the session row's `activeOrganizationId`, which goes stale on
 * join/leave/transfer — matching the cookie-cache version resolution, so
 * every member session (including ones created before the user joined or
 * carried across a transfer) is governed consistently. Callers that have
 * JUST resolved the membership themselves (the session create hook) pass it
 * as `freshMembershipOrgId` to skip the duplicate lookup. Returns the
 * original date when no clamp applies: impersonation sessions are
 * platform-admin tooling with their own short expiry, and non-member
 * sessions have no policy.
 */
export async function clampExpiryForSession(
  session: ClampableSession,
  freshMembershipOrgId?: string | null
): Promise<Date | undefined> {
  // Better Auth context values can cross a serialization boundary — normalize
  // date fields in case they arrive as ISO strings rather than Dates.
  const expiresAt = session.expiresAt ? new Date(session.expiresAt) : undefined
  if (!expiresAt || session.impersonatedBy) {
    return expiresAt
  }
  const organizationId =
    freshMembershipOrgId !== undefined
      ? freshMembershipOrgId
      : await getMemberOrganizationId(session.userId)
  if (!organizationId) return expiresAt

  const policy = await getSessionPolicy(organizationId)
  const createdAt = session.createdAt ? new Date(session.createdAt) : new Date()
  return clampSessionExpiry(policy, createdAt, expiresAt)
}

/**
 * Eagerly clamps every existing member session to the given policy in a
 * single SQL statement — the SQL twin of {@link clampSessionExpiry}, kept in
 * this module so the two encodings of the clamp cannot drift. Runs when a
 * policy is saved so tightening applies without waiting for each session's
 * next refresh; `LEAST` never extends an already-shorter expiry, and
 * impersonation sessions are exempt. Targets sessions by org MEMBERSHIP (not
 * `active_organization_id`) — the same scope the hooks govern via the
 * membership fallback. No-ops when the policy sets no bounds.
 */
export async function eagerClampOrgSessions(
  organizationId: string,
  policy: ResolvedSessionPolicy,
  executor: Pick<typeof db, 'execute'> = db
): Promise<void> {
  const bounds = clampBoundsSql(policy)
  if (!bounds) return

  await executor.execute(sql`
    UPDATE "session" SET expires_at = LEAST(${bounds})
    WHERE impersonated_by IS NULL
      AND user_id IN (
        SELECT user_id FROM member WHERE organization_id = ${organizationId}
      )
  `)
}

/**
 * Applies the org's session policy to a user who just JOINED the org:
 * invalidates their cached membership (so the cookie-version and hook-clamp
 * fallbacks see the new org immediately) and clamps their pre-join sessions,
 * which otherwise keep their old expiry until the next sliding refresh.
 * Best-effort by design — a failure here must never fail the join; the
 * update-hook clamp self-heals within one refresh cycle.
 */
export async function applySessionPolicyToNewMember(
  userId: string,
  organizationId: string
): Promise<void> {
  try {
    invalidateMembershipCache(userId)
    const policy = await getSessionPolicy(organizationId)
    const bounds = clampBoundsSql(policy)
    if (!bounds) return

    await db.execute(sql`
      UPDATE "session" SET expires_at = LEAST(${bounds})
      WHERE user_id = ${userId} AND impersonated_by IS NULL
    `)
  } catch (error) {
    logger.error('Failed to apply session policy to new member; next refresh re-clamps', {
      userId,
      organizationId,
      error,
    })
  }
}

/** SQL argument list for the LEAST() clamp, or null when the policy is empty. */
function clampBoundsSql(policy: ResolvedSessionPolicy) {
  const bounds = [sql`expires_at`]
  if (policy.maxSessionHours) {
    const maxSecs = policy.maxSessionHours * 3600
    bounds.push(sql`created_at + make_interval(secs => ${maxSecs})`)
  }
  if (policy.idleTimeoutHours) {
    const idleSecs = Math.max(policy.idleTimeoutHours, MIN_IDLE_TIMEOUT_HOURS) * 3600
    bounds.push(sql`now() + make_interval(secs => ${idleSecs})`)
  }
  if (bounds.length === 1) return null
  return sql.join(bounds, sql`, `)
}
