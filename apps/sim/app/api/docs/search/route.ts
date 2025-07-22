import { type NextRequest, NextResponse } from 'next/server'
import { searchDocumentation } from '@/lib/copilot/service'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('DocsSearchAPI')

// Request and response type definitions
interface DocsSearchRequest {
  query: string
  topK?: number
}

interface DocsSearchResult {
  id: number
  title: string
  url: string
  content: string
  similarity: number
}

interface DocsSearchSuccessResponse {
  success: true
  results: DocsSearchResult[]
  query: string
  totalResults: number
  searchTime?: number
}

interface DocsSearchErrorResponse {
  success: false
  error: string
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<DocsSearchSuccessResponse | DocsSearchErrorResponse>> {
  try {
    const requestBody: DocsSearchRequest = await request.json()
    const { query, topK = 10 } = requestBody

    if (!query) {
      const errorResponse: DocsSearchErrorResponse = {
        success: false,
        error: 'Query is required',
      }
      return NextResponse.json(errorResponse, { status: 400 })
    }

    logger.info('Executing documentation search', { query, topK })

    const startTime = Date.now()
    const results = await searchDocumentation(query, { topK })
    const searchTime = Date.now() - startTime

    logger.info(`Found ${results.length} documentation results`, { query })

    const successResponse: DocsSearchSuccessResponse = {
      success: true,
      results,
      query,
      totalResults: results.length,
      searchTime,
    }

    return NextResponse.json(successResponse)
  } catch (error) {
    logger.error('Documentation search API failed', error)

    const errorResponse: DocsSearchErrorResponse = {
      success: false,
      error: `Documentation search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }

    return NextResponse.json(errorResponse, { status: 500 })
  }
}
