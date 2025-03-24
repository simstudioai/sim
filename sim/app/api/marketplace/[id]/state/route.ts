import { NextRequest } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('MarketplaceStateAPI')

// Cache for 1 hour
export const revalidate = 3600

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params

    // Fetch marketplace data to get the state
    const marketplaceEntry = await db
      .select({
        id: schema.marketplace.id,
        state: schema.marketplace.state,
      })
      .from(schema.marketplace)
      .where(eq(schema.marketplace.workflowId, id))
      .limit(1)
      .then((rows) => rows[0])

    if (!marketplaceEntry) {
      logger.warn(`[${requestId}] No marketplace entry found for workflow: ${id}`)
      return createErrorResponse('Workflow not found in marketplace', 404)
    }

    // Increment the view count for this workflow
    await db
      .update(schema.marketplace)
      .set({ 
        views: sql`${schema.marketplace.views} + 1` 
      })
      .where(eq(schema.marketplace.workflowId, id))

    logger.info(`[${requestId}] Retrieved workflow state for marketplace item: ${id}`)

    return createSuccessResponse({
      id: marketplaceEntry.id,
      state: marketplaceEntry.state,
    })
  } catch (error) {
    logger.error(
      `[${requestId}] Error getting workflow state for marketplace item: ${(await params).id}`,
      error
    )
    return createErrorResponse('Failed to get workflow state', 500)
  }
} 