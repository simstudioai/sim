import { db, ssoDomain, ssoProvider } from '@sim/db'
import { forgetPrimaryProviders, verifiedDomainOfProvider } from '@sim/db/sso-primary-provider'
import { createLogger } from '@sim/logger'
import { and, eq, exists, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { deleteSsoProviderContract, setPrimarySsoProviderContract } from '@/lib/api/contracts/auth'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isOrganizationAdminOrOwner } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('SSOProviderRoute')

type RouteContext = { params: Promise<{ providerId: string }> }

/**
 * Loads a provider the caller may manage: an organization provider for its
 * owners and admins, a personal provider for its creator. Sim owns these
 * mutations rather than exposing the SSO plugin's own, which
 * `/api/auth/[...all]` blocks by design: the plugin gates only on the row's
 * creator, while an organization's providers belong to the organization.
 */
async function loadManagedProvider(userId: string, providerId: string) {
  const [provider] = await db
    .select({
      id: ssoProvider.id,
      organizationId: ssoProvider.organizationId,
      userId: ssoProvider.userId,
      domain: ssoProvider.domain,
    })
    .from(ssoProvider)
    .where(eq(ssoProvider.providerId, providerId))
    .limit(1)
  if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 })

  const allowed = provider.organizationId
    ? await isOrganizationAdminOrOwner(userId, provider.organizationId)
    : provider.userId === userId
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return provider
}

/**
 * Makes this provider the one its domain signs in through. The previous primary
 * stays configured and reachable by test link, so the switch can be reversed
 * the same way.
 */
export const PATCH = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const parsed = await parseRequest(setPrimarySsoProviderContract, request, context)
  if (!parsed.success) return parsed.response
  const { providerId } = parsed.data.params

  const provider = await loadManagedProvider(session.user.id, providerId)
  if (provider instanceof NextResponse) return provider
  if (!provider.organizationId) {
    return NextResponse.json(
      { error: 'Only organization identity providers have a primary provider' },
      { status: 400 }
    )
  }

  /**
   * Names the provider on the one domain record sign-in joins it to, so a
   * provider this succeeds for is exactly the one sign-in then uses.
   */
  const named = await db
    .update(ssoDomain)
    .set({ primaryProviderId: providerId, updatedAt: new Date() })
    .where(
      and(
        eq(ssoDomain.organizationId, provider.organizationId),
        exists(
          db
            .select({ found: sql`1` })
            .from(ssoProvider)
            .where(
              and(
                eq(ssoProvider.id, provider.id),
                eq(ssoProvider.domainVerified, true),
                verifiedDomainOfProvider
              )
            )
        )
      )
    )
    .returning({ id: ssoDomain.id })
  if (named.length === 0) {
    return NextResponse.json(
      { error: `Verify ${provider.domain} before making this provider primary.` },
      { status: 409 }
    )
  }

  logger.info('Set primary SSO provider', {
    providerId,
    organizationId: provider.organizationId,
    domain: provider.domain,
    userId: session.user.id,
  })
  return NextResponse.json({ success: true, providerId })
})

/**
 * Removes one identity provider. Accounts and memberships it admitted are
 * untouched; only the sign-in path goes. A domain that named it as primary
 * forgets the name, so sign-in moves to the domain's next verified provider
 * and a later provider reusing the id does not inherit the role.
 */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const parsed = await parseRequest(deleteSsoProviderContract, request, context)
  if (!parsed.success) return parsed.response
  const { providerId } = parsed.data.params

  const provider = await loadManagedProvider(session.user.id, providerId)
  if (provider instanceof NextResponse) return provider
  const { organizationId } = provider

  /**
   * Deleted by primary key under the same ownership the check established,
   * so a concurrent re-registration of the providerId cannot be the row
   * removed.
   */
  const ownerClause = organizationId
    ? eq(ssoProvider.organizationId, organizationId)
    : and(eq(ssoProvider.userId, session.user.id), isNull(ssoProvider.organizationId))
  const removed = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(ssoProvider)
      .where(and(eq(ssoProvider.id, provider.id), ownerClause))
      .returning({ id: ssoProvider.id })
    if (deleted.length > 0 && organizationId) {
      await forgetPrimaryProviders(tx, organizationId, [providerId])
    }
    return deleted
  })
  if (removed.length === 0) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
  }

  logger.info('Deleted SSO provider', {
    providerId,
    organizationId,
    domain: provider.domain,
    userId: session.user.id,
  })
  return NextResponse.json({ success: true, providerId })
})
