import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('DocsSearchInternalAPI')

export async function POST(request: NextRequest) {
  try {
    // Check authentication (session, API key, or internal JWT)
    const authResult = await checkHybridAuth(request)
    if (!authResult.success) {
      return NextResponse.json(
        { success: false, error: authResult.error },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { query, topK = 10 } = body

    if (!query) {
      return NextResponse.json(
        { success: false, error: 'Query is required' },
        { status: 400 }
      )
    }

    logger.info('Executing docs search for copilot', { 
      query, 
      topK,
      authType: authResult.authType,
      userId: authResult.userId
    })

    // Forward the request to the existing docs search endpoint
    const docsSearchUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/docs/search`
    
    const response = await fetch(docsSearchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, topK }),
    })

    if (!response.ok) {
      logger.error('Docs search API failed', { 
        status: response.status, 
        statusText: response.statusText 
      })
      return NextResponse.json(
        { success: false, error: 'Documentation search failed' },
        { status: response.status }
      )
    }

    const searchResults = await response.json()

    return NextResponse.json({
      success: true,
      data: {
        results: searchResults.results || [],
        query,
        totalResults: searchResults.totalResults || 0,
      },
    })
  } catch (error) {
    logger.error('Documentation search API failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: `Documentation search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
} 