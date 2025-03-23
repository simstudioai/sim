import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('MarketplaceUnpublishAPI')

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params

    // Validate access to the workflow (must be owner to unpublish)
    // Pass false to requireDeployment since unpublishing doesn't require the workflow to be deployed
    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Check if workflow is published
    const marketplaceEntry = await db
      .select()
      .from(schema.marketplace)
      .where(eq(schema.marketplace.workflowId, id))
      .limit(1)
      .then((rows) => rows[0])

    if (!marketplaceEntry) {
      logger.warn(`[${requestId}] No marketplace entry found for workflow: ${id}`)
      return createErrorResponse('Workflow is not published to marketplace', 404)
    }

    // Delete the marketplace entry
    await db.delete(schema.marketplace).where(eq(schema.marketplace.workflowId, id))

    // Update the workflow to mark it as unpublished
    await db.update(schema.workflow).set({ isPublished: false }).where(eq(schema.workflow.id, id))

    logger.info(`[${requestId}] Workflow unpublished from marketplace: ${id}`)

    return createSuccessResponse({
      success: true,
      message: 'Workflow successfully unpublished from marketplace',
    })
  } catch (error) {
    logger.error(`[${requestId}] Error unpublishing workflow: ${(await params).id}`, error)
    return createErrorResponse('Failed to unpublish workflow', 500)
  }
}
