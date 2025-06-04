import { desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { CATEGORIES } from '@/app/w/templates/constants/categories'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('TemplatesWorkflowsAPI')

// Cache for 1 minute but can be revalidated on-demand
export const revalidate = 60

/**
 * Consolidated API endpoint for template workflows
 *
 * Supports:
 * - Getting featured/popular/recent templates
 * - Getting templates by category
 * - Getting template state
 * - Getting template details
 * - Incrementing view counts
 *
 * Query parameters:
 * - section: 'popular', 'recent', 'byCategory', or specific category name
 * - limit: Maximum number of items to return per section (default: 6)
 * - includeState: Whether to include workflow state in the response (default: false)
 * - workflowId: Specific workflow ID to fetch details for
 * - templateId: Specific template entry ID to fetch details for
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Parse query parameters
    const url = new URL(request.url)
    const sectionParam = url.searchParams.get('section')
    const categoryParam = url.searchParams.get('category')
    const limitParam = url.searchParams.get('limit') || '6'
    const limit = Number.parseInt(limitParam, 10)
    const includeState = url.searchParams.get('includeState') === 'true'
    const workflowId = url.searchParams.get('workflowId')
    const templateId = url.searchParams.get('templateId')

    // Handle single workflow request first (by workflow ID)
    if (workflowId) {
      let templateEntry

      if (includeState) {
        // Query with state included
        templateEntry = await db
          .select({
            id: schema.templates.id,
            name: schema.templates.name,
            short_description: schema.templates.short_description,
            long_description: schema.templates.long_description,
            authorId: schema.templates.authorId,
            authorName: schema.templates.authorName,
            state: schema.templates.state,
            category: schema.templates.category,
            createdAt: schema.templates.createdAt,
            updatedAt: schema.templates.updatedAt,
          })
          .from(schema.templates)
          .where(eq(schema.templates.id, workflowId))
          .limit(1)
          .then((rows) => rows[0])
      } else {
        // Query without state
        templateEntry = await db
          .select({
            id: schema.templates.id,
            name: schema.templates.name,
            short_description: schema.templates.short_description,
            long_description: schema.templates.long_description,
            authorId: schema.templates.authorId,
            authorName: schema.templates.authorName,
            category: schema.templates.category,
            createdAt: schema.templates.createdAt,
            updatedAt: schema.templates.updatedAt,
          })
          .from(schema.templates)
          .where(eq(schema.templates.id, workflowId))
          .limit(1)
          .then((rows) => rows[0])
      }

      if (!templateEntry) {
        logger.warn(`[${requestId}] No template entry found for workflow: ${workflowId}`)
        return createErrorResponse('Workflow not found in templates', 404)
      }

      // Transform response if state was requested
      const responseData =
        includeState && 'state' in templateEntry
          ? {
              ...templateEntry,
              workflowState: templateEntry.state,
              state: undefined,
            }
          : templateEntry

      logger.info(`[${requestId}] Retrieved template data for workflow: ${workflowId}`)
      return createSuccessResponse(responseData)
    }

    // Handle single template entry request (by template ID)
    if (templateId) {
      let templateEntry

      if (includeState) {
        // Query with state included
        templateEntry = await db
          .select({
            id: schema.templates.id,
            name: schema.templates.name,
            short_description: schema.templates.short_description,
            long_description: schema.templates.long_description,
            authorId: schema.templates.authorId,
            authorName: schema.templates.authorName,
            state: schema.templates.state,
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
            name: schema.templates.name,
            short_description: schema.templates.short_description,
            long_description: schema.templates.long_description,
            authorId: schema.templates.authorId,
            authorName: schema.templates.authorName,
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
        logger.warn(`[${requestId}] No template entry found with ID: ${templateId}`)
        return createErrorResponse('Template entry not found', 404)
      }

      // Transform response if state was requested
      const responseData =
        includeState && 'state' in templateEntry
          ? {
              ...templateEntry,
              workflowState: templateEntry.state,
              state: undefined,
            }
          : templateEntry

      logger.info(`[${requestId}] Retrieved template entry: ${templateId}`)
      return createSuccessResponse(responseData)
    }

    // Handle featured/collection requests
    const result: {
      popular: any[]
      recent: any[]
      byCategory: Record<string, any[]>
    } = {
      popular: [],
      recent: [],
      byCategory: {},
    }

    // Define common fields to select
    const baseFields = {
      id: schema.templates.id,
      name: schema.templates.name,
      short_description: schema.templates.short_description,
      long_description: schema.templates.long_description,
      authorName: schema.templates.authorName,
      views: schema.templates.views,
      category: schema.templates.category,
      price: schema.templates.price,
      createdAt: schema.templates.createdAt,
      updatedAt: schema.templates.updatedAt,
    }

    // Add state if requested
    const selectFields = includeState
      ? { ...baseFields, state: schema.templates.state }
      : baseFields

    // Determine which sections to fetch
    const sections = sectionParam ? sectionParam.split(',') : ['popular', 'recent', 'byCategory']

    // Early return for simple queries (performance optimization)
    if (sections.length <= 2 && !sections.includes('byCategory') && !categoryParam) {
      // Simple query - just popular and/or recent
      if (sections.includes('popular')) {
        result.popular = await db.select(selectFields).from(schema.templates).limit(limit)
      }

      if (sections.includes('recent')) {
        result.recent = await db.select(selectFields).from(schema.templates).limit(limit)
      }

      logger.info(
        `[${requestId}] Simple query completed - fetched ${Object.keys(result).length} sections`
      )
      return NextResponse.json(result)
    }

    // Get categories if requested
    if (
      sections.includes('byCategory') ||
      categoryParam ||
      sections.some((s) => CATEGORIES.some((c) => c.value === s))
    ) {
      // Identify all requested categories
      const requestedCategories = new Set<string>()

      // Add explicitly requested category
      if (categoryParam) {
        requestedCategories.add(categoryParam)
      }

      // Add categories from sections parameter
      sections.forEach((section) => {
        if (CATEGORIES.some((c) => c.value === section)) {
          requestedCategories.add(section)
        }
      })

      // Include byCategory section contents if requested
      if (sections.includes('byCategory')) {
        CATEGORIES.forEach((c) => requestedCategories.add(c.value))
      }

      // Log what we're fetching
      const categoriesToFetch = Array.from(requestedCategories)
      logger.info(`[${requestId}] Fetching specific categories: ${categoriesToFetch.join(', ')}`)

      // Process each requested category
      await Promise.all(
        categoriesToFetch.map(async (categoryValue) => {
          const categoryItems = await db
            .select(selectFields)
            .from(schema.templates)
            .where(eq(schema.templates.category, categoryValue))
            .limit(limit)

          // Always add the category to the result, even if empty
          result.byCategory[categoryValue] = categoryItems
        })
      )
    }

    // Get popular items if requested
    if (sections.includes('popular')) {
      result.popular = await db.select(selectFields).from(schema.templates).limit(limit)
    }

    // Get recent items if requested
    if (sections.includes('recent')) {
      result.recent = await db
        .select(selectFields)
        .from(schema.templates)
        .orderBy(desc(schema.templates.createdAt))
        .limit(limit)
    }

    // Transform the data if state was included to match the expected format
    if (includeState) {
      const transformSection = (section: any[]) => {
        return section.map((item) => {
          if ('state' in item) {
            // Create a new object without the state field, but with workflowState
            const { state, ...rest } = item
            return {
              ...rest,
              workflowState: state,
            }
          }
          return item
        })
      }

      if (result.popular.length > 0) {
        result.popular = transformSection(result.popular)
      }

      if (result.recent.length > 0) {
        result.recent = transformSection(result.recent)
      }

      Object.keys(result.byCategory).forEach((category) => {
        if (result.byCategory[category].length > 0) {
          result.byCategory[category] = transformSection(result.byCategory[category])
        }
      })
    }

    logger.info(`[${requestId}] Fetched template items${includeState ? ' with state' : ''}`)
    return NextResponse.json(result)
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching template items`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST handler for incrementing view counts
 *
 * @deprecated This endpoint is deprecated. Use /api/templates/[id]/view instead.
 *
 * Request body:
 * - id: Template entry ID to increment view count for
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const { id } = body

    if (!id) {
      return createErrorResponse('Template ID is required', 400)
    }

    logger.warn(
      `[${requestId}] Using deprecated POST endpoint. Please use /api/templates/${id}/view instead.`
    )

    // Redirect to the new organized endpoint
    const viewResponse = await fetch(`${new URL(request.url).origin}/api/templates/${id}/view`, {
      method: 'POST',
    })

    if (!viewResponse.ok) {
      const errorText = await viewResponse.text()
      logger.error(`[${requestId}] Error from new view endpoint: ${errorText}`)
      return createErrorResponse('Failed to track view', viewResponse.status)
    }

    const result = await viewResponse.json()
    logger.info(`[${requestId}] Successfully redirected view tracking for template: ${id}`)

    return createSuccessResponse(result)
  } catch (error: any) {
    logger.error(`[${requestId}] Error in deprecated view tracking endpoint`, error)
    return createErrorResponse(`Failed to track view: ${error.message}`, 500)
  }
}
