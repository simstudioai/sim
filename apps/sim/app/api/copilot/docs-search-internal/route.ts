import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('DocsSearchInternalAPI')

export async function docsSearchInternal(params: any) {
  const { query, topK = 10 } = params

  if (!query) {
    throw new Error('Query is required')
  }

  logger.info('Executing docs search for copilot', { 
    query, 
    topK,
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
    throw new Error('Documentation search failed')
  }

  const searchResults = await response.json()

  return {
    success: true,
    data: {
      results: searchResults.results || [],
      query,
      totalResults: searchResults.totalResults || 0,
    },
  }
} 