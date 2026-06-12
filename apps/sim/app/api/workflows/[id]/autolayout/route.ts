import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  assertWorkflowMutable,
  authorizeWorkflowByWorkspacePermission,
  WorkflowLockedError,
} from '@sim/workflow-authz'
import { type NextRequest, NextResponse } from 'next/server'
import { workflowAutoLayoutContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { applyAutoLayout } from '@/lib/workflows/autolayout'
import {
  DEFAULT_HORIZONTAL_SPACING,
  DEFAULT_LAYOUT_PADDING,
  DEFAULT_VERTICAL_SPACING,
} from '@/lib/workflows/autolayout/constants'
import {
  loadWorkflowFromNormalizedTables,
  type NormalizedWorkflowData,
} from '@/lib/workflows/persistence/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('AutoLayoutAPI')

/**
 * POST /api/workflows/[id]/autolayout
 * Apply autolayout to an existing workflow
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const startTime = Date.now()
    const { id: workflowId } = await context.params

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized autolayout attempt for workflow ${workflowId}`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userId = auth.userId

      const parsed = await parseRequest(workflowAutoLayoutContract, request, context)
      if (!parsed.success) return parsed.response
      const layoutOptions = parsed.data.body

      logger.info(`[${requestId}] Processing autolayout request for workflow ${workflowId}`, {
        userId,
      })

      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId,
        action: 'write',
      })
      const workflowData = authorization.workflow

      if (!workflowData) {
        logger.warn(`[${requestId}] Workflow ${workflowId} not found for autolayout`)
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      const canUpdate = authorization.allowed

      if (!canUpdate) {
        logger.warn(
          `[${requestId}] User ${userId} denied permission to autolayout workflow ${workflowId}`
        )
        return NextResponse.json(
          { error: authorization.message || 'Access denied' },
          { status: authorization.status || 403 }
        )
      }

      await assertWorkflowMutable(workflowId)

      let currentWorkflowData: NormalizedWorkflowData | null

      if (layoutOptions.blocks && layoutOptions.edges) {
        logger.info(`[${requestId}] Using provided blocks with live measurements`)
        currentWorkflowData = {
          blocks: layoutOptions.blocks,
          edges: layoutOptions.edges,
          loops: layoutOptions.loops || {},
          parallels: layoutOptions.parallels || {},
          isFromNormalizedTables: false,
        }
      } else {
        logger.info(`[${requestId}] Loading blocks from database`)
        currentWorkflowData = await loadWorkflowFromNormalizedTables(workflowId)
      }

      if (!currentWorkflowData) {
        logger.error(`[${requestId}] Could not load workflow ${workflowId} for autolayout`)
        return NextResponse.json({ error: 'Could not load workflow data' }, { status: 500 })
      }

      const autoLayoutOptions = {
        horizontalSpacing: layoutOptions.spacing?.horizontal ?? DEFAULT_HORIZONTAL_SPACING,
        verticalSpacing: layoutOptions.spacing?.vertical ?? DEFAULT_VERTICAL_SPACING,
        padding: {
          x: layoutOptions.padding?.x ?? DEFAULT_LAYOUT_PADDING.x,
          y: layoutOptions.padding?.y ?? DEFAULT_LAYOUT_PADDING.y,
        },
        alignment: layoutOptions.alignment,
        gridSize: layoutOptions.gridSize,
      }

      const layoutResult = applyAutoLayout(
        currentWorkflowData.blocks,
        currentWorkflowData.edges,
        autoLayoutOptions
      )

      if (!layoutResult.success || !layoutResult.blocks) {
        logger.error(`[${requestId}] Auto layout failed:`, {
          error: layoutResult.error,
        })
        return NextResponse.json(
          {
            error: 'Auto layout failed',
            details: layoutResult.error || 'Unknown error',
          },
          { status: 500 }
        )
      }

      const elapsed = Date.now() - startTime
      const blockCount = Object.keys(layoutResult.blocks).length

      logger.info(`[${requestId}] Autolayout completed successfully in ${elapsed}ms`, {
        blockCount,
        workflowId,
      })

      return NextResponse.json({
        success: true,
        message: `Autolayout applied successfully to ${blockCount} blocks`,
        data: {
          blockCount,
          elapsed: `${elapsed}ms`,
          layoutedBlocks: layoutResult.blocks,
        },
      })
    } catch (error) {
      if (error instanceof WorkflowLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      const elapsed = Date.now() - startTime

      logger.error(`[${requestId}] Autolayout failed after ${elapsed}ms:`, error)
      return NextResponse.json(
        {
          error: 'Autolayout failed',
          details: getErrorMessage(error, 'Unknown error'),
        },
        { status: 500 }
      )
    }
  }
)
