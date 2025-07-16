import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import { db } from '@/db'
import { workflow } from '@/db/schema'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

const logger = createLogger('RevertToDeployedAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/workflows/[id]/revert-to-deployed
 * Revert workflow to its deployed state by saving deployed state to normalized tables
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Reverting workflow to deployed state: ${id}`)
    const validation = await validateWorkflowAccess(request, id, false)

    if (validation.error) {
      logger.warn(`[${requestId}] Workflow revert failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const workflowData = validation.workflow

    // Check if workflow is deployed and has deployed state
    if (!workflowData.isDeployed || !workflowData.deployedState) {
      logger.warn(`[${requestId}] Cannot revert: workflow is not deployed or has no deployed state`)
      return createErrorResponse('Workflow is not deployed or has no deployed state', 400)
    }

    // Validate deployed state structure
    const deployedState = workflowData.deployedState as WorkflowState
    if (!deployedState.blocks || !deployedState.edges) {
      logger.error(`[${requestId}] Invalid deployed state structure`, { deployedState })
      return createErrorResponse('Invalid deployed state structure', 500)
    }

    logger.debug(`[${requestId}] Saving deployed state to normalized tables`, {
      blocksCount: Object.keys(deployedState.blocks).length,
      edgesCount: deployedState.edges.length,
      loopsCount: Object.keys(deployedState.loops || {}).length,
      parallelsCount: Object.keys(deployedState.parallels || {}).length,
    })

    // Save deployed state to normalized tables
    const saveResult = await saveWorkflowToNormalizedTables(id, {
      blocks: deployedState.blocks,
      edges: deployedState.edges,
      loops: deployedState.loops || {},
      parallels: deployedState.parallels || {},
      lastSaved: Date.now(),
      isDeployed: workflowData.isDeployed,
      deployedAt: workflowData.deployedAt,
      deploymentStatuses: deployedState.deploymentStatuses || {},
      hasActiveSchedule: deployedState.hasActiveSchedule || false,
      hasActiveWebhook: deployedState.hasActiveWebhook || false,
    })

    if (!saveResult.success) {
      logger.error(`[${requestId}] Failed to save deployed state to normalized tables`, {
        error: saveResult.error,
      })
      return createErrorResponse(
        saveResult.error || 'Failed to save deployed state to normalized tables',
        500
      )
    }

    // Update workflow's last_synced timestamp to indicate changes
    await db
      .update(workflow)
      .set({
        lastSynced: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflow.id, id))

    // Notify socket server about the revert operation for real-time sync
    try {
      const socketServerUrl = env.SOCKET_SERVER_URL || 'http://localhost:3002'
      await fetch(`${socketServerUrl}/api/workflow-reverted`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId: id,
          timestamp: Date.now(),
        }),
      })
      logger.debug(`[${requestId}] Notified socket server about workflow revert: ${id}`)
    } catch (socketError) {
      // Don't fail the request if socket notification fails
      logger.warn(`[${requestId}] Failed to notify socket server about revert:`, socketError)
    }

    logger.info(`[${requestId}] Successfully reverted workflow to deployed state: ${id}`)

    return createSuccessResponse({
      message: 'Workflow successfully reverted to deployed state',
      lastSaved: Date.now(),
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error reverting workflow to deployed state: ${id}`, {
      error: error.message,
      stack: error.stack,
    })
    return createErrorResponse(error.message || 'Failed to revert workflow to deployed state', 500)
  }
}
