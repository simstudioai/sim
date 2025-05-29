import { eq, desc, ne, and } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('TemplateSimilarAPI')

// Cache for 10 minutes
export const revalidate = 600

/**
 * GET /api/templates/[id]/similar
 * 
 * Fetches similar templates based on the current template's category
 * Excludes the current template from results
 * 
 * Query parameters:
 * - limit: Maximum number of similar templates to return (default: 6)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: templateId } = await params

  try {
    const url = new URL(request.url)
    const limitParam = url.searchParams.get('limit') || '6'
    const limit = Number.parseInt(limitParam, 10)

    logger.info(`[${requestId}] Fetching similar templates for: ${templateId}`)

    // First, get the current template to find its category
    const currentTemplate = await db
      .select({
        id: schema.templates.id,
        category: schema.templates.category,
        name: schema.templates.name,
      })
      .from(schema.templates)
      .where(eq(schema.templates.id, templateId))
      .limit(1)
      .then((rows) => rows[0])

    if (!currentTemplate) {
      logger.warn(`[${requestId}] Template not found for similar search: ${templateId}`)
      return createErrorResponse('Template not found', 404)
    }

    // Check if the template has a category
    if (!currentTemplate.category) {
      logger.warn(`[${requestId}] Template has no category for similar search: ${templateId}`)
      return createSuccessResponse({
        currentTemplate: {
          id: currentTemplate.id,
          name: currentTemplate.name,
          category: currentTemplate.category,
        },
        similarTemplates: [],
        category: null,
        total: 0,
      })
    }

    // Get similar templates in the same category
    const similarTemplates = await db
      .select({
        id: schema.templates.id,
        name: schema.templates.name,
        short_description: schema.templates.short_description,
        long_description: schema.templates.long_description,
        authorName: schema.templates.authorName,
        views: schema.templates.views,
        category: schema.templates.category,
        createdAt: schema.templates.createdAt,
        updatedAt: schema.templates.updatedAt,
      })
      .from(schema.templates)
      .where(eq(schema.templates.category, currentTemplate.category))
      .orderBy(desc(schema.templates.views), desc(schema.templates.createdAt))
      .limit(limit + 1) // Get one extra to exclude current template
      .then((rows) => rows.filter((row) => row.id !== currentTemplate.id).slice(0, limit))

    logger.info(
      `[${requestId}] Found ${similarTemplates.length} similar templates in category: ${currentTemplate.category}`
    )

    return createSuccessResponse({
      currentTemplate: {
        id: currentTemplate.id,
        name: currentTemplate.name,
        category: currentTemplate.category,
      },
      similarTemplates,
      category: currentTemplate.category,
      total: similarTemplates.length,
    })

  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching similar templates`, error)
    return createErrorResponse(`Failed to fetch similar templates: ${error.message}`, 500)
  }
} 