import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { duplicateWorkspaceContract } from '@/lib/api/contracts/workspaces'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { duplicateWorkspace } from '@/lib/workspaces/duplicate'

const logger = createLogger('WorkspaceDuplicateAPI')

// POST /api/workspaces/[id]/duplicate - Duplicate a workspace with all its workflows
export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: sourceWorkspaceId } = await context.params
    const requestId = generateRequestId()
    const startTime = Date.now()

    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(
        `[${requestId}] Unauthorized workspace duplication attempt for ${sourceWorkspaceId}`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const parsed = await parseRequest(duplicateWorkspaceContract, req, context)
      if (!parsed.success) return parsed.response
      const { name } = parsed.data.body

      logger.info(
        `[${requestId}] Duplicating workspace ${sourceWorkspaceId} for user ${session.user.id}`
      )

      const result = await duplicateWorkspace({
        sourceWorkspaceId,
        userId: session.user.id,
        name,
        requestId,
      })

      const elapsed = Date.now() - startTime
      logger.info(
        `[${requestId}] Successfully duplicated workspace ${sourceWorkspaceId} to ${result.id} in ${elapsed}ms`
      )

      recordAudit({
        workspaceId: sourceWorkspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.WORKSPACE_DUPLICATED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: result.id,
        resourceName: name,
        description: `Duplicated workspace to "${name}"`,
        metadata: {
          sourceWorkspaceId,
          affected: { workflows: result.workflowsCount, folders: result.foldersCount },
        },
        request: req,
      })

      return NextResponse.json(result, { status: 201 })
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Source workspace not found') {
          logger.warn(`[${requestId}] Source workspace ${sourceWorkspaceId} not found`)
          return NextResponse.json({ error: 'Source workspace not found' }, { status: 404 })
        }

        if (error.message === 'Source workspace not found or access denied') {
          logger.warn(
            `[${requestId}] User ${session.user.id} denied access to source workspace ${sourceWorkspaceId}`
          )
          return NextResponse.json({ error: 'Access denied' }, { status: 403 })
        }
      }

      const elapsed = Date.now() - startTime
      logger.error(
        `[${requestId}] Error duplicating workspace ${sourceWorkspaceId} after ${elapsed}ms:`,
        error
      )
      return NextResponse.json({ error: 'Failed to duplicate workspace' }, { status: 500 })
    }
  }
)
