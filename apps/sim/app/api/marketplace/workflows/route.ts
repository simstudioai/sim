import { desc, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { CATEGORIES } from '@/app/workspace/[workspaceId]/marketplace/constants/categories'
import { db } from '@/db'
import { marketplace } from '@/db/schema'

const logger = createLogger('MarketplaceWorkflowsAPI')

// Cache for 1 minute but can be revalidated on-demand
export const revalidate = 60

/**
 * Consolidated API endpoint for marketplace workflows
 *
 * Supports:
 * - Getting featured/popular/recent workflows
 * - Getting workflows by category
 * - Getting workflow state
 * - Getting workflow details
 * - Incrementing view counts
 *
 * Query parameters:
 * - section: 'popular', 'recent', 'byCategory', or specific category name
 * - limit: Maximum number of items to return per section (default: 6)
 * - includeState: Whether to include workflow state in the response (default: false)
 * - workflowId: Specific workflow ID to fetch details for
 * - marketplaceId: Specific marketplace entry ID to fetch details for
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
    const marketplaceId = url.searchParams.get('marketplaceId')

    // Handle single workflow request first (by workflow ID)
    if (workflowId) {
      let marketplaceEntry

      if (includeState) {
        // Query with state included
        marketplaceEntry = await db
          .select({
            id: marketplace.id,
            workflowId: marketplace.workflowId,
            name: marketplace.name,
            description: marketplace.description,
            authorId: marketplace.authorId,
            authorName: marketplace.authorName,
            state: marketplace.state,
            views: marketplace.views,
            category: marketplace.category,
            createdAt: marketplace.createdAt,
            updatedAt: marketplace.updatedAt,
          })
          .from(marketplace)
          .where(eq(marketplace.workflowId, workflowId))
          .limit(1)
          .then((rows) => rows[0])
      } else {
        // Query without state
        marketplaceEntry = await db
          .select({
            id: marketplace.id,
            workflowId: marketplace.workflowId,
            name: marketplace.name,
            description: marketplace.description,
            authorId: marketplace.authorId,
            authorName: marketplace.authorName,
            views: marketplace.views,
            category: marketplace.category,
            createdAt: marketplace.createdAt,
            updatedAt: marketplace.updatedAt,
          })
          .from(marketplace)
          .where(eq(marketplace.workflowId, workflowId))
          .limit(1)
          .then((rows) => rows[0])
      }

      if (!marketplaceEntry) {
        logger.warn(`[${requestId}] No marketplace entry found for workflow: ${workflowId}`)
        return createErrorResponse('Workflow not found in marketplace', 404)
      }

      // Transform response if state was requested
      const responseData =
        includeState && 'state' in marketplaceEntry
          ? {
              ...marketplaceEntry,
              workflowState: marketplaceEntry.state,
              state: undefined,
            }
          : marketplaceEntry

      logger.info(`[${requestId}] Retrieved marketplace data for workflow: ${workflowId}`)
      return createSuccessResponse(responseData)
    }

    // Handle single marketplace entry request (by marketplace ID)
    if (marketplaceId) {
      let marketplaceEntry

      if (includeState) {
        // Query with state included
        marketplaceEntry = await db
          .select({
            id: marketplace.id,
            workflowId: marketplace.workflowId,
            name: marketplace.name,
            description: marketplace.description,
            authorId: marketplace.authorId,
            authorName: marketplace.authorName,
            state: marketplace.state,
            views: marketplace.views,
            category: marketplace.category,
            createdAt: marketplace.createdAt,
            updatedAt: marketplace.updatedAt,
          })
          .from(marketplace)
          .where(eq(marketplace.id, marketplaceId))
          .limit(1)
          .then((rows) => rows[0])
      } else {
        // Query without state
        marketplaceEntry = await db
          .select({
            id: marketplace.id,
            workflowId: marketplace.workflowId,
            name: marketplace.name,
            description: marketplace.description,
            authorId: marketplace.authorId,
            authorName: marketplace.authorName,
            views: marketplace.views,
            category: marketplace.category,
            createdAt: marketplace.createdAt,
            updatedAt: marketplace.updatedAt,
          })
          .from(marketplace)
          .where(eq(marketplace.id, marketplaceId))
          .limit(1)
          .then((rows) => rows[0])
      }

      if (!marketplaceEntry) {
        logger.warn(`[${requestId}] No marketplace entry found with ID: ${marketplaceId}`)
        return createErrorResponse('Marketplace entry not found', 404)
      }

      // Transform response if state was requested
      const responseData =
        includeState && 'state' in marketplaceEntry
          ? {
              ...marketplaceEntry,
              workflowState: marketplaceEntry.state,
              state: undefined,
            }
          : marketplaceEntry

      logger.info(`[${requestId}] Retrieved marketplace entry: ${marketplaceId}`)
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
      id: marketplace.id,
      workflowId: marketplace.workflowId,
      name: marketplace.name,
      description: marketplace.description,
      authorName: marketplace.authorName,
      views: marketplace.views,
      category: marketplace.category,
      createdAt: marketplace.createdAt,
      updatedAt: marketplace.updatedAt,
    }

    // Add state if requested
    const selectFields = includeState ? { ...baseFields, state: marketplace.state } : baseFields

    // Determine which sections to fetch
    const sections = sectionParam ? sectionParam.split(',') : ['popular', 'recent', 'byCategory']

    // Get popular items if requested
    if (sections.includes('popular')) {
      result.popular = await db
        .select(selectFields)
        .from(marketplace)
        .orderBy(desc(marketplace.views))
        .limit(limit)
    }

    // Get recent items if requested
    if (sections.includes('recent')) {
      result.recent = await db
        .select(selectFields)
        .from(marketplace)
        .orderBy(desc(marketplace.createdAt))
        .limit(limit)
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
            .from(marketplace)
            .where(eq(marketplace.category, categoryValue))
            .orderBy(desc(marketplace.views))
            .limit(limit)

          // Always add the category to the result, even if empty
          result.byCategory[categoryValue] = categoryItems
          logger.info(
            `[${requestId}] Category ${categoryValue}: found ${categoryItems.length} items`
          )
        })
      )
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

    logger.info(`[${requestId}] Fetched marketplace items${includeState ? ' with state' : ''}`)
    return NextResponse.json(result)
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching marketplace items`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST handler for incrementing view counts
 *
 * Request body:
 * - id: Marketplace entry ID to increment view count for
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const { id } = body

    if (!id) {
      return createErrorResponse('Marketplace ID is required', 400)
    }

    // Find the marketplace entry
    const marketplaceEntry = await db
      .select({
        id: marketplace.id,
      })
      .from(marketplace)
      .where(eq(marketplace.id, id))
      .limit(1)
      .then((rows) => rows[0])

    if (!marketplaceEntry) {
      logger.warn(`[${requestId}] No marketplace entry found with ID: ${id}`)
      return createErrorResponse('Marketplace entry not found', 404)
    }

    // Increment the view count
    await db
      .update(marketplace)
      .set({
        views: sql`${marketplace.views} + 1`,
      })
      .where(eq(marketplace.id, id))

    logger.info(`[${requestId}] Incremented view count for marketplace entry: ${id}`)

    return createSuccessResponse({
      success: true,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error incrementing view count`, error)
    return createErrorResponse(`Failed to track view: ${error.message}`, 500)
  }
}
