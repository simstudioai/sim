import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('TemplateViewAPI')

// No cache for view tracking
export const dynamic = 'force-dynamic'

/**
 * POST /api/templates/[id]/view
 * 
 * Increments the view count for a specific template
 * Used when users click on templates or view template details
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: templateId } = await params

  try {
    logger.info(`[${requestId}] Tracking view for template: ${templateId}`)

    // Verify the template exists
    const templateEntry = await db
      .select({
        id: schema.templates.id,
        name: schema.templates.name,
      })
      .from(schema.templates)
      .where(eq(schema.templates.id, templateId))
      .limit(1)
      .then((rows) => rows[0])

    if (!templateEntry) {
      logger.warn(`[${requestId}] Template not found for view tracking: ${templateId}`)
      return createErrorResponse('Template not found', 404)
    }

    // Increment the view count
    await db
      .update(schema.templates)
      .set({
        views: sql`${schema.templates.views} + 1`,
      })
      .where(eq(schema.templates.id, templateId))

    logger.info(`[${requestId}] Successfully tracked view for template: ${templateEntry.name}`)

    return createSuccessResponse({
      success: true,
      templateId,
      message: 'View tracked successfully',
    })

  } catch (error: any) {
    logger.error(`[${requestId}] Error tracking template view`, error)
    return createErrorResponse(`Failed to track view: ${error.message}`, 500)
  }
} 