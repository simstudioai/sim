import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { generateRequestId } from '@/lib/core/utils/request'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatStatusAPI')

/**
 * GET endpoint to check if a workflow has an active chat deployment
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Checking chat deployment status for workflow: ${id}`)

    // Find any active chat deployments for this workflow
    const deploymentResults = await db
      .select({
        id: chat.id,
        identifier: chat.identifier,
        title: chat.title,
        description: chat.description,
        customizations: chat.customizations,
        authType: chat.authType,
        allowedEmails: chat.allowedEmails,
        outputConfigs: chat.outputConfigs,
        password: chat.password,
        isActive: chat.isActive,
      })
      .from(chat)
      .where(eq(chat.workflowId, id))
      .limit(1)

    const isDeployed = deploymentResults.length > 0 && deploymentResults[0].isActive
    const deploymentInfo =
      deploymentResults.length > 0
        ? {
            id: deploymentResults[0].id,
            identifier: deploymentResults[0].identifier,
            title: deploymentResults[0].title,
            description: deploymentResults[0].description,
            customizations: deploymentResults[0].customizations,
            authType: deploymentResults[0].authType,
            allowedEmails: deploymentResults[0].allowedEmails,
            outputConfigs: deploymentResults[0].outputConfigs,
            hasPassword: Boolean(deploymentResults[0].password),
          }
        : null

    return createSuccessResponse({
      isDeployed,
      deployment: deploymentInfo,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error checking chat deployment status:`, error)
    return createErrorResponse(error.message || 'Failed to check chat deployment status', 500)
  }
}
