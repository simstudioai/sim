import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { executeTool } from '@/tools'

const logger = createLogger('OnlineSearchAPI')

export const dynamic = 'force-dynamic'

export async function onlineSearch(params: any) {
  const { query, num = 10, type = 'search', gl, hl } = params

  if (!query) {
    throw new Error('Query is required')
  }

  logger.info('Performing online search', { 
    query, 
    num,
    type,
    gl,
    hl
  })

  try {
    // Execute the serper_search tool
    const toolParams = {
      query,
      num,
      type,
      gl,
      hl,
      apiKey: process.env.SERPER_API_KEY || '',
    }

    const result = await executeTool('serper_search', toolParams)

    if (!result.success) {
      throw new Error(result.error || 'Search failed')
    }

    // The serper tool already formats the results properly
    return {
      success: true,
      data: {
        results: result.output.searchResults || [],
        query,
        type,
        totalResults: result.output.searchResults?.length || 0,
      },
    }
  } catch (error) {
    logger.error('Online search failed', error)
    throw error
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await onlineSearch(body)
    return NextResponse.json(result)
  } catch (error) {
    logger.error('Online search API error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to perform online search',
      },
      { status: 500 }
    )
  }
} 