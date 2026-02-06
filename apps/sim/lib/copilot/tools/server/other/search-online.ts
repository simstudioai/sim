import { createLogger } from '@sim/logger'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { env } from '@/lib/core/config/env'
import { executeTool } from '@/tools'

interface OnlineSearchParams {
  query: string
  num?: number
  type?: string
  gl?: string
  hl?: string
}

interface SearchResult {
  title: string
  link: string
  snippet: string
  date?: string
  position?: number
}

interface SearchResponse {
  results: SearchResult[]
  query: string
  type: string
  totalResults: number
  source: 'exa' | 'serper'
}

export const searchOnlineServerTool: BaseServerTool<OnlineSearchParams, SearchResponse> = {
  name: 'search_online',
  async execute(params: OnlineSearchParams): Promise<SearchResponse> {
    const logger = createLogger('SearchOnlineServerTool')
    const { query, num = 10, type = 'search', gl, hl } = params
    if (!query || typeof query !== 'string') throw new Error('query is required')

    const hasExaApiKey = Boolean(env.EXA_API_KEY && String(env.EXA_API_KEY).length > 0)
    const hasSerperApiKey = Boolean(env.SERPER_API_KEY && String(env.SERPER_API_KEY).length > 0)

    logger.debug('Performing online search', { queryLength: query.length, num, type })

    // Try Exa first if available
    if (hasExaApiKey) {
      try {
        const exaResult = await executeTool('exa_search', {
          query,
          numResults: num,
          type: 'auto',
          apiKey: env.EXA_API_KEY ?? '',
        })

        const output = exaResult.output as { results?: Array<{ title?: string; url?: string; text?: string; summary?: string; publishedDate?: string }> } | undefined
        const exaResults = output?.results ?? []

        if (exaResult.success && exaResults.length > 0) {
          const transformedResults: SearchResult[] = exaResults.map((result, index) => ({
            title: result.title ?? '',
            link: result.url ?? '',
            snippet: result.text ?? result.summary ?? '',
            date: result.publishedDate,
            position: index + 1,
          }))

          return {
            results: transformedResults,
            query,
            type,
            totalResults: transformedResults.length,
            source: 'exa',
          }
        }

        logger.debug('exa_search returned no results, falling back to Serper')
      } catch (exaError) {
        logger.warn('exa_search failed, falling back to Serper', {
          error: exaError instanceof Error ? exaError.message : String(exaError),
        })
      }
    }

    if (!hasSerperApiKey) {
      throw new Error('No search API keys available (EXA_API_KEY or SERPER_API_KEY required)')
    }

    const toolParams = {
      query,
      num,
      type,
      gl,
      hl,
      apiKey: env.SERPER_API_KEY ?? '',
    }

    const result = await executeTool('serper_search', toolParams)
    const output = result.output as { searchResults?: SearchResult[] } | undefined
    const results = output?.searchResults ?? []

    if (!result.success) {
      const errorMsg = (result as { error?: string }).error ?? 'Search failed'
      throw new Error(errorMsg)
    }

    return {
      results,
      query,
      type,
      totalResults: results.length,
      source: 'serper',
    }
  },
}
