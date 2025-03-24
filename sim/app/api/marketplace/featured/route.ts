import { NextRequest, NextResponse } from 'next/server'
import { desc, eq, sql } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { marketplace } from '@/db/schema'
import { CATEGORIES } from '@/app/w/marketplace/constants/categories'

const logger = createLogger('MarketplaceFeaturedAPI')

// 1 hour cache
export const revalidate = 3600

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  
  try {
    // Parse query parameters
    const url = new URL(request.url)
    const categoryParam = url.searchParams.get('category')
    const limitParam = url.searchParams.get('limit') || '6'
    const limit = parseInt(limitParam, 10)
    
    const result: {
      popular: any[]
      recent: any[]
      byCategory: Record<string, any[]>
    } = {
      popular: [],
      recent: [],
      byCategory: {}
    }

    // Get popular items (most stars)
    result.popular = await db
      .select({
        id: marketplace.id,
        workflowId: marketplace.workflowId,
        name: marketplace.name,
        description: marketplace.description,
        authorName: marketplace.authorName,
        stars: marketplace.stars,
        views: marketplace.views,
        category: marketplace.category,
        createdAt: marketplace.createdAt,
        updatedAt: marketplace.updatedAt,
      })
      .from(marketplace)
      .orderBy(desc(marketplace.stars), desc(marketplace.views))
      .limit(limit)
    
    // Get recent items (most recent first)
    result.recent = await db
      .select({
        id: marketplace.id,
        workflowId: marketplace.workflowId,
        name: marketplace.name,
        description: marketplace.description,
        authorName: marketplace.authorName,
        stars: marketplace.stars,
        views: marketplace.views,
        category: marketplace.category,
        createdAt: marketplace.createdAt,
        updatedAt: marketplace.updatedAt,
      })
      .from(marketplace)
      .orderBy(desc(marketplace.createdAt))
      .limit(limit)
    
    // If a specific category is requested
    if (categoryParam) {
      result.byCategory[categoryParam] = await db
        .select({
          id: marketplace.id,
          workflowId: marketplace.workflowId,
          name: marketplace.name,
          description: marketplace.description,
          authorName: marketplace.authorName,
          stars: marketplace.stars,
          views: marketplace.views,
          category: marketplace.category,
          createdAt: marketplace.createdAt,
          updatedAt: marketplace.updatedAt,
        })
        .from(marketplace)
        .where(eq(marketplace.category, categoryParam))
        .orderBy(desc(marketplace.stars), desc(marketplace.views))
        .limit(limit)
    } else {
      // Get items for each category
      // Using Promise.all for parallel fetching to improve performance
      await Promise.all(
        CATEGORIES.map(async (category) => {
          result.byCategory[category.value] = await db
            .select({
              id: marketplace.id,
              workflowId: marketplace.workflowId,
              name: marketplace.name,
              description: marketplace.description,
              authorName: marketplace.authorName,
              stars: marketplace.stars,
              views: marketplace.views,
              category: marketplace.category,
              createdAt: marketplace.createdAt,
              updatedAt: marketplace.updatedAt,
            })
            .from(marketplace)
            .where(eq(marketplace.category, category.value))
            .orderBy(desc(marketplace.stars), desc(marketplace.views))
            .limit(limit)
        })
      )
    }

    logger.info(`[${requestId}] Fetched featured marketplace items successfully`)
    
    return NextResponse.json(result)
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching marketplace items`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
} 