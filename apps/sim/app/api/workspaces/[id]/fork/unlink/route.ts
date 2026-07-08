import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type NextRequest, NextResponse } from 'next/server'
import { unlinkForkContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { assertCanUnlink } from '@/ee/workspace-forking/lib/lineage/authz'
import { unlinkForkEdge } from '@/ee/workspace-forking/lib/lineage/unlink'

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(unlinkForkContract, req, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params
    const { otherWorkspaceId } = parsed.data.body

    const { edge, current } = await assertCanUnlink(id, otherWorkspaceId, session.user.id)
    const result = await unlinkForkEdge(edge, requestId)

    if (result.unlinked) {
      recordAudit({
        workspaceId: id,
        actorId: session.user.id,
        action: AuditAction.WORKSPACE_FORK_UNLINKED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: id,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        resourceName: current.name,
        description: `Disconnected the fork relationship with workspace "${otherWorkspaceId}"`,
        metadata: {
          otherWorkspaceId,
          childWorkspaceId: edge.childWorkspaceId,
          parentWorkspaceId: edge.parentWorkspaceId,
        },
        request: req,
      })
    }

    return NextResponse.json(result)
  }
)
