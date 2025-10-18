import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { executeTool } from '@/tools'

interface OnlineSearchParams {
  query: string
  num?: number
  type?: string
  gl?: string
  hl?: string
}

export const searchOnlineServerTool: BaseServerTool<OnlineSearchParams, any> = {
  name: 'search_online',
  async execute(params: OnlineSearchParams): Promise<any> {
    const logger = createLogger('SearchOnlineServerTool')
    const { query, num = 10, type = 'search', gl, hl } = params
    if (!query || typeof query !== 'string') throw new Error('query is required')

    // Check which API keys are available
    const hasExaApiKey = Boolean(env.EXA_API_KEY && String(env.EXA_API_KEY).length > 0)
    const hasSerperApiKey = Boolean(env.SERPER_API_KEY && String(env.SERPER_API_KEY).length > 0)

    logger.info('Performing online search', {
      queryLength: query.length,
      num,
      type,
      gl,
      hl,
      hasExaApiKey,
      hasSerperApiKey,
    })

    // Try Exa first if available
    if (hasExaApiKey) {
      try {
        logger.debug('Attempting exa_search', { num })
        const exaResult = await executeTool('exa_search', {
          query,
          numResults: num,
          type: 'auto',
          apiKey: env.EXA_API_KEY || '',
        })

        const exaResults = (exaResult as any)?.output?.results || []
        const count = Array.isArray(exaResults) ? exaResults.length : 0
        const firstTitle = count > 0 ? String(exaResults[0]?.title || '') : undefined

        logger.info('exa_search completed', {
          success: exaResult.success,
          resultsCount: count,
          firstTitlePreview: firstTitle?.slice(0, 120),
        })

        if (exaResult.success && count > 0) {
          // Transform Exa results to match expected format
          const transformedResults = exaResults.map((result: any) => ({
            title: result.title || '',
            link: result.url || '',
            snippet: result.text || result.summary || '',
            date: result.publishedDate,
            position: exaResults.indexOf(result) + 1,
          }))

          return {
            results: transformedResults,
            query,
            type,
            totalResults: count,
            source: 'exa',
          }
        }

        logger.warn('exa_search returned no results, falling back to Serper', {
          queryLength: query.length,
        })
      } catch (exaError: any) {
        logger.warn('exa_search failed, falling back to Serper', {
          error: exaError?.message,
        })
      }
    }

    // Fall back to Serper if Exa failed or wasn't available
    if (!hasSerperApiKey) {
      throw new Error('No search API keys available (EXA_API_KEY or SERPER_API_KEY required)')
    }

    const toolParams = {
      query,
      num,
      type,
      gl,
      hl,
      apiKey: env.SERPER_API_KEY || '',
    }

    try {
      logger.debug('Calling serper_search tool', { type, num, gl, hl })
      const result = await executeTool('serper_search', toolParams)
      const results = (result as any)?.output?.searchResults || []
      const count = Array.isArray(results) ? results.length : 0
      const firstTitle = count > 0 ? String(results[0]?.title || '') : undefined

      logger.info('serper_search completed', {
        success: result.success,
        resultsCount: count,
        firstTitlePreview: firstTitle?.slice(0, 120),
      })

      if (!result.success) {
        logger.error('serper_search failed', { error: (result as any)?.error })
        throw new Error((result as any)?.error || 'Search failed')
      }

      if (count === 0) {
        logger.warn('serper_search returned no results', { queryLength: query.length })
      }

      return {
        results,
        query,
        type,
        totalResults: count,
        source: 'serper',
      }
    } catch (e: any) {
      logger.error('search_online execution error', { message: e?.message })
      throw e
    }
  },
}
