import { eq, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { marketplace } from '@/db/schema'

const logger = createLogger('MarketplaceViewAPI')

/**
 * POST handler for incrementing the view count when a workflow card is clicked
 * This endpoint is called from the WorkflowCard component's onClick handler
 *
 * The ID parameter is the marketplace entry ID, not the workflow ID
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params

    // Find the marketplace entry for this marketplace ID
    const marketplaceEntry = await db
      .select({
        id: marketplace.id,
      })
      .from(marketplace)
      .where(eq(marketplace.id, id))
      .limit(1)
      .then((rows) => rows[0])

    if (!marketplaceEntry) {
      logger.warn(`[${requestId}] No marketplace entry found with ID: ${id}`)
      return createErrorResponse('Marketplace entry not found', 404)
    }

    // Increment the view count for this workflow
    await db
      .update(marketplace)
      .set({
        views: sql`${marketplace.views} + 1`,
      })
      .where(eq(marketplace.id, id))

    logger.info(`[${requestId}] Incremented view count for marketplace entry: ${id}`)

    return createSuccessResponse({
      success: true,
    })
  } catch (error) {
    logger.error(
      `[${requestId}] Error incrementing view count for marketplace entry: ${(await params).id}`,
      error
    )
    return createErrorResponse('Failed to track view', 500)
  }
}
