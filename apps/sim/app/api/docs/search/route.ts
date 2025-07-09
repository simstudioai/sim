import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { searchDocumentation } from '@/lib/copilot/service'

const logger = createLogger('DocsSearchAPI')

export async function POST(request: NextRequest) {
  try {
    const { query, topK = 5 } = await request.json()

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    logger.info('Executing documentation search', { query, topK })

    const results = await searchDocumentation(query, { topK })

    logger.info(`Found ${results.length} documentation results`, { query })

    return NextResponse.json({
      success: true,
      results,
      query,
      totalResults: results.length,
    })
  } catch (error) {
    logger.error('Documentation search API failed', error)
    return NextResponse.json(
      {
        success: false,
        error: `Documentation search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
} 