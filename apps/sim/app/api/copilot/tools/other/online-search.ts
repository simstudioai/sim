import { createLogger } from '@/lib/logs/console/logger'
import { executeTool } from '@/tools'
import { BaseCopilotTool } from '../base'

interface OnlineSearchParams {
  query: string
  num?: number
  type?: string
  gl?: string
  hl?: string
}

interface OnlineSearchResult {
  results: any[]
  query: string
  type: string
  totalResults: number
}

class OnlineSearchTool extends BaseCopilotTool<OnlineSearchParams, OnlineSearchResult> {
  readonly id = 'search_online'
  readonly displayName = 'Searching online'

  protected async executeImpl(params: OnlineSearchParams): Promise<OnlineSearchResult> {
    return onlineSearch(params)
  }
}

// Export the tool instance
export const onlineSearchTool = new OnlineSearchTool()

// Implementation function
async function onlineSearch(params: OnlineSearchParams): Promise<OnlineSearchResult> {
  const logger = createLogger('OnlineSearch')
  const { query, num = 10, type = 'search', gl, hl } = params

  logger.info('Performing online search', {
    query,
    num,
    type,
    gl,
    hl,
  })

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
    results: result.output.searchResults || [],
    query,
    type,
    totalResults: result.output.searchResults?.length || 0,
  }
}
