import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getWorkspaceApiExecutionEntitlementContract } from '@/lib/api/contracts/workspaces'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isWorkspaceApiExecutionEntitled } from '@/lib/billing/core/api-access'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceApiExecutionEntitlementAPI')

/**
 * Whether this workspace may run workflows programmatically — the UI mirror of
 * the server gate (`isWorkspaceApiExecutionEntitled`). Lets the deploy modal
 * reflect the workspace's billed-account plan instead of the viewer's individual
 * plan, so a free member of a paid workspace isn't shown the upgrade wall.
 */
export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getWorkspaceApiExecutionEntitlementContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (!permission) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const entitled = await isWorkspaceApiExecutionEntitled(workspaceId)
    logger.info('Resolved workspace API-execution entitlement', { workspaceId, entitled })
    return NextResponse.json({ entitled })
  }
)
