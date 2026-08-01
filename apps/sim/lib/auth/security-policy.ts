import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'

const logger = createLogger('SecurityPolicy')

/**
 * How long a resolved org security-policy version is served from process
 * memory before the next request re-reads it. This TTL is the effective upper
 * bound on org-wide session-revocation latency: a version bump changes the
 * cookie-cache version, and every cached session cookie in the org falls
 * through to a DB read within one TTL.
 */
export const SECURITY_POLICY_VERSION_CACHE_TTL_MS = 60 * 1000

const DEFAULT_VERSION = 1

interface VersionCacheEntry {
  version: number
  fetchedAt: number
}

const versionCache = new Map<string, VersionCacheEntry>()

/**
 * Resolves the org's security-policy version — the shared monotonic counter
 * behind the Better Auth cookie-cache version. It backs ALL org security
 * policies (session policies today; IP allowlisting and MFA enforcement are
 * planned consumers): any feature that needs cached session cookies to
 * re-validate bumps this one counter.
 */
export async function getSecurityPolicyVersion(
  organizationId: string | null | undefined
): Promise<number> {
  if (!organizationId) return DEFAULT_VERSION

  const cached = versionCache.get(organizationId)
  if (cached && Date.now() - cached.fetchedAt < SECURITY_POLICY_VERSION_CACHE_TTL_MS) {
    return cached.version
  }

  try {
    const [row] = await db
      .select({ version: organization.securityPolicyVersion })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    const version = row?.version ?? DEFAULT_VERSION
    versionCache.set(organizationId, { version, fetchedAt: Date.now() })
    return version
  } catch (error) {
    logger.error('Failed to resolve security policy version; using default', {
      organizationId,
      error,
    })
    return DEFAULT_VERSION
  }
}

/** Drops the cached version for an org so the next read is fresh. */
export function invalidateSecurityPolicyVersionCache(organizationId: string): void {
  versionCache.delete(organizationId)
}

interface MembershipCacheEntry {
  organizationId: string | null
  fetchedAt: number
}

const membershipCache = new Map<string, MembershipCacheEntry>()

/**
 * Negative (non-member) membership results use a much shorter TTL than
 * positive ones: a user's cached `null` would otherwise let them dodge a new
 * org's policy for the full TTL after joining through ANY path — including
 * ones outside this codebase (Better Auth SSO JIT provisioning). Positive
 * results change only through leave/transfer, which invalidate explicitly.
 */
const NEGATIVE_MEMBERSHIP_CACHE_TTL_MS = 15 * 1000

/** Drops the cached membership for a user (call when they join/leave an org). */
export function invalidateMembershipCache(userId: string): void {
  membershipCache.delete(userId)
}

/**
 * Resolves the org a user belongs to (users belong to at most one org),
 * served from a short TTL cache. Org security policies govern MEMBERS, not
 * just sessions that happen to carry an `activeOrganizationId` — a session
 * created before the user joined an org has none, and without this fallback
 * such sessions would dodge cookie-cache invalidation (and therefore
 * org-wide revocation) for up to the 24h cookie lifetime.
 */
export async function getMemberOrganizationId(
  userId: string | null | undefined
): Promise<string | null> {
  if (!userId) return null

  const cached = membershipCache.get(userId)
  if (cached) {
    const ttl = cached.organizationId
      ? SECURITY_POLICY_VERSION_CACHE_TTL_MS
      : NEGATIVE_MEMBERSHIP_CACHE_TTL_MS
    if (Date.now() - cached.fetchedAt < ttl) return cached.organizationId
  }

  try {
    const [row] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
      .limit(1)

    const organizationId = row?.organizationId ?? null
    membershipCache.set(userId, { organizationId, fetchedAt: Date.now() })
    return organizationId
  } catch (error) {
    logger.error('Failed to resolve org membership; treating session as org-less', {
      userId,
      error,
    })
    return null
  }
}

/**
 * Cookie-cache version for a session, consumed by Better Auth's
 * `session.cookieCache.version`. Embeds the member org's security-policy
 * version so bumps propagate to cached cookies. Resolved from the user's
 * MEMBERSHIP, never the session's `activeOrganizationId` — that field goes
 * stale on join/leave/transfer (it is only written at session creation), and
 * a stale org here would let cookies dodge the destination org's version
 * bumps for up to the 24h cookie lifetime. Sessions of non-members use the
 * static default.
 */
export async function getSessionCookieCacheVersion(session: {
  userId?: string | null
}): Promise<string> {
  const organizationId = await getMemberOrganizationId(session.userId)
  if (!organizationId) return 'none'
  // The org id is part of the version so moving between orgs always changes
  // the string — two orgs whose counters happen to hold the same number must
  // not produce interchangeable cookie versions.
  return `${organizationId}:${await getSecurityPolicyVersion(organizationId)}`
}
