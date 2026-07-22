import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'

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

/**
 * Atomically bumps the org's security-policy version and drops the local
 * cache entry. Every member's cached session cookie is invalidated on its
 * next request (version mismatch → DB session read), which is what makes
 * policy changes and org-wide revocation take effect within the cache TTL
 * instead of the 24h cookie-cache lifetime.
 *
 * Callers that already write the `organization` row in the same request
 * should fold `securityPolicyVersion: sql`...` + 1` into that UPDATE and call
 * {@link invalidateSecurityPolicyVersionCache} instead.
 */
export async function bumpSecurityPolicyVersion(organizationId: string): Promise<void> {
  await db
    .update(organization)
    .set({ securityPolicyVersion: sql`${organization.securityPolicyVersion} + 1` })
    .where(eq(organization.id, organizationId))
  invalidateSecurityPolicyVersionCache(organizationId)
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
  return String(await getSecurityPolicyVersion(session.activeOrganizationId))
}
