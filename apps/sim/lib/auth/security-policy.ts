import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { isOrganizationsEnabled } from '@/lib/core/config/env-flags'

const logger = createLogger('SecurityPolicy')

/**
 * How long a resolved org security-policy version is served from process
 * memory before the next request re-reads it. This TTL is the effective upper
 * bound on org-wide session-revocation latency: a version bump changes the
 * cookie-cache version, and every cached session cookie in the org falls
 * through to a DB read within one TTL.
 *
 * Only the VERSION is cached. It is read on every authenticated request, and
 * Better Auth offers no cross-instance invalidation for cookie caches — its own
 * guidance for immediate revocation is to disable cookie caching entirely — so
 * a short TTL is the deliberate trade this feature makes. The session POLICY is
 * never cached; it is read fresh at enforcement time (see `session-policy.ts`),
 * which is what keeps a stale version from ever pairing with a stale policy.
 */
export const SECURITY_POLICY_VERSION_CACHE_TTL_MS = 60 * 1000

/**
 * Entry caps. Both maps only ever grow through explicit writes, so without a
 * bound a long-lived process accumulates one entry per distinct org/user it has
 * ever served.
 */
const MAX_VERSION_CACHE_ENTRIES = 5_000
const MAX_MEMBERSHIP_CACHE_ENTRIES = 20_000

/**
 * Fraction of the cap an over-capacity prune evicts down to. Trimming to a low
 * water mark rather than exactly to the cap is what keeps eviction amortized
 * O(1): pruning back to the cap would leave the very next insert over again, so
 * every subsequent write would rescan the whole map.
 */
const PRUNE_TARGET_RATIO = 0.9

const DEFAULT_VERSION = 1

/**
 * Evicts down to a low water mark, expired entries first. Map iteration follows
 * insertion order and {@link touch} re-inserts on every refresh, so whatever
 * remains at the head is the least recently refreshed.
 */
function prune(cache: Map<string, { fetchedAt: number }>, maxEntries: number): void {
  if (cache.size <= maxEntries) return
  const target = Math.floor(maxEntries * PRUNE_TARGET_RATIO)
  const cutoff = Date.now() - SECURITY_POLICY_VERSION_CACHE_TTL_MS
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
 *
 * A failed read falls back to the default rather than the last known value.
 * That errs toward MORE revalidation, not less: a version that reads lower than
 * the stored one mismatches the cookie and forces a database session read.
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
    // The counter only ever increments, so a read resolving LOWER than what is
    // already cached started before the newer one. Neither store it nor return
    // it: a late value would re-serve a pre-bump version, keeping cookies
    // matched and letting revoked sessions stay on the cookie cache.
    const current = versionCache.get(organizationId)
    if (current && current.version > version) return current.version

    touch(
      versionCache,
      organizationId,
      { version, fetchedAt: Date.now() },
      MAX_VERSION_CACHE_ENTRIES
    )
    return version
  } catch (error) {
    logger.error('Failed to resolve security policy version; using default', {
      organizationId,
      error,
    })
    return DEFAULT_VERSION
  }
}

/**
 * Publishes the authoritative version a write just committed.
 *
 * Deliberately a SET rather than a delete. Deleting would leave no floor for the
 * monotonic guard above, so a read that started before the bump could land
 * afterwards and re-seed the pre-bump version for a full TTL — exactly the
 * cookie-invalidation delay the bump exists to avoid. Callers already have the
 * new value from their `RETURNING` clause, so this also saves a redundant read.
 */
export function setSecurityPolicyVersion(organizationId: string, version: number): void {
  const current = versionCache.get(organizationId)
  if (current && current.version > version) return
  touch(versionCache, organizationId, { version, fetchedAt: Date.now() }, MAX_VERSION_CACHE_ENTRIES)
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
 *
 * Throws if the lookup fails. Callers that can tolerate an unknown membership
 * use {@link getMemberOrganizationIdSafe}; the session-create path deliberately
 * does not, so a failed read cannot be mistaken for "not in an org".
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
}

/** {@link getMemberOrganizationId}, treating a failed lookup as org-less. */
async function getMemberOrganizationIdSafe(
  userId: string | null | undefined
): Promise<string | null> {
  try {
    return await getMemberOrganizationId(userId)
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
 *
 * Never throws: this runs on every request, and a failed membership read here
 * yields the default version, whose only effect is a cookie mismatch and a
 * database session read.
 */
export async function getSessionCookieCacheVersion(session: {
  userId?: string | null
}): Promise<string> {
  if (!isOrganizationsEnabled) return 'none'
  const organizationId = await getMemberOrganizationIdSafe(session.userId)
  if (!organizationId) return 'none'
  // The org id is part of the version so moving between orgs always changes
  // the string — two orgs whose counters happen to hold the same number must
  // not produce interchangeable cookie versions.
  return `${organizationId}:${await getSecurityPolicyVersion(organizationId)}`
}
