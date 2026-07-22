import { db } from '@sim/db'
import type { SessionPolicySettings } from '@sim/db/schema'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { MIN_IDLE_TIMEOUT_HOURS } from '@/lib/api/contracts/organization'
import { getMemberOrganizationId } from '@/lib/auth/security-policy'

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
 * Resolves the session policy for an organization, served from a short TTL
 * cache. Returns a no-op policy for personal (org-less) sessions.
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
    const policy: ResolvedSessionPolicy = {
      maxSessionHours: settings.maxSessionHours ?? null,
      idleTimeoutHours: settings.idleTimeoutHours ?? null,
    }
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
  activeOrganizationId?: string | null
  impersonatedBy?: string | null
  createdAt?: Date | string | null
  expiresAt?: Date | null
}

/**
 * Applies the org session policy to a session's proposed `expiresAt` from a
 * Better Auth database hook. The governing org is the session's
 * `activeOrganizationId` when present, else the user's membership — the same
 * resolution the cookie-cache version uses, so every member session
 * (including ones created before the user joined) is governed consistently.
 * Returns the original date when no clamp applies: impersonation sessions
 * are platform-admin tooling with their own short expiry, and non-member
 * sessions have no policy.
 */
export async function clampExpiryForSession(session: ClampableSession): Promise<Date | undefined> {
  if (!session.expiresAt || session.impersonatedBy) {
    return session.expiresAt ?? undefined
  }
  const organizationId =
    session.activeOrganizationId ?? (await getMemberOrganizationId(session.userId))
  if (!organizationId) return session.expiresAt

  const policy = await getSessionPolicy(organizationId)
  // Better Auth context values can cross a serialization boundary — normalize
  // createdAt in case it arrives as an ISO string rather than a Date.
  const createdAt = session.createdAt ? new Date(session.createdAt) : new Date()
  return clampSessionExpiry(policy, createdAt, session.expiresAt)
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
  policy: ResolvedSessionPolicy
): Promise<void> {
  const bounds = [sql`expires_at`]
  if (policy.maxSessionHours) {
    const maxSecs = policy.maxSessionHours * 3600
    bounds.push(sql`created_at + make_interval(secs => ${maxSecs})`)
  }
  if (policy.idleTimeoutHours) {
    const idleSecs = Math.max(policy.idleTimeoutHours, MIN_IDLE_TIMEOUT_HOURS) * 3600
    bounds.push(sql`now() + make_interval(secs => ${idleSecs})`)
  }
  if (bounds.length === 1) return

  await db.execute(sql`
    UPDATE "session" SET expires_at = LEAST(${sql.join(bounds, sql`, `)})
    WHERE impersonated_by IS NULL
      AND user_id IN (
        SELECT user_id FROM member WHERE organization_id = ${organizationId}
      )
  `)
}
