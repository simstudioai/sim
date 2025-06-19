import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { templates } from '@/db/schema'

const logger = createLogger('TemplateViewAPI')

// No cache for view tracking
export const dynamic = 'force-dynamic'

/**
 * POST /api/templates/[id]/view
 * Increments the view count for a template
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id: templateId } = await params

    // Validate template ID format
    if (!templateId || typeof templateId !== 'string') {
      logger.warn(`[${requestId}] Invalid template ID: ${templateId}`)
      return NextResponse.json({ error: 'Invalid template ID' }, { status: 400 })
    }

    // Increment view count atomically
    const result = await db
      .update(templates)
      .set({
        views: sql`${templates.views} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, templateId))
      .returning({ id: templates.id, views: templates.views })

    if (!result.length) {
      logger.warn(`[${requestId}] Template not found: ${templateId}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] Incremented view count for template: ${templateId}`, {
      newViewCount: result[0].views,
    })

    return NextResponse.json({
      success: true,
      views: result[0].views,
    })
  } catch (error: unknown) {
    logger.error(`[${requestId}] Error incrementing template view count`, error)
    return NextResponse.json({ error: 'Failed to track view' }, { status: 500 })
  }
}
