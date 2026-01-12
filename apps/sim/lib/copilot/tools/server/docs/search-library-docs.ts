import { createLogger } from '@sim/logger'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { env } from '@/lib/core/config/env'
import { executeTool } from '@/tools'

interface SearchLibraryDocsParams {
  library_name: string
  query: string
  version?: string
}

interface SearchLibraryDocsResult {
  results: Array<{
    title: string
    link: string
    snippet: string
    position?: number
  }>
  query: string
  library: string
  version?: string
  totalResults: number
}

export const searchLibraryDocsServerTool: BaseServerTool<
  SearchLibraryDocsParams,
  SearchLibraryDocsResult
> = {
  name: 'search_library_docs',
  async execute(params: SearchLibraryDocsParams): Promise<SearchLibraryDocsResult> {
    const logger = createLogger('SearchLibraryDocsServerTool')
    const { library_name, query, version } = params

    if (!library_name || typeof library_name !== 'string') {
      throw new Error('library_name is required')
    }
    if (!query || typeof query !== 'string') {
      throw new Error('query is required')
    }

    // Build a search query that targets the library's documentation
    const searchQuery = version
      ? `${library_name} ${version} documentation ${query}`
      : `${library_name} documentation ${query}`

    logger.info('Searching library documentation', {
      library: library_name,
      query,
      version,
      fullSearchQuery: searchQuery,
    })

    // Check which API keys are available
    const hasExaApiKey = Boolean(env.EXA_API_KEY && String(env.EXA_API_KEY).length > 0)
    const hasSerperApiKey = Boolean(env.SERPER_API_KEY && String(env.SERPER_API_KEY).length > 0)

    // Try Exa first if available (better for documentation searches)
    if (hasExaApiKey) {
      try {
        logger.debug('Attempting exa_search for library docs', { library: library_name })
        const exaResult = await executeTool('exa_search', {
          query: searchQuery,
          numResults: 10,
          type: 'auto',
          apiKey: env.EXA_API_KEY || '',
        })

        const exaResults = (exaResult as any)?.output?.results || []
        const count = Array.isArray(exaResults) ? exaResults.length : 0

        logger.info('exa_search for library docs completed', {
          success: exaResult.success,
          resultsCount: count,
          library: library_name,
        })

        if (exaResult.success && count > 0) {
          const transformedResults = exaResults.map((result: any, idx: number) => ({
            title: result.title || '',
            link: result.url || '',
            snippet: result.text || result.summary || '',
            position: idx + 1,
          }))

          return {
            results: transformedResults,
            query,
            library: library_name,
            version,
            totalResults: count,
          }
        }

        logger.warn('exa_search returned no results for library docs, falling back to Serper', {
          library: library_name,
        })
      } catch (exaError: any) {
        logger.warn('exa_search failed for library docs, falling back to Serper', {
          error: exaError?.message,
          library: library_name,
        })
      }
    }

    // Fall back to Serper if Exa failed or wasn't available
    if (!hasSerperApiKey) {
      throw new Error('No search API keys available (EXA_API_KEY or SERPER_API_KEY required)')
    }

    try {
      logger.debug('Calling serper_search for library docs', { library: library_name })
      const result = await executeTool('serper_search', {
        query: searchQuery,
        num: 10,
        type: 'search',
        apiKey: env.SERPER_API_KEY || '',
      })

      const results = (result as any)?.output?.searchResults || []
      const count = Array.isArray(results) ? results.length : 0

      logger.info('serper_search for library docs completed', {
        success: result.success,
        resultsCount: count,
        library: library_name,
      })

      if (!result.success) {
        logger.error('serper_search failed for library docs', { error: (result as any)?.error })
        throw new Error((result as any)?.error || 'Library documentation search failed')
      }

      // Transform serper results to match expected format
      const transformedResults = results.map((result: any, idx: number) => ({
        title: result.title || '',
        link: result.link || '',
        snippet: result.snippet || '',
        position: idx + 1,
      }))

      return {
        results: transformedResults,
        query,
        library: library_name,
        version,
        totalResults: count,
      }
    } catch (e: any) {
      logger.error('search_library_docs execution error', {
        message: e?.message,
        library: library_name,
      })
      throw e
    }
  },
}
