import { desc, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { CATEGORIES } from '@/app/w/templates/constants/categories'
import type { TemplateData, WorkflowState } from '@/app/w/templates/types'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('TemplatesWorkflowsAPI')

// Cache for 5 minutes but can be revalidated on-demand
export const revalidate = 300

// API-specific types for this route
interface SingleTemplate {
  id: string
  name: string
  shortDescription: string | null
  longDescription: string | null
  authorId: string
  authorName: string
  category: string | null
  createdAt: Date
  updatedAt: Date
}

interface SingleTemplateWithState extends SingleTemplate {
  workflowState: WorkflowState // Proper workflow state type
}

interface TemplateCollectionResponse {
  popular: TemplateData[]
  recent: TemplateData[]
  byCategory: Record<string, TemplateData[]>
}

interface FetchSingleTemplateResult {
  data?: SingleTemplate | SingleTemplateWithState
  error?: string
  status?: number
}

// Database query result types based on schema
interface DbTemplateBase {
  id: string
  name: string
  shortDescription: string | null
  longDescription: string | null
  authorName: string
  views: number
  category: string | null
  price: string
  createdAt: Date
  updatedAt: Date
}

interface DbTemplateWithState extends DbTemplateBase {
  state: WorkflowState // Proper workflow state type
}

/**
 * Fetches a single template entry by ID with optional state inclusion
 */
async function fetchSingleTemplate(
  id: string,
  condition: 'workflowId' | 'templateId',
  includeState: boolean,
  requestId: string
): Promise<FetchSingleTemplateResult> {
  // Define base fields
  const baseFields = {
    id: schema.templates.id,
    name: schema.templates.name,
    shortDescription: schema.templates.shortDescription,
    longDescription: schema.templates.longDescription,
    authorId: schema.templates.authorId,
    authorName: schema.templates.authorName,
    category: schema.templates.category,
    createdAt: schema.templates.createdAt,
    updatedAt: schema.templates.updatedAt,
  }

  // Add state field if needed
  const fieldsToSelect = includeState
    ? { ...baseFields, state: schema.templates.state }
    : baseFields

  // Determine the where condition
  const whereCondition =
    condition === 'workflowId' ? eq(schema.templates.workflowId, id) : eq(schema.templates.id, id)

  // Execute query
  const templateEntry = await db
    .select(fieldsToSelect)
    .from(schema.templates)
    .where(whereCondition)
    .limit(1)
    .then((rows) => rows[0])

  if (!templateEntry) {
    const entityType = condition === 'workflowId' ? 'workflow' : 'template entry'
    logger.warn(`[${requestId}] No template entry found for ${entityType}: ${id}`)
    const errorMessage =
      condition === 'workflowId' ? 'Workflow not found in templates' : 'Template entry not found'
    return { error: errorMessage, status: 404 }
  }

  // Transform response data
  const responseData: SingleTemplate | SingleTemplateWithState =
    includeState && 'state' in templateEntry
      ? {
          ...templateEntry,
          workflowState: templateEntry.state as WorkflowState,
        }
      : templateEntry

  return { data: responseData }
}

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
  const startTime = Date.now()

  try {
    // Parse query parameters
    const url = new URL(request.url)
    const sectionParam = url.searchParams.get('section')
    const categoryParam = url.searchParams.get('category')
    const limitParam = url.searchParams.get('limit') || '6'
    const popularLimitParam = url.searchParams.get('popularLimit')
    const limit = Number.parseInt(limitParam, 10)
    const popularLimit = popularLimitParam ? Number.parseInt(popularLimitParam, 10) : limit
    const includeState = url.searchParams.get('includeState') === 'true'
    const workflowId = url.searchParams.get('workflowId')
    const templateId = url.searchParams.get('templateId')

    // Handle single workflow request first (by workflow ID)
    if (workflowId) {
      const result = await fetchSingleTemplate(workflowId, 'workflowId', includeState, requestId)
      if (result.error) {
        return createErrorResponse(result.error, result.status!)
      }
      return createSuccessResponse(result.data)
    }

    // Handle single template entry request (by template ID)
    if (templateId) {
      const result = await fetchSingleTemplate(templateId, 'templateId', includeState, requestId)
      if (result.error) {
        return createErrorResponse(result.error, result.status!)
      }
      return createSuccessResponse(result.data)
    }

    // Handle featured/collection requests
    const result: TemplateCollectionResponse = {
      popular: [],
      recent: [],
      byCategory: {},
    }

    // Define base fields (without state for performance)
    const baseFields = {
      id: schema.templates.id,
      name: schema.templates.name,
      shortDescription: schema.templates.shortDescription,
      longDescription: schema.templates.longDescription,
      authorName: schema.templates.authorName,
      views: schema.templates.views,
      category: schema.templates.category,
      price: schema.templates.price,
      createdAt: schema.templates.createdAt,
      updatedAt: schema.templates.updatedAt,
    }

    // Add state fields for queries that need it
    const fieldsWithState = {
      ...baseFields,
      state: schema.templates.state,
    }

    // Determine which sections to fetch
    const sections = sectionParam ? sectionParam.split(',') : ['popular', 'recent', 'byCategory']

    // Optimize: Use single query for multiple categories when possible
    if (sections.includes('byCategory') || categoryParam) {
      let requestedCategories: string[] = []

      if (categoryParam) {
        // Handle comma-separated categories in categoryParam
        requestedCategories = categoryParam.split(',').filter(Boolean)
      }

      // Add categories from sections parameter
      sections.forEach((section) => {
        if (CATEGORIES.some((c) => c.value === section)) {
          requestedCategories.push(section)
        }
      })

      // Include all categories if byCategory is requested
      if (sections.includes('byCategory')) {
        CATEGORIES.forEach((c) => requestedCategories.push(c.value))
      }

      // Remove duplicates
      requestedCategories = [...new Set(requestedCategories)]

      if (requestedCategories.length > 0) {
        // Single optimized query for all categories
        const categoryTemplates = includeState
          ? await db
              .select(fieldsWithState)
              .from(schema.templates)
              .where(inArray(schema.templates.category, requestedCategories))
              .orderBy(desc(schema.templates.views), desc(schema.templates.createdAt))
          : await db
              .select(baseFields)
              .from(schema.templates)
              .where(inArray(schema.templates.category, requestedCategories))
              .orderBy(desc(schema.templates.views), desc(schema.templates.createdAt))

        // Group results by category
        requestedCategories.forEach((categoryValue) => {
          const categoryItems = categoryTemplates
            .filter((item) => item.category === categoryValue)
            .slice(0, limit)
          result.byCategory[categoryValue] = categoryItems.map(transformToTemplateData)
        })
      }
    }

    // Get popular items if requested (optimized with views index)
    if (sections.includes('popular')) {
      const popularItems = includeState
        ? await db
            .select(fieldsWithState)
            .from(schema.templates)
            .orderBy(desc(schema.templates.views))
            .limit(popularLimit)
        : await db
            .select(baseFields)
            .from(schema.templates)
            .orderBy(desc(schema.templates.views))
            .limit(popularLimit)

      result.popular = popularItems.map(transformToTemplateData)
    }

    // Get recent items if requested (optimized with createdAt index)
    if (sections.includes('recent')) {
      const recentItems = includeState
        ? await db
            .select(fieldsWithState)
            .from(schema.templates)
            .orderBy(desc(schema.templates.createdAt))
            .limit(limit)
        : await db
            .select(baseFields)
            .from(schema.templates)
            .orderBy(desc(schema.templates.createdAt))
            .limit(limit)

      result.recent = recentItems.map(transformToTemplateData)
    }

    const duration = Date.now() - startTime

    return NextResponse.json(result)
  } catch (error: unknown) {
    const duration = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] Error fetching template items after ${duration}ms`, error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

// Helper function to transform database results to TemplateData format
function transformToTemplateData(item: DbTemplateBase | DbTemplateWithState): TemplateData {
  const baseTemplate: TemplateData = {
    id: item.id,
    workflowId: item.id, // Assuming workflowId maps to id
    name: item.name,
    shortDescription: item.shortDescription,
    longDescription: item.longDescription,
    authorName: item.authorName,
    views: item.views,
    category: item.category,
    price: item.price,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }

  // Add workflowState if it exists
  if ('state' in item && item.state) {
    baseTemplate.workflowState = item.state
  }

  return baseTemplate
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

    return createSuccessResponse(result)
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] Error in deprecated view tracking endpoint`, error)
    return createErrorResponse(`Failed to track view: ${errorMessage}`, 500)
  }
}
