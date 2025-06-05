import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { templates } from '@/db/schema'

const logger = createLogger('PublishedTemplatesAPI')

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user?.id) {
      return createErrorResponse('Unauthorized', 401)
    }

    const url = new URL(request.url)
    const includeState = url.searchParams.get('includeState') === 'true'

    logger.info(
      `[${requestId}] Fetching published templates for user ${session.user.id}${includeState ? ' with state' : ''}`
    )

    const publishedTemplatesList = await db
      .select({
        id: templates.id,
        name: templates.name,
        short_description: templates.short_description,
        long_description: templates.long_description,
        category: templates.category,
        price: templates.price,
        views: templates.views,
        createdAt: templates.createdAt,
        updatedAt: templates.updatedAt,
        // Include state if requested
        ...(includeState ? { state: templates.state } : {}),
      })
      .from(templates)
      .where(eq(templates.authorId, session.user.id))
      .orderBy(templates.createdAt)

    logger.info(
      `[${requestId}] Successfully fetched ${publishedTemplatesList.length} published templates`
    )

    return createSuccessResponse({
      published: publishedTemplatesList,
      total: publishedTemplatesList.length,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching published templates:`, error)
    return createErrorResponse(`Failed to fetch published templates: ${error.message}`, 500)
  }
}
