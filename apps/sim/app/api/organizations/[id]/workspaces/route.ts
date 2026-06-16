import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { listOrganizationWorkspacesContract } from '@/lib/api/contracts/permission-groups'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authorizeOrgAccessControl,
  listOrganizationWorkspaces,
} from '@/app/api/organizations/[id]/permission-groups/utils'

const logger = createLogger('OrganizationWorkspaces')

/**
 * GET /api/organizations/[id]/workspaces
 *
 * Lists the workspaces belonging to an organization, used to populate the
 * workspace multi-select when scoping a permission group. Gated to organization
 * owners/admins on an Enterprise-entitled organization (same gate as the
 * permission-group management routes).
 */
export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(listOrganizationWorkspacesContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: organizationId } = parsed.data.params

    const denied = await authorizeOrgAccessControl(session.user.id, organizationId)
    if (denied) return denied

    const workspaces = await listOrganizationWorkspaces(organizationId)

    logger.info('Listed organization workspaces', {
      organizationId,
      count: workspaces.length,
    })

    return NextResponse.json({ workspaces })
  }
)
