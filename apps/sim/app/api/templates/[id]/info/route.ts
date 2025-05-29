import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('TemplateInfoAPI')

// Cache for 5 minutes
export const revalidate = 300

/**
 * GET /api/templates/[id]/info
 * 
 * Fetches detailed information about a specific template
 * Including workflow state if requested
 * 
 * Query parameters:
 * - includeState: Whether to include workflow state (default: false)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: templateId } = await params

  try {
    const url = new URL(request.url)
    const includeState = url.searchParams.get('includeState') === 'true'

    logger.info(`[${requestId}] Fetching template info: ${templateId}${includeState ? ' with state' : ''}`)

    // Fetch the template with appropriate fields
    let templateEntry

    if (includeState) {
      // Query with state included
      templateEntry = await db
        .select({
          id: schema.templates.id,
          workflowId: schema.templates.workflowId,
          name: schema.templates.name,
          short_description: schema.templates.short_description,
          long_description: schema.templates.long_description,
          authorId: schema.templates.authorId,
          authorName: schema.templates.authorName,
          state: schema.templates.state,
          views: schema.templates.views,
          category: schema.templates.category,
          createdAt: schema.templates.createdAt,
          updatedAt: schema.templates.updatedAt,
        })
        .from(schema.templates)
        .where(eq(schema.templates.id, templateId))
        .limit(1)
        .then((rows) => rows[0])
    } else {
      // Query without state
      templateEntry = await db
        .select({
          id: schema.templates.id,
          workflowId: schema.templates.workflowId,
          name: schema.templates.name,
          short_description: schema.templates.short_description,
          long_description: schema.templates.long_description,
          authorId: schema.templates.authorId,
          authorName: schema.templates.authorName,
          views: schema.templates.views,
          category: schema.templates.category,
          createdAt: schema.templates.createdAt,
          updatedAt: schema.templates.updatedAt,
        })
        .from(schema.templates)
        .where(eq(schema.templates.id, templateId))
        .limit(1)
        .then((rows) => rows[0])
    }

    if (!templateEntry) {
      logger.warn(`[${requestId}] Template not found: ${templateId}`)
      return createErrorResponse('Template not found', 404)
    }

    // Transform response if state was included
    const responseData = includeState && 'state' in templateEntry
      ? {
          ...templateEntry,
          workflowState: templateEntry.state,
          state: undefined, // Remove the raw state field
        }
      : templateEntry

    logger.info(`[${requestId}] Successfully fetched template info: ${templateEntry.name}`)
    return createSuccessResponse(responseData)

  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching template info`, error)
    return createErrorResponse(`Failed to fetch template info: ${error.message}`, 500)
  }
}