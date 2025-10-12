import { db } from '@sim/db'
import { workflowCheckpoints, workflow as workflowTable } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { validateUUID } from '@/lib/security/input-validation'

const logger = createLogger('CheckpointRevertAPI')

const RevertCheckpointSchema = z.object({
  checkpointId: z.string().min(1),
})

/**
 * POST /api/copilot/checkpoints/revert
 * Revert workflow to a specific checkpoint state
 */
export async function POST(request: NextRequest) {
  const tracker = createRequestTracker()

  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await request.json()
    const { checkpointId } = RevertCheckpointSchema.parse(body)

    logger.info(`[${tracker.requestId}] Reverting to checkpoint ${checkpointId}`)

    const checkpoint = await db
      .select()
      .from(workflowCheckpoints)
      .where(and(eq(workflowCheckpoints.id, checkpointId), eq(workflowCheckpoints.userId, userId)))
      .then((rows) => rows[0])

    if (!checkpoint) {
      return createNotFoundResponse('Checkpoint not found or access denied')
    }

    const workflowData = await db
      .select()
      .from(workflowTable)
      .where(eq(workflowTable.id, checkpoint.workflowId))
      .then((rows) => rows[0])

    if (!workflowData) {
      return createNotFoundResponse('Workflow not found')
    }

    if (workflowData.userId !== userId) {
      return createUnauthorizedResponse()
    }

    const checkpointState = checkpoint.workflowState as any // Cast to any for property access

    const cleanedState = {
      blocks: checkpointState?.blocks || {},
      edges: checkpointState?.edges || [],
      loops: checkpointState?.loops || {},
      parallels: checkpointState?.parallels || {},
      isDeployed: checkpointState?.isDeployed || false,
      deploymentStatuses: checkpointState?.deploymentStatuses || {},
      lastSaved: Date.now(),
      ...(checkpointState?.deployedAt &&
      checkpointState.deployedAt !== null &&
      checkpointState.deployedAt !== undefined &&
      !Number.isNaN(new Date(checkpointState.deployedAt).getTime())
        ? { deployedAt: new Date(checkpointState.deployedAt) }
        : {}),
    }

    logger.info(`[${tracker.requestId}] Applying cleaned checkpoint state`, {
      blocksCount: Object.keys(cleanedState.blocks).length,
      edgesCount: cleanedState.edges.length,
      hasDeployedAt: !!cleanedState.deployedAt,
      isDeployed: cleanedState.isDeployed,
    })

    const workflowIdValidation = validateUUID(checkpoint.workflowId, 'workflowId')
    if (!workflowIdValidation.isValid) {
      logger.error(`[${tracker.requestId}] Invalid workflow ID: ${workflowIdValidation.error}`)
      return NextResponse.json({ error: 'Invalid workflow ID format' }, { status: 400 })
    }

    const stateResponse = await fetch(
      `${request.nextUrl.origin}/api/workflows/${checkpoint.workflowId}/state`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: request.headers.get('Cookie') || '',
        },
        body: JSON.stringify(cleanedState),
      }
    )

    if (!stateResponse.ok) {
      const errorData = await stateResponse.text()
      logger.error(`[${tracker.requestId}] Failed to apply checkpoint state: ${errorData}`)
      return NextResponse.json(
        { error: 'Failed to revert workflow to checkpoint' },
        { status: 500 }
      )
    }

    const result = await stateResponse.json()
    logger.info(
      `[${tracker.requestId}] Successfully reverted workflow ${checkpoint.workflowId} to checkpoint ${checkpointId}`
    )

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
}
