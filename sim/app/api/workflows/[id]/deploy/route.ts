import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflow } from '@/db/schema'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

const logger = createLogger('WorkflowDeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Fetching deployment info for workflow: ${id}`)
    const validation = await validateWorkflowAccess(request, id, false)

    if (validation.error) {
      logger.warn(`[${requestId}] Failed to fetch deployment info: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Fetch the workflow information including deployment details
    const result = await db
      .select({
        apiKey: workflow.apiKey,
        isDeployed: workflow.isDeployed,
        deployedAt: workflow.deployedAt,
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
    if (!workflowData.isDeployed || !workflowData.apiKey) {
      logger.info(`[${requestId}] Workflow is not deployed: ${id}`)
      return createSuccessResponse({
        isDeployed: false,
        apiKey: null,
        deployedAt: null,
      })
    }

    logger.info(`[${requestId}] Successfully retrieved deployment info: ${id}`)
    return createSuccessResponse({
      apiKey: workflowData.apiKey,
      isDeployed: workflowData.isDeployed,
      deployedAt: workflowData.deployedAt,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching deployment info: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to fetch deployment information', 500)
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Deploying workflow: ${id}`)
    const validation = await validateWorkflowAccess(request, id, false)

    if (validation.error) {
      logger.warn(`[${requestId}] Workflow deployment failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Generate a new API key
    const apiKey = `wf_${uuidv4().replace(/-/g, '')}`
    const deployedAt = new Date()

    // Update the workflow with the API key and deployment status
    await db
      .update(workflow)
      .set({
        apiKey,
        isDeployed: true,
        deployedAt,
      })
      .where(eq(workflow.id, id))

    logger.info(`[${requestId}] Workflow deployed successfully: ${id}`)
    return createSuccessResponse({ apiKey, isDeployed: true, deployedAt })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deploying workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to deploy workflow', 500)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Undeploying workflow: ${id}`)
    const validation = await validateWorkflowAccess(request, id, false)

    if (validation.error) {
      logger.warn(`[${requestId}] Workflow undeployment failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Update the workflow to remove deployment
    await db
      .update(workflow)
      .set({
        apiKey: null,
        isDeployed: false,
        deployedAt: null,
      })
      .where(eq(workflow.id, id))

    logger.info(`[${requestId}] Workflow undeployed successfully: ${id}`)
    return createSuccessResponse({
      isDeployed: false,
      deployedAt: null,
      apiKey: null,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error undeploying workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to undeploy workflow', 500)
  }
}
