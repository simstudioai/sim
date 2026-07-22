import { db } from '@sim/db'
import type { SessionPolicySettings } from '@sim/db/schema'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'

const logger = createLogger('SessionPolicy')

/**
 * How long a resolved org policy is served from process memory before the
 * next request re-reads it. This TTL is also the effective upper bound on
 * org-wide session-revocation latency: a {@link bumpSecurityPolicyVersion}
 * call changes the cookie-cache version, and every cached session cookie in
 * the org falls through to a DB read within one TTL.
 */
export const SESSION_POLICY_CACHE_TTL_MS = 60 * 1000

const HOUR_MS = 60 * 60 * 1000

/**
 * Floor for `idleTimeoutHours`. Session activity is only recorded on
 * DB-path refreshes, and the session cookie cache serves reads for up to
 * 24 hours without touching the DB — an idle timeout below that window
 * would sign out demonstrably active users.
 */
export const MIN_IDLE_TIMEOUT_HOURS = 24

export interface ResolvedSessionPolicy {
  maxSessionHours: number | null
  idleTimeoutHours: number | null
  /** Org security-policy version embedded in the cookie-cache version. */
  version: number
}

interface PolicyCacheEntry {
  policy: ResolvedSessionPolicy
  fetchedAt: number
}

const policyCache = new Map<string, PolicyCacheEntry>()

const NO_POLICY: ResolvedSessionPolicy = {
  maxSessionHours: null,
  idleTimeoutHours: null,
  version: 1,
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
      .select({
        settings: organization.sessionPolicySettings,
        version: organization.securityPolicyVersion,
      })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    const settings: SessionPolicySettings = row?.settings ?? {}
    const policy: ResolvedSessionPolicy = {
      maxSessionHours: settings.maxSessionHours ?? null,
      idleTimeoutHours: settings.idleTimeoutHours ?? null,
      version: row?.version ?? 1,
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
 * session update database hooks. Returns the proposed date unchanged when
 * no policy field is set.
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
  return clamped === proposedExpiresAt.getTime() ? proposedExpiresAt : new Date(clamped)
}

/**
 * Atomically bumps the org's security-policy version and drops the local
 * policy cache entry. Every member's cached session cookie is invalidated on
 * its next request (version mismatch → DB session read), which is what makes
 * policy tightening and org-wide revocation take effect within the cache TTL
 * instead of the 24h cookie-cache lifetime.
 */
export async function bumpSecurityPolicyVersion(organizationId: string): Promise<void> {
  await db
    .update(organization)
    .set({ securityPolicyVersion: sql`${organization.securityPolicyVersion} + 1` })
    .where(eq(organization.id, organizationId))
  invalidateSessionPolicyCache(organizationId)
}

/**
 * Cookie-cache version for a session, consumed by Better Auth's
 * `session.cookieCache.version`. Embeds the member org's security-policy
 * version so bumps propagate to cached cookies; org-less sessions use the
 * static default.
 */
export async function getSessionCookieCacheVersion(session: {
  activeOrganizationId?: string | null
}): Promise<string> {
  const policy = await getSessionPolicy(session.activeOrganizationId)
  return String(policy.version)
}
