import { NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('MarketplaceStarAPI')

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params
    const session = await getSession()
    const userId = session?.user?.id

    if (!userId) {
      return createErrorResponse('Unauthorized', 401)
    }

    // Check if the marketplace entry exists
    const marketplaceEntry = await db
      .select()
      .from(schema.marketplace)
      .where(eq(schema.marketplace.id, id))
      .limit(1)
      .then((rows) => rows[0])

    if (!marketplaceEntry) {
      logger.warn(`[${requestId}] No marketplace entry found with ID: ${id}`)
      return createErrorResponse('Marketplace entry not found', 404)
    }

    // Check if the user has already starred this workflow
    const existingStar = await db
      .select()
      .from(schema.marketplaceStar)
      .where(
        and(eq(schema.marketplaceStar.marketplaceId, id), eq(schema.marketplaceStar.userId, userId))
      )
      .limit(1)
      .then((rows) => rows[0])

    let action
    if (existingStar) {
      // User has already starred, so unstar it
      await db
        .delete(schema.marketplaceStar)
        .where(
          and(
            eq(schema.marketplaceStar.marketplaceId, id),
            eq(schema.marketplaceStar.userId, userId)
          )
        )

      // Decrement the star count
      await db
        .update(schema.marketplace)
        .set({ stars: marketplaceEntry.stars - 1 })
        .where(eq(schema.marketplace.id, id))

      action = 'unstarred'
    } else {
      // User hasn't starred yet, add a star
      await db.insert(schema.marketplaceStar).values({
        id: crypto.randomUUID(),
        marketplaceId: id,
        userId: userId,
        createdAt: new Date(),
      })

      // Increment the star count
      await db
        .update(schema.marketplace)
        .set({ stars: marketplaceEntry.stars + 1 })
        .where(eq(schema.marketplace.id, id))

      action = 'starred'
    }

    logger.info(`[${requestId}] User ${userId} ${action} marketplace entry: ${id}`)

    return createSuccessResponse({
      success: true,
      action,
      stars: action === 'starred' ? marketplaceEntry.stars + 1 : marketplaceEntry.stars - 1,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error starring marketplace entry: ${(await params).id}`, error)
    return createErrorResponse('Failed to update star status', 500)
  }
}

// GET endpoint to check if user has starred a workflow
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params
    const session = await getSession()
    const userId = session?.user?.id

    if (!userId) {
      return createErrorResponse('Unauthorized', 401)
    }

    // Check if the user has already starred this workflow
    const existingStar = await db
      .select()
      .from(schema.marketplaceStar)
      .where(
        and(eq(schema.marketplaceStar.marketplaceId, id), eq(schema.marketplaceStar.userId, userId))
      )
      .limit(1)
      .then((rows) => rows[0])

    return createSuccessResponse({
      isStarred: !!existingStar,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error checking star status: ${(await params).id}`, error)
    return createErrorResponse('Failed to check star status', 500)
  }
}
