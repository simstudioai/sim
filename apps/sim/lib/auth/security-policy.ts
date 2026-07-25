import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
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
const SECURITY_POLICY_VERSION_CACHE_TTL_MS = 60 * 1000
const SECURITY_POLICY_VERSION_CACHE_MAX_ENTRIES = 5_000

const MEMBERSHIP_CACHE_TTL_MS = 60 * 1000
const MEMBERSHIP_CACHE_MAX_ENTRIES = 20_000

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

const DEFAULT_VERSION = 1

const versionCache = new LRUCache<string, number>({
  max: SECURITY_POLICY_VERSION_CACHE_MAX_ENTRIES,
  ttl: SECURITY_POLICY_VERSION_CACHE_TTL_MS,
})

/**
 * Boxed because a resolved non-member is a cached VALUE, not a cache miss, and
 * `LRUCache` constrains values to non-nullish types — so `null` cannot be
 * stored directly and would be indistinguishable from a miss if it could.
 */
interface MembershipCacheEntry {
  organizationId: string | null
}

const membershipCache = new LRUCache<string, MembershipCacheEntry>({
  max: MEMBERSHIP_CACHE_MAX_ENTRIES,
  ttl: MEMBERSHIP_CACHE_TTL_MS,
})

/**
 * Resolves the org's security-policy version — the shared monotonic counter
 * behind the Better Auth cookie-cache version. It backs ALL org security
 * policies (session policies today; IP allowlisting and MFA enforcement are
 * planned consumers): any feature that needs cached session cookies to
 * re-validate bumps this one counter.
 *
 * A failed read prefers whatever this process last knew over the default. The
 * default is not the safe fallback it looks like: it is the version a
 * never-bumped org carries, so returning it can MATCH a pre-bump cookie and
 * keep a just-revoked session serving from the cookie cache. A retained or
 * freshly published value can only be equal or higher, so it either forces the
 * same revalidation or more of it.
 */
export async function getSecurityPolicyVersion(
  organizationId: string | null | undefined
): Promise<number> {
  if (!organizationId) return DEFAULT_VERSION

  const cached = versionCache.get(organizationId)
  if (cached !== undefined) return cached

  try {
    const [row] = await db
      .select({ version: organization.securityPolicyVersion })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    const version = row?.version ?? DEFAULT_VERSION
    // Re-check after the await. The counter only ever increments, so a value
    // that landed while this read was in flight is newer — neither store nor
    // return ours, or a late read would re-serve a pre-bump version and keep
    // cookies matched past a revocation.
    const concurrent = versionCache.get(organizationId)
    if (concurrent !== undefined && concurrent > version) return concurrent

    versionCache.set(organizationId, version)
    return version
  } catch (error) {
    logger.error('Failed to resolve security policy version', { organizationId, error })
    // A publish, or a concurrent read, may have landed while this one was in
    // flight. Prefer it — the default could reproduce exactly the version a
    // pre-bump cookie carries, leaving a revoked session on the cookie cache.
    return versionCache.get(organizationId) ?? DEFAULT_VERSION
  }
}

/**
 * Seeds THIS process with the version a write just committed. Other instances
 * still pick it up on their own next read, so org-wide propagation remains
 * bounded by {@link SECURITY_POLICY_VERSION_CACHE_TTL_MS} — this only removes
 * the calling instance's own re-read.
 *
 * Deliberately a SET rather than a delete. Deleting would leave no floor for the
 * monotonic guard above, so a read that started before the bump could land
 * afterwards and re-seed the pre-bump version for a full TTL — exactly the
 * cookie-invalidation delay the bump exists to avoid. Callers already have the
 * new value from their `RETURNING` clause, so this also saves a redundant read.
 */
export function setSecurityPolicyVersion(organizationId: string, version: number): void {
  const current = versionCache.get(organizationId)
  if (current !== undefined && current > version) return
  versionCache.set(organizationId, version)
}

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
  if (cached) return cached.organizationId

  const [row] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)

  const organizationId = row?.organizationId ?? null
  membershipCache.set(
    userId,
    { organizationId },
    { ttl: organizationId ? MEMBERSHIP_CACHE_TTL_MS : NEGATIVE_MEMBERSHIP_CACHE_TTL_MS }
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
