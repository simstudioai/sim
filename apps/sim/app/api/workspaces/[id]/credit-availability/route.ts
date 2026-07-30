import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getWorkspaceCreditAvailabilityContract } from '@/lib/api/contracts/workspaces'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getWorkspaceCreditAvailability } from '@/lib/billing/core/workspace-usage-gate'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getWorkspaceCreditAvailabilityContract, request, context)
    if (!parsed.success) return parsed.response

    const workspaceId = parsed.data.params.id
    const hostContext = await getWorkspaceHostContextForViewer(workspaceId, session.user.id)
    if (!hostContext) {
      return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 })
    }

    const availability = await getWorkspaceCreditAvailability({
      actorUserId: session.user.id,
      workspaceId,
      canViewPayerPool: canManageWorkspaceBilling(hostContext, session.user.id),
    })

    return NextResponse.json(availability)
  }
)
