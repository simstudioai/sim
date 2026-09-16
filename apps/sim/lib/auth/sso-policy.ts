import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { APIError } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { isSsoCallbackPath } from '@/lib/auth/sso/callback-provider'
import { hasSignInCapableSsoProvider } from '@/lib/auth/sso/verified-provider'
import { isOrganizationFeatureEntitled } from '@/lib/billing/core/subscription'
import { isSsoEnabled } from '@/lib/core/config/env-flags'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('SsoPolicy')

/** How long an organization's sign-in requirement is served from process memory. */
export const SSO_POLICY_CACHE_TTL_MS = 60 * 1000

/**
 * Serves the settings surface, which reads on the shared connection. Session creation runs inside
 * the auth transaction and deliberately bypasses this (see below), so it pays one indexed
 * single-row read instead. The ceiling is a memory backstop rather than an operating limit:
 * exceeding it only costs that lookup again.
 */
const requirementCache = new LRUCache<string, boolean>({
  max: 20_000,
  ttl: SSO_POLICY_CACHE_TTL_MS,
})

/**
 * Whether an organization requires its members to sign in through its identity provider.
 *
 * The stored setting only enforces while the organization could satisfy it: it stops when the
 * organization loses its SSO entitlement, and when no identity provider on a verified domain is
 * left to sign anyone in. Both are the same rule — never hold people to a requirement the
 * organization can no longer meet — and they make a deleted provider self-healing rather than a
 * lockout an owner has to notice and undo.
 */
export async function isSsoRequiredForOrganization(
  organizationId: string | null | undefined,
  executor: DbOrTx = db
): Promise<boolean> {
  if (!organizationId) return false

  /** Uncommitted reads must neither consume nor populate the shared cache. */
  const cached = executor === db ? requirementCache.get(organizationId) : undefined
  if (cached !== undefined) return cached

  const [row] = await executor
    .select({ requireSso: organization.requireSso })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)

  const required =
    row?.requireSso === true &&
    (await isOrganizationFeatureEntitled(organizationId, isSsoEnabled, executor)) &&
    (await hasSignInCapableSsoProvider(organizationId, executor))
  if (executor === db) requirementCache.set(organizationId, required)
  return required
}

export function invalidateSsoPolicyCache(organizationId: string): void {
  requirementCache.delete(organizationId)
}

/**
 * Sessions that carry an earlier sign-in's authority rather than proving identity themselves: the
 * desktop handoff, platform-admin impersonation, which support needs while an identity provider is
 * broken, and a password change, which re-issues the session of whoever is already signed in.
 */
const DERIVED_SESSION_PATHS = new Set([
  '/one-time-token/verify',
  '/admin/impersonate-user',
  '/change-password',
])

/**
 * Whether the endpoint that is creating a session satisfies an SSO requirement. Unknown paths do
 * not: a credential endpoint added later should be refused until it is considered, rather than
 * quietly becoming a way around the requirement.
 *
 * A session created outside any endpoint has no path at all, because Better Auth passes the hook
 * the request context and there is none. The only such caller is the desktop handoff, which mints
 * its session for a browser that is already signed in.
 */
export function satisfiesSsoRequirement(path: string | undefined): boolean {
  if (!path) return true
  return DERIVED_SESSION_PATHS.has(path) || isSsoCallbackPath(path)
}

export const SSO_REQUIRED_ERROR_CODE = 'SSO_REQUIRED'

export const SSO_REQUIRED_MESSAGE =
  'Your organization requires single sign-on. Sign in through your identity provider.'

/**
 * Refuses a session that an organization's sign-in requirement does not allow. Owners keep every
 * sign-in method as a break-glass path, so a broken identity provider cannot lock an organization
 * out of its own settings.
 */
export async function assertSsoRequirementSatisfied(
  membership: { userId: string; organizationId: string; role: string },
  path: string | undefined,
  executor: DbOrTx = db
): Promise<void> {
  if (membership.role === 'owner' || satisfiesSsoRequirement(path)) return
  if (!(await isSsoRequiredForOrganization(membership.organizationId, executor))) return

  logger.warn('Blocking session creation for an organization that requires SSO', {
    userId: membership.userId,
    organizationId: membership.organizationId,
    path,
  })
  throw new APIError('FORBIDDEN', {
    code: SSO_REQUIRED_ERROR_CODE,
    message: SSO_REQUIRED_MESSAGE,
  })
}
