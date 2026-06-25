import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { forkWorkspaceContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createFork } from '@/lib/workspaces/fork/create-fork'
import { assertCanFork } from '@/lib/workspaces/fork/lineage/authz'

const logger = createLogger('WorkspaceForkAPI')

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: sourceWorkspaceId } = await context.params
    const requestId = generateRequestId()

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { source, policy } = await assertCanFork(sourceWorkspaceId, session.user.id)

    const parsed = await parseRequest(forkWorkspaceContract, req, context)
    if (!parsed.success) return parsed.response

    const copy = parsed.data.body.copy
    const result = await createFork({
      source,
      policy,
      userId: session.user.id,
      name: parsed.data.body.name,
      selection: {
        files: copy?.files ?? [],
        tables: copy?.tables ?? [],
        knowledgeBases: copy?.knowledgeBases ?? [],
        customTools: copy?.customTools ?? [],
        skills: copy?.skills ?? [],
        mcpServers: copy?.mcpServers ?? [],
      },
      requestId,
    })

    recordAudit({
      workspaceId: result.workspace.id,
      actorId: session.user.id,
      action: AuditAction.WORKSPACE_FORKED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: result.workspace.id,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: result.workspace.name,
      description: `Forked workspace from "${source.name}"`,
      metadata: {
        parentWorkspaceId: source.id,
        workflowsCopied: result.workflowsCopied,
      },
      request: req,
    })

    logger.info(`[${requestId}] Forked workspace ${sourceWorkspaceId} -> ${result.workspace.id}`)
    return NextResponse.json(result, { status: 201 })
  }
)
