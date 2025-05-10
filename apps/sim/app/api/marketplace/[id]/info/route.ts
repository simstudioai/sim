import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('MarketplaceInfoAPI')

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params

    // Validate access to the workflow
    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Fetch marketplace data for the workflow
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

    logger.info(`[${requestId}] Retrieved marketplace info for workflow: ${id}`)

    return createSuccessResponse({
      id: marketplaceEntry.id,
      name: marketplaceEntry.name,
      description: marketplaceEntry.description,
      category: marketplaceEntry.category,
      authorName: marketplaceEntry.authorName,
      views: marketplaceEntry.views,
      createdAt: marketplaceEntry.createdAt,
      updatedAt: marketplaceEntry.updatedAt,
    })
  } catch (error) {
    logger.error(
      `[${requestId}] Error getting marketplace info for workflow: ${(await params).id}`,
      error
    )
    return createErrorResponse('Failed to get marketplace information', 500)
  }
}
