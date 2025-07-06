import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { marketplace, workflow } from '@/db/schema'

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
        id: marketplace.id,
        workflowId: marketplace.workflowId,
        state: marketplace.state,
        name: marketplace.name,
        description: marketplace.description,
        authorId: marketplace.authorId,
        authorName: marketplace.authorName,
      })
      .from(marketplace)
      .where(eq(marketplace.workflowId, id))
      .limit(1)
      .then((rows) => rows[0])

    if (!marketplaceEntry) {
      // Check if workflow exists but is not in marketplace
      const workflowExists = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.id, id))
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
