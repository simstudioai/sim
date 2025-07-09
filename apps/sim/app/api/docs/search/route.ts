import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { searchDocumentation } from '@/lib/copilot/service'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('DocsSearchAPI')

const SearchSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  topK: z.number().min(1).max(20).default(5),
})

/**
 * POST /api/docs/search
 * Search documentation for copilot tools
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const body = await req.json()
    const { query, topK } = SearchSchema.parse(body)

    logger.info(`[${requestId}] Documentation search request: "${query}"`, { topK })

    const results = await searchDocumentation(query, { topK })

    logger.info(`[${requestId}] Found ${results.length} documentation results`, { query })

    return NextResponse.json({
      success: true,
      results,
      query,
      totalResults: results.length,
      metadata: {
        requestId,
        query,
        topK,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Documentation search error:`, error)
    return NextResponse.json(
      { 
        error: 'Failed to search documentation',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 
      { status: 500 }
    )
  }
}
