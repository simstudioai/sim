import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('PublicWorkflowAPI')

// Cache response for performance
export const revalidate = 3600

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params

    // First, check if the workflow exists and is published to the marketplace
    const marketplaceEntry = await db
      .select({
        id: schema.marketplace.id,
        workflowId: schema.marketplace.workflowId,
        state: schema.marketplace.state,
        name: schema.marketplace.name,
        description: schema.marketplace.description,
        authorId: schema.marketplace.authorId,
        authorName: schema.marketplace.authorName,
      })
      .from(schema.marketplace)
      .where(eq(schema.marketplace.workflowId, id))
      .limit(1)
      .then((rows) => rows[0])

    if (!marketplaceEntry) {
      // Check if workflow exists but is not in marketplace
      const workflowExists = await db
        .select({ id: schema.workflow.id })
        .from(schema.workflow)
        .where(eq(schema.workflow.id, id))
        .limit(1)
        .then((rows) => rows.length > 0)

      if (!workflowExists) {
        logger.warn(`[${requestId}] Workflow not found: ${id}`)
        return createErrorResponse('Workflow not found', 404)
      }

      logger.warn(`[${requestId}] Workflow exists but is not published: ${id}`)
      return createErrorResponse('Workflow is not published', 403)
    }

    logger.info(`[${requestId}] Retrieved public workflow: ${id}`)

    return createSuccessResponse({
      id: marketplaceEntry.workflowId,
      name: marketplaceEntry.name,
      description: marketplaceEntry.description,
      authorId: marketplaceEntry.authorId,
      authorName: marketplaceEntry.authorName,
      state: marketplaceEntry.state,
      isPublic: true,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting public workflow: ${(await params).id}`, error)
    return createErrorResponse('Failed to get public workflow', 500)
  }
}
