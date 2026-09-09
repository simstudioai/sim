import { db, member, ssoProvider } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { deleteSsoProviderContract } from '@/lib/api/contracts/auth'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SSOProviderRoute')

/**
 * Removes one identity provider.
 *
 * Sim owns this rather than exposing the SSO plugin's `delete-provider`, which
 * `/api/auth/[...all]` blocks by design: the plugin gates only on the row's
 * creator, while an organization's providers belong to the organization and
 * are removed by its owners and admins. Accounts and memberships the provider
 * admitted are untouched; only the sign-in path goes.
 */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ providerId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(deleteSsoProviderContract, request, context)
    if (!parsed.success) return parsed.response
    const { providerId } = parsed.data.params

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

    if (provider.organizationId) {
      const [membership] = await db
        .select({ role: member.role })
        .from(member)
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(member.organizationId, provider.organizationId)
          )
        )
        .limit(1)
      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else if (provider.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    /**
     * Deleted by primary key under the same ownership the check established,
     * so a concurrent re-registration of the providerId cannot be the row
     * removed.
     */
    const ownerClause = provider.organizationId
      ? eq(ssoProvider.organizationId, provider.organizationId)
      : and(eq(ssoProvider.userId, session.user.id), isNull(ssoProvider.organizationId))
    const removed = await db
      .delete(ssoProvider)
      .where(and(eq(ssoProvider.id, provider.id), ownerClause))
      .returning({ id: ssoProvider.id })
    if (removed.length === 0) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }

    logger.info('Deleted SSO provider', {
      providerId,
      organizationId: provider.organizationId,
      domain: provider.domain,
      userId: session.user.id,
    })
    return NextResponse.json({ success: true, providerId })
  }
)
