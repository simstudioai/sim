import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import type { DbOrTx } from '@/lib/db/types'

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

/**
 * Read on every session read, keyed by organization, so an unbounded `Map`
 * grew for the life of the process. `LRUCache` supplies both
 * the TTL and a ceiling; `invalidateSecurityPolicyVersionCache` still evicts
 * by key. Reads must test `!== undefined`, since the value is a number.
 *
 * The ceiling is a memory backstop, not an operating limit. `getSessionCookieCacheVersion`
 * feeds Better Auth's `session.cookieCache.version`, so these are read on every session
 * read — if the live key set ever exceeded the cap, LRU would start evicting inside the
 * TTL and each miss becomes one indexed lookup. That degrades to exactly the behaviour
 * before any caching existed (never a wrong answer), but it is a hit-rate cliff on a hot
 * path, so the cap is set far above any plausible per-instance working set in a 60s window.
 * Entries are a few dozen bytes, so the headroom costs single-digit MB at worst.
 */
const versionCache = new LRUCache<string, number>({
  max: 20_000,
  ttl: SECURITY_POLICY_VERSION_CACHE_TTL_MS,
})

/**
 * Resolves the org's security-policy version — the shared monotonic counter
 * behind the Better Auth cookie-cache version. It backs ALL org security
 * policies (session policies today; IP allowlisting and MFA enforcement are
 * planned consumers): any feature that needs cached session cookies to
 * re-validate bumps this one counter.
 */
export async function getSecurityPolicyVersion(
  organizationId: string | null | undefined,
  executor: DbOrTx = db
): Promise<number> {
  if (!organizationId) return DEFAULT_VERSION

  const cached = executor === db ? versionCache.get(organizationId) : undefined
  if (cached !== undefined) return cached

  try {
    const [row] = await executor
      .select({ version: organization.securityPolicyVersion })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    const version = row?.version ?? DEFAULT_VERSION
    if (executor === db) versionCache.set(organizationId, version)
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

/**
 * Wraps the value in an object because `LRUCache` cannot store `null`, and a
 * non-member is exactly what `null` means here.
 *
 * Keyed by user rather than organization, so this was the least bounded cache
 * of the three: one entry per user who ever authenticated on the process,
 * released only by an explicit join/leave invalidation.
 */
interface MembershipCacheEntry {
  organizationId: string | null
}

const membershipCache = new LRUCache<string, MembershipCacheEntry>({
  max: 100_000,
  ttl: SECURITY_POLICY_VERSION_CACHE_TTL_MS,
})

/**
 * Negative (non-member) membership results use a much shorter TTL than
 * positive ones: a user's cached `null` would otherwise let them dodge a new
 * org's policy for the full TTL after joining through ANY path — including
 * ones outside this codebase (Better Auth SSO JIT provisioning). Positive
 * results change only through leave/transfer, which invalidate explicitly.
 */
export const NEGATIVE_MEMBERSHIP_CACHE_TTL_MS = 15 * 1000

/**
 * The TTL a membership result is cached under. Named rather than inlined at the
 * `set` call because the asymmetry is a security property, not a tuning knob:
 * collapsing it to one value would silently restore the dodge the short
 * negative TTL exists to close.
 */
export function membershipCacheTtlMs(organizationId: string | null): number {
  return organizationId ? SECURITY_POLICY_VERSION_CACHE_TTL_MS : NEGATIVE_MEMBERSHIP_CACHE_TTL_MS
}

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
  userId: string | null | undefined,
  executor: DbOrTx = db
): Promise<string | null> {
  if (!userId) return null

  /** A transaction may have just created or moved the membership; shared cache entries cannot see it. */
  const cached = executor === db ? membershipCache.get(userId) : undefined
  if (cached) return cached.organizationId

  try {
    const [row] = await executor
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
      .limit(1)

    const organizationId = row?.organizationId ?? null
    if (executor === db) {
      membershipCache.set(userId, { organizationId }, { ttl: membershipCacheTtlMs(organizationId) })
    }
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
export async function getSessionCookieCacheVersion(
  session: { userId?: string | null },
  executor: DbOrTx = db
): Promise<string> {
  const organizationId = await getMemberOrganizationId(session.userId, executor)
  if (!organizationId) return 'none'
  // The org id is part of the version so moving between orgs always changes
  // the string — two orgs whose counters happen to hold the same number must
  // not produce interchangeable cookie versions.
  return `${organizationId}:${await getSecurityPolicyVersion(organizationId, executor)}`
}
