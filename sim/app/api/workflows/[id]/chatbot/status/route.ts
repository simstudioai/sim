import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { chatbotDeployment } from '@/db/schema'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatbotStatusAPI')

/**
 * GET endpoint to check if a workflow has an active chatbot deployment
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    logger.debug(`[${requestId}] Checking chatbot deployment status for workflow: ${id}`)

    // Find any active chatbot deployments for this workflow
    const deploymentResults = await db
      .select({
        id: chatbotDeployment.id,
        subdomain: chatbotDeployment.subdomain,
        isActive: chatbotDeployment.isActive,
      })
      .from(chatbotDeployment)
      .where(eq(chatbotDeployment.workflowId, id))
      .limit(1)

    const isDeployed = deploymentResults.length > 0 && deploymentResults[0].isActive
    const deploymentInfo = deploymentResults.length > 0 
      ? {
          id: deploymentResults[0].id,
          subdomain: deploymentResults[0].subdomain,
        } 
      : null

    return createSuccessResponse({
      isDeployed,
      deployment: deploymentInfo,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error checking chatbot deployment status:`, error)
    return createErrorResponse(error.message || 'Failed to check chatbot deployment status', 500)
  }
} 