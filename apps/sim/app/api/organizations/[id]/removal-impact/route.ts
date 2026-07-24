import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getMemberRemovalImpactContract } from '@/lib/api/contracts/organization'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { getOrganizationTransferCredentialDependencies } from '@/lib/billing/organizations/membership'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrganizationRemovalImpactAPI')

/**
 * Identity-bound credentials the target user owns in this organization's
 * workspaces — the set that stops working when their workspace access is
 * revoked. Readable by org admins (removing someone) and by the user
 * themself (leaving).
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getMemberRemovalImpactContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params
    const { userId: targetUserId } = parsed.data.query

    try {
      const isSelf = targetUserId === session.user.id
      if (!isSelf && !(await isOrganizationOwnerOrAdmin(session.user.id, organizationId))) {
        return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 })
      }

      const credentials = await getOrganizationTransferCredentialDependencies(
        targetUserId,
        organizationId
      )

      return NextResponse.json({ credentials })
    } catch (error) {
      logger.error('Failed to compute member removal impact', {
        organizationId,
        targetUserId,
        error,
      })
      return NextResponse.json({ error: 'Failed to compute removal impact' }, { status: 500 })
    }
  }
)
