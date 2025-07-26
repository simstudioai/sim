import { eq } from 'drizzle-orm'
import type { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { workflow } from '@/db/schema'

const logger = createLogger('WorkflowDeployedStateAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Helper function to add Cache-Control headers to NextResponse
function addNoCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
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
      const response = createErrorResponse('Workflow not found', 404)
      return addNoCacheHeaders(response)
    }

    const workflowData = result[0]

    // If the workflow is not deployed, return appropriate response
    if (!workflowData.isDeployed || !workflowData.deployedState) {
      const response = createSuccessResponse({
        deployedState: null,
        message: 'Workflow is not deployed or has no deployed state',
      })
      return addNoCacheHeaders(response)
    }

    const response = createSuccessResponse({
      deployedState: workflowData.deployedState,
    })
    return addNoCacheHeaders(response)
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching deployed state: ${id}`, error)
    const response = createErrorResponse(error.message || 'Failed to fetch deployed state', 500)
    return addNoCacheHeaders(response)
  }
}
