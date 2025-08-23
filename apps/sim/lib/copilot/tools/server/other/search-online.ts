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

    // Input diagnostics (no secrets)
    const hasApiKey = Boolean(env.SERPER_API_KEY && String(env.SERPER_API_KEY).length > 0)
    logger.info('Performing online search (new runtime)', {
      queryLength: query.length,
      num,
      type,
      gl,
      hl,
      hasApiKey,
    })

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
      }
    } catch (e: any) {
      logger.error('search_online execution error', { message: e?.message })
      throw e
    }
  },
}
