import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { promoteForkContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { recordBackgroundWork } from '@/lib/workspaces/fork/background-work/store'
import { assertCanPromote } from '@/lib/workspaces/fork/lineage/authz'
import { promoteFork } from '@/lib/workspaces/fork/promote/promote'

const logger = createLogger('WorkspaceForkPromoteAPI')

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(promoteForkContract, req, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params
    const { otherWorkspaceId, direction, force } = parsed.data.body

    const auth = await assertCanPromote(id, otherWorkspaceId, direction, session.user.id)

    const result = await promoteFork({
      edge: auth.edge,
      sourceWorkspaceId: auth.sourceWorkspaceId,
      targetWorkspaceId: auth.targetWorkspaceId,
      direction,
      force,
      userId: session.user.id,
      requestId,
    })

    const body = {
      promoteRunId: result.promoteRunId,
      updated: result.updated,
      created: result.created,
      archived: result.archived,
      redeployed: result.redeployed,
      deployFailed: result.deployFailed,
      unmappedRequired: result.unmappedRequired,
      drift: result.drift,
    }

    if (result.blocked) {
      logger.info(`[${requestId}] Promote blocked (${result.blocked})`, {
        sourceWorkspaceId: auth.sourceWorkspaceId,
        targetWorkspaceId: auth.targetWorkspaceId,
      })
      return NextResponse.json(body)
    }

    recordAudit({
      workspaceId: auth.targetWorkspaceId,
      actorId: session.user.id,
      action: AuditAction.WORKSPACE_FORK_PROMOTED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: auth.targetWorkspaceId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: auth.target.name,
      description: `Promoted workflows from "${auth.source.name}" to "${auth.target.name}"`,
      metadata: {
        direction,
        sourceWorkspaceId: auth.sourceWorkspaceId,
        updated: result.updated,
        created: result.created,
        archived: result.archived,
        redeployed: result.redeployed,
      },
      request: req,
    })

    const otherName =
      otherWorkspaceId === auth.sourceWorkspaceId ? auth.source.name : auth.target.name
    await recordBackgroundWork(db, {
      workspaceId: id,
      kind: 'fork_sync',
      status: result.deployFailed > 0 ? 'completed_with_warnings' : 'completed',
      message: direction === 'pull' ? `Pulled from "${otherName}"` : `Pushed to "${otherName}"`,
      metadata: {
        actorName: session.user.name ?? undefined,
        otherWorkspaceName: otherName,
        direction,
        updated: result.updated,
        created: result.created,
        archived: result.archived,
        redeployed: result.redeployed,
        deployFailed: result.deployFailed,
        updatedNames: result.updatedNames,
        createdNames: result.createdNames,
        archivedNames: result.archivedNames,
      },
    }).catch((error) =>
      logger.error(`[${requestId}] Failed to record sync activity`, {
        error: getErrorMessage(error),
      })
    )

    return NextResponse.json(body)
  }
)
