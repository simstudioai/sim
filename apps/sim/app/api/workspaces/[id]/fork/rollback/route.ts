import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type NextRequest, NextResponse } from 'next/server'
import { rollbackForkContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { assertCanRollback } from '@/lib/workspaces/fork/lineage/authz'
import { rollbackFork } from '@/lib/workspaces/fork/promote/rollback'

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(rollbackForkContract, req, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params
    const { otherWorkspaceId } = parsed.data.body

    const target = await assertCanRollback(id, session.user.id)

    const result = await rollbackFork({
      targetWorkspaceId: id,
      otherWorkspaceId,
      userId: session.user.id,
      requestId,
    })

    recordAudit({
      workspaceId: id,
      actorId: session.user.id,
      action: AuditAction.WORKSPACE_FORK_ROLLED_BACK,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: id,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: target.name,
      description: `Rolled back the last promote into "${target.name}"`,
      metadata: { otherWorkspaceId, ...result },
      request: req,
    })

    return NextResponse.json(result)
  }
)
