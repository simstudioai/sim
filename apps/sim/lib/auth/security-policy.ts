import { db } from '@sim/db'
import type { SessionPolicySettings } from '@sim/db/schema'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { isOrganizationsEnabled } from '@/lib/core/config/env-flags'

const logger = createLogger('SecurityPolicy')

/**
 * How long a resolved org security record is served from process memory before
 * the next request re-reads it. This TTL is the effective upper bound on
 * org-wide session-revocation latency: a version bump changes the cookie-cache
 * version, and every cached session cookie in the org falls through to a DB
 * read within one TTL.
 */
export const SECURITY_POLICY_CACHE_TTL_MS = 60 * 1000

/**
 * After a failed read the last known-good record keeps being served, but its
 * timestamp is rolled back to leave this much life so a sustained outage
 * retries periodically instead of on every request.
 */
const ERROR_RETRY_BACKOFF_MS = 5 * 1000

/**
 * Entry caps. Both maps only ever grow through explicit writes, so without a
 * bound a long-lived process accumulates one entry per distinct org/user it
 * has ever served. Eviction drops expired entries first, then the
 * least-recently-refreshed ones.
 */
const MAX_ORG_CACHE_ENTRIES = 5_000
const MAX_MEMBERSHIP_CACHE_ENTRIES = 20_000

const DEFAULT_VERSION = 1

/**
 * The org security state that governs cached session cookies, read as ONE row
 * so its two fields can never be observed out of sync. Splitting them across
 * independent caches allowed a pod to see a bumped `version` (which forces a
 * session refresh) while still holding the pre-bump `sessionPolicySettings` —
 * the refresh then re-clamped against the stale policy and stretched the
 * session back out, silently undoing a just-saved tightening.
 */
export interface OrgSecurityRecord {
  /**
   * Monotonic counter behind the Better Auth cookie-cache version. It backs
   * ALL org security policies (session policies today; IP allowlisting and MFA
   * enforcement are planned consumers): any feature that needs cached session
   * cookies to re-validate bumps this one counter.
   */
  version: number
  sessionPolicySettings: SessionPolicySettings | null
}

interface OrgSecurityCacheEntry extends OrgSecurityRecord {
  fetchedAt: number
}

const orgSecurityCache = new Map<string, OrgSecurityCacheEntry>()

/**
 * Fraction of the cap an over-capacity prune evicts down to. Trimming to a low
 * water mark rather than exactly to the cap is what keeps eviction amortized
 * O(1): pruning back to the cap would leave the very next insert over again,
 * so every subsequent write would rescan the whole map.
 */
const PRUNE_TARGET_RATIO = 0.9

/**
 * Evicts down to a low water mark, expired entries first. Map iteration follows
 * insertion order and {@link touch} re-inserts on every refresh, so whatever
 * remains at the head is the least recently refreshed.
 */
function prune(cache: Map<string, { fetchedAt: number }>, maxEntries: number): void {
  if (cache.size <= maxEntries) return
  const target = Math.floor(maxEntries * PRUNE_TARGET_RATIO)
  const cutoff = Date.now() - SECURITY_POLICY_CACHE_TTL_MS
  for (const [key, entry] of cache) {
    if (cache.size <= target) break
    if (entry.fetchedAt < cutoff) cache.delete(key)
  }
  for (const key of cache.keys()) {
    if (cache.size <= target) break
    cache.delete(key)
  }
}

/** Re-inserts so insertion order tracks recency of refresh, then prunes. */
function touch<T extends { fetchedAt: number }>(
  cache: Map<string, T>,
  key: string,
  entry: T,
  maxEntries: number
): void {
  cache.delete(key)
  cache.set(key, entry)
  prune(cache, maxEntries)
}

/**
 * Resolves the org's security record from a short TTL cache. On a read failure
 * the last known-good record keeps being served: falling back to defaults
 * would drop the org's session bounds entirely, disabling a security control
 * because of a transient database blip.
 */
export async function getOrgSecurityRecord(
  organizationId: string,
  options: { bypassCache?: boolean } = {}
): Promise<OrgSecurityRecord> {
  const cached = orgSecurityCache.get(organizationId)
  if (
    !options.bypassCache &&
    cached &&
    Date.now() - cached.fetchedAt < SECURITY_POLICY_CACHE_TTL_MS
  ) {
    return cached
  }

  try {
    const [row] = await db
      .select({
        version: organization.securityPolicyVersion,
        sessionPolicySettings: organization.sessionPolicySettings,
      })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    const record: OrgSecurityRecord = {
      version: row?.version ?? DEFAULT_VERSION,
      sessionPolicySettings: row?.sessionPolicySettings ?? null,
    }
    touch(
      orgSecurityCache,
      organizationId,
      { ...record, fetchedAt: Date.now() },
      MAX_ORG_CACHE_ENTRIES
    )
    return record
  } catch (error) {
    if (cached) {
      logger.error('Failed to refresh org security record; serving last known-good', {
        organizationId,
        error,
      })
      cached.fetchedAt = Date.now() - SECURITY_POLICY_CACHE_TTL_MS + ERROR_RETRY_BACKOFF_MS
      return cached
    }
    logger.error('Failed to resolve org security record; using defaults', {
      organizationId,
      error,
    })
    return { version: DEFAULT_VERSION, sessionPolicySettings: null }
  }
}

/** Resolves just the cookie-cache version component of the org security record. */
export async function getSecurityPolicyVersion(
  organizationId: string | null | undefined
): Promise<number> {
  if (!organizationId) return DEFAULT_VERSION
  return (await getOrgSecurityRecord(organizationId)).version
}

/**
 * Drops the cached security record for an org so the next read is fresh. One
 * entry covers both the version and the session policy, so a caller cannot
 * invalidate one and forget the other.
 */
export function invalidateOrgSecurityCache(organizationId: string): void {
  orgSecurityCache.delete(organizationId)
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
 * ones outside this codebase (Better Auth SSO JIT provisioning writes `member`
 * rows straight through the adapter, and this app registers no `member`
 * database hook that could observe it). Positive results change only through
 * leave/transfer, which invalidate explicitly.
 */
const NEGATIVE_MEMBERSHIP_CACHE_TTL_MS = 15 * 1000

/** Drops the cached membership for a user (call when they join/leave an org). */
export function invalidateMembershipCache(userId: string): void {
  membershipCache.delete(userId)
}

/**
 * Resolves the org a user belongs to (users belong to at most one org — see the
 * `member_user_id_unique` index), served from a short TTL cache. Org security
 * policies govern MEMBERS, not just sessions that happen to carry an
 * `activeOrganizationId` — a session created before the user joined an org has
 * none, and without this fallback such sessions would dodge cookie-cache
 * invalidation (and therefore org-wide revocation) for up to the 24h cookie
 * lifetime.
 */
export async function getMemberOrganizationId(
  userId: string | null | undefined
): Promise<string | null> {
  if (!userId) return null

  const cached = membershipCache.get(userId)
  if (cached) {
    const ttl = cached.organizationId
      ? SECURITY_POLICY_CACHE_TTL_MS
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
    touch(
      membershipCache,
      userId,
      { organizationId, fetchedAt: Date.now() },
      MAX_MEMBERSHIP_CACHE_ENTRIES
    )
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
 * `session.cookieCache.version` on EVERY authenticated request. Embeds the
 * member org's security-policy version so bumps propagate to cached cookies.
 * Resolved from the user's MEMBERSHIP, never the session's
 * `activeOrganizationId` — that field goes stale on join/leave/transfer (it is
 * only written at session creation), and a stale org here would let cookies
 * dodge the destination org's version bumps for up to the 24h cookie lifetime.
 * Sessions of non-members — and every session when organizations are disabled
 * for the deployment — use the static default and cost no lookups.
 */
export async function getSessionCookieCacheVersion(session: {
  userId?: string | null
}): Promise<string> {
  if (!isOrganizationsEnabled) return 'none'
  const organizationId = await getMemberOrganizationId(session.userId)
  if (!organizationId) return 'none'
  // The org id is part of the version so moving between orgs always changes
  // the string — two orgs whose counters happen to hold the same number must
  // not produce interchangeable cookie versions.
  return `${organizationId}:${await getSecurityPolicyVersion(organizationId)}`
}
