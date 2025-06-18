import { eq } from 'drizzle-orm'
import type { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { loadDeployedWorkflowState } from '@/lib/workflows/db-helpers'
import { db } from '@/db'
import { workflow } from '@/db/schema'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

const logger = createLogger('WorkflowDeployedStateAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Helper function to add Cache-Control headers to NextResponse
function addNoCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
  return response
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Fetching deployed state for workflow: ${id}`)
    const validation = await validateWorkflowAccess(request, id, false)

    if (validation.error) {
      logger.warn(`[${requestId}] Failed to fetch deployed state: ${validation.error.message}`)
      const response = createErrorResponse(validation.error.message, validation.error.status)
      return addNoCacheHeaders(response)
    }

    // Fetch the workflow's deployment information (both new and legacy fields)
    const result = await db
      .select({
        deployedHash: workflow.deployedHash,
        deployedState: workflow.deployedState, // Legacy field for fallback
        isDeployed: workflow.isDeployed,
      })
      .from(workflow)
      .where(eq(workflow.id, id))
      .limit(1)

    if (result.length === 0) {
      logger.warn(`[${requestId}] Workflow not found: ${id}`)
      const response = createErrorResponse('Workflow not found', 404)
      return addNoCacheHeaders(response)
    }

    const workflowData = result[0]

    // If the workflow is not deployed, return appropriate response
    if (!workflowData.isDeployed) {
      const response = createSuccessResponse({
        deployedState: null,
        message: 'Workflow is not deployed',
      })
      return addNoCacheHeaders(response)
    }

    let deployedState = null

    // Try hash-based approach first (new system)
    if (workflowData.deployedHash) {
      logger.debug(
        `[${requestId}] Attempting to load deployed state using hash: ${workflowData.deployedHash}`
      )
      const deployedStateResult = await loadDeployedWorkflowState(id, workflowData.deployedHash)

      if (deployedStateResult.success) {
        deployedState = deployedStateResult.state
        logger.info(`[${requestId}] Successfully loaded deployed state using hash`)
      } else {
        logger.warn(
          `[${requestId}] Failed to load deployed state using hash: ${deployedStateResult.error}`
        )
      }
    }

    // Fallback to legacy deployedState field if hash method failed
    if (!deployedState && workflowData.deployedState) {
      logger.debug(`[${requestId}] Falling back to legacy deployedState field`)
      deployedState = workflowData.deployedState
      logger.info(`[${requestId}] Successfully loaded deployed state using legacy field`)
    }

    // If neither method worked
    if (!deployedState) {
      logger.warn(`[${requestId}] No deployed state found using either method`)
      const response = createSuccessResponse({
        deployedState: null,
        message: 'Workflow is deployed but has no deployed state available',
      })
      return addNoCacheHeaders(response)
    }

    const response = createSuccessResponse({
      deployedState,
      message: 'Deployed state fetched successfully',
    })
    return addNoCacheHeaders(response)
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching deployed state for workflow ${id}:`, error)
    const response = createErrorResponse('Failed to fetch deployed state', 500)
    return addNoCacheHeaders(response)
  }
}
