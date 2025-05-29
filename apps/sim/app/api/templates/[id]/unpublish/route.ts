import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('TemplateUnpublishAPI')

// No cache for unpublish operations
export const dynamic = 'force-dynamic'

/**
 * POST /api/templates/[id]/unpublish
 * 
 * Unpublishes a template (removes it from public view)
 * This could be implemented as a soft delete or visibility toggle
 * 
 * Request body:
 * - reason?: Optional reason for unpublishing
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: templateId } = await params

  try {
    const body = await request.json().catch(() => ({}))
    const { reason } = body

    logger.info(`[${requestId}] Unpublishing template: ${templateId}${reason ? ` (reason: ${reason})` : ''}`)

    // Verify the template exists
    const templateEntry = await db
      .select({
        id: schema.templates.id,
        name: schema.templates.name,
        authorId: schema.templates.authorId,
      })
      .from(schema.templates)
      .where(eq(schema.templates.id, templateId))
      .limit(1)
      .then((rows) => rows[0])

    if (!templateEntry) {
      logger.warn(`[${requestId}] Template not found for unpublishing: ${templateId}`)
      return createErrorResponse('Template not found', 404)
    }

    // TODO: Add authorization check here
    // Ensure the user has permission to unpublish this template
    // This would typically check if the user is the author or has admin rights

    // For now, we'll implement this as a deletion from the templates table
    // In a production system, you might want to add a "published" flag instead
    await db
      .delete(schema.templates)
      .where(eq(schema.templates.id, templateId))

    logger.info(`[${requestId}] Successfully unpublished template: ${templateEntry.name}`)

    return createSuccessResponse({
      success: true,
      templateId,
      templateName: templateEntry.name,
      message: 'Template unpublished successfully',
      reason: reason || null,
    })

  } catch (error: any) {
    logger.error(`[${requestId}] Error unpublishing template`, error)
    return createErrorResponse(`Failed to unpublish template: ${error.message}`, 500)
  }
} 