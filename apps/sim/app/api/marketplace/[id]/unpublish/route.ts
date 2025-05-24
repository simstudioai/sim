import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('MarketplaceUnpublishAPI')

/**
 * API endpoint to unpublish a workflow from the marketplace by its marketplace ID
 *
 * Security:
 * - Requires authentication
 * - Validates that the current user is the author of the marketplace entry
 * - Only allows the owner to unpublish
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params

    // Get the session first for authorization
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized unpublish attempt for marketplace ID: ${id}`)
      return createErrorResponse('Unauthorized', 401)
    }

    const userId = session.user.id

    // Get the marketplace entry using the marketplace ID
    const marketplaceEntry = await db
      .select({
        id: schema.marketplace.id,
        workflowId: schema.marketplace.workflowId,
        authorId: schema.marketplace.authorId,
        name: schema.marketplace.name,
      })
      .from(schema.marketplace)
      .where(eq(schema.marketplace.id, id))
      .limit(1)
      .then((rows) => rows[0])

    if (!marketplaceEntry) {
      logger.warn(`[${requestId}] No marketplace entry found with ID: ${id}`)
      return createErrorResponse('Marketplace entry not found', 404)
    }

    // Check if the user is the author of the marketplace entry
    if (marketplaceEntry.authorId !== userId) {
      logger.warn(
        `[${requestId}] User ${userId} tried to unpublish marketplace entry they don't own: ${id}, author: ${marketplaceEntry.authorId}`
      )
      return createErrorResponse('You do not have permission to unpublish this workflow', 403)
    }

    const workflowId = marketplaceEntry.workflowId

    // Verify the workflow exists and belongs to the user
    const workflow = await db
      .select({
        id: schema.workflow.id,
        userId: schema.workflow.userId,
      })
      .from(schema.workflow)
      .where(eq(schema.workflow.id, workflowId))
      .limit(1)
      .then((rows) => rows[0])

    if (!workflow) {
      logger.warn(`[${requestId}] Associated workflow not found: ${workflowId}`)
      // We'll still delete the marketplace entry even if the workflow is missing
    } else if (workflow.userId !== userId) {
      logger.warn(
        `[${requestId}] Workflow ${workflowId} belongs to user ${workflow.userId}, not current user ${userId}`
      )
      return createErrorResponse('You do not have permission to unpublish this workflow', 403)
    }

    try {
      // Delete the marketplace entry - this is the primary action
      await db.delete(schema.marketplace).where(eq(schema.marketplace.id, id))

      // Update the workflow to mark it as unpublished if it exists
      if (workflow) {
        await db
          .update(schema.workflow)
          .set({ isPublished: false })
          .where(eq(schema.workflow.id, workflowId))
      }

      logger.info(
        `[${requestId}] Workflow "${marketplaceEntry.name}" unpublished from marketplace: ID=${id}, workflowId=${workflowId}`
      )

      return createSuccessResponse({
        success: true,
        message: 'Workflow successfully unpublished from marketplace',
      })
    } catch (dbError) {
      logger.error(`[${requestId}] Database error unpublishing marketplace entry:`, dbError)
      return createErrorResponse('Failed to unpublish workflow due to a database error', 500)
    }
  } catch (error) {
    logger.error(`[${requestId}] Error unpublishing marketplace entry: ${(await params).id}`, error)
    return createErrorResponse('Failed to unpublish workflow', 500)
  }
}
