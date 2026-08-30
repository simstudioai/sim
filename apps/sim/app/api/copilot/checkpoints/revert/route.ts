import { db } from '@sim/db'
import { workflowCheckpoints } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { revertCopilotCheckpointContract } from '@/lib/api/contracts/copilot'
import type { CleanedWorkflowState } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAccessibleCopilotChatAuth } from '@/lib/mothership/chat/lifecycle'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/mothership/request/http'
import {
  parseWorkflowStateForPersistence,
  saveWorkflowNormalizedState,
} from '@/lib/workflows/persistence/save-normalized-state'
import { isUuidV4 } from '@/executor/constants'

const logger = createLogger('CheckpointRevertAPI')

/**
 * POST /api/copilot/checkpoints/revert
 * Revert workflow to a specific checkpoint state
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const tracker = createRequestTracker()

  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const parsed = await parseRequest(
      revertCopilotCheckpointContract,
      request,
      {},
      {
        invalidJson: 'throw',
      }
    )
    if (!parsed.success) return parsed.response
    const { checkpointId } = parsed.data.body

    logger.info(`[${tracker.requestId}] Reverting to checkpoint ${checkpointId}`)

    const checkpoint = await db
      .select()
      .from(workflowCheckpoints)
      .where(and(eq(workflowCheckpoints.id, checkpointId), eq(workflowCheckpoints.userId, userId)))
      .then((rows) => rows[0])

    if (!checkpoint) {
      return createNotFoundResponse('Checkpoint not found or access denied')
    }

    const chat = await getAccessibleCopilotChatAuth(checkpoint.chatId, userId)
    if (!chat) {
      return createNotFoundResponse('Checkpoint not found or access denied')
    }

    /** Authorization already loads the workflow, so its absence is the not-found signal. */
    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId: checkpoint.workflowId,
      userId,
      action: 'write',
    })
    if (!authorization.workflow) {
      return createNotFoundResponse('Workflow not found')
    }
    if (!authorization.allowed) {
      return createUnauthorizedResponse()
    }

    const checkpointState: Record<string, unknown> =
      checkpoint.workflowState && typeof checkpoint.workflowState === 'object'
        ? (checkpoint.workflowState as Record<string, unknown>)
        : {}

    const rawBlocks = checkpointState.blocks
    const rawEdges = checkpointState.edges
    const rawLoops = checkpointState.loops
    const rawParallels = checkpointState.parallels
    const rawDeployedAt = checkpointState.deployedAt

    const parsedDeployedAt =
      rawDeployedAt === null || rawDeployedAt === undefined
        ? null
        : new Date(rawDeployedAt as string | number | Date)

    const cleanedState: CleanedWorkflowState = {
      blocks: (rawBlocks ?? {}) as Record<string, unknown>,
      edges: (rawEdges ?? []) as unknown[],
      loops: (rawLoops ?? {}) as Record<string, unknown>,
      parallels: (rawParallels ?? {}) as Record<string, unknown>,
      isDeployed: Boolean(checkpointState.isDeployed),
      lastSaved: Date.now(),
      ...(parsedDeployedAt && !Number.isNaN(parsedDeployedAt.getTime())
        ? { deployedAt: parsedDeployedAt }
        : {}),
    }

    logger.info(`[${tracker.requestId}] Applying cleaned checkpoint state`, {
      blocksCount: Object.keys(cleanedState.blocks).length,
      edgesCount: cleanedState.edges.length,
      hasDeployedAt: !!cleanedState.deployedAt,
      isDeployed: cleanedState.isDeployed,
    })

    if (!isUuidV4(checkpoint.workflowId)) {
      logger.error(`[${tracker.requestId}] Invalid workflow ID format`)
      return NextResponse.json({ error: 'Invalid workflow ID format' }, { status: 400 })
    }

    /**
     * The checkpoint blob is persisted JSONB, so it goes through the same
     * schema the PUT state contract applies before it is written back — the
     * validation the removed HTTP hop used to provide.
     */
    const parsedState = parseWorkflowStateForPersistence(cleanedState)
    if (!parsedState.success) {
      logger.error(
        `[${tracker.requestId}] Checkpoint state failed validation`,
        parsedState.error.issues
      )
      return NextResponse.json(
        { error: 'Failed to revert workflow to checkpoint' },
        { status: 500 }
      )
    }

    const saveResult = await saveWorkflowNormalizedState({
      requestId: tracker.requestId,
      workflowId: checkpoint.workflowId,
      userId,
      state: parsedState.data,
      /** Already resolved above; re-deriving it would repeat 2-3 sequential reads. */
      authorization,
    })

    if (!saveResult.success) {
      logger.error(`[${tracker.requestId}] Failed to apply checkpoint state: ${saveResult.error}`)
      return NextResponse.json(
        { error: 'Failed to revert workflow to checkpoint' },
        { status: 500 }
      )
    }

    logger.info(
      `[${tracker.requestId}] Successfully reverted workflow ${checkpoint.workflowId} to checkpoint ${checkpointId}`
    )

    // Delete the checkpoint after successfully reverting to it
    try {
      await db.delete(workflowCheckpoints).where(eq(workflowCheckpoints.id, checkpointId))
      logger.info(`[${tracker.requestId}] Deleted checkpoint after reverting`, { checkpointId })
    } catch (deleteError) {
      logger.warn(`[${tracker.requestId}] Failed to delete checkpoint after revert`, {
        checkpointId,
        error: deleteError,
      })
      // Don't fail the request if deletion fails - the revert was successful
    }

    return NextResponse.json({
      success: true,
      workflowId: checkpoint.workflowId,
      checkpointId,
      revertedAt: new Date().toISOString(),
      checkpoint: {
        id: checkpoint.id,
        workflowState: cleanedState,
      },
    })
  } catch (error) {
    logger.error(`[${tracker.requestId}] Error reverting to checkpoint:`, error)
    return createInternalServerErrorResponse('Failed to revert to checkpoint')
  }
})
