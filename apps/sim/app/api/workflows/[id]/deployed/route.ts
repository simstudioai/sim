import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflow } from '@/db/schema'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

const logger = createLogger('WorkflowDeployedStateAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Fetching deployed state for workflow: ${id}`)
    const validation = await validateWorkflowAccess(request, id, false)

    if (validation.error) {
      logger.warn(`[${requestId}] Failed to fetch deployed state: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Fetch the workflow's deployed state
    const result = await db
      .select({
        deployedState: workflow.deployedState,
        isDeployed: workflow.isDeployed,
      })
      .from(workflow)
      .where(eq(workflow.id, id))
      .limit(1)

    if (result.length === 0) {
      logger.warn(`[${requestId}] Workflow not found: ${id}`)
      return createErrorResponse('Workflow not found', 404)
    }

    const workflowData = result[0]

    // If the workflow is not deployed, return appropriate response
    if (!workflowData.isDeployed || !workflowData.deployedState) {
      logger.info(`[${requestId}] No deployed state available for workflow: ${id}`)
      return createSuccessResponse({
        deployedState: null,
        message: 'Workflow is not deployed or has no deployed state',
      })
    }

    logger.info(`[${requestId}] Successfully retrieved deployed state for: ${id}`)
    return createSuccessResponse({
      deployedState: workflowData.deployedState,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching deployed state: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to fetch deployed state', 500)
  }
} 