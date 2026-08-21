import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { WebSearch } from '@/lib/copilot/generated/tool-catalog-v1'
import { projectToolErrorMessageForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { env } from '@/lib/core/config/env'
import { OrchestrationError } from '@/lib/core/orchestration/types'
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
  name: WebSearch.id,
  async execute(params: OnlineSearchParams, context?: ServerToolContext): Promise<SearchResponse> {
    const logger = createLogger('SearchOnlineServerTool')
    const { query, num = 10, type = 'search', gl, hl } = params
    if (!query || typeof query !== 'string')
      throw new OrchestrationError('validation', 'query is required')

    const hasExaApiKey = Boolean(env.EXA_API_KEY && String(env.EXA_API_KEY).length > 0)
    const hasSerperApiKey = Boolean(env.SERPER_API_KEY && String(env.SERPER_API_KEY).length > 0)

    logger.debug('Performing online search', { queryLength: query.length, num, type })

    // Try Exa first if available
    if (hasExaApiKey) {
      try {
        const exaResult = await executeTool(
          'exa_search',
          {
            query,
            numResults: num,
            type: 'auto',
            // Exa omits page content unless it is requested, which would leave
            // every snippet empty. Highlights keep the payload small.
            highlights: true,
            apiKey: env.EXA_API_KEY ?? '',
          },
          { resolvedSecretTraceRegistry: context?.resolvedSecretTraceRegistry }
        )

        const output = exaResult.output as
          | {
              results?: Array<{
                title?: string
                url?: string
                text?: string
                summary?: string
                highlights?: string[]
                publishedDate?: string
              }>
            }
          | undefined
        const exaResults = output?.results ?? []

        if (exaResult.success && exaResults.length > 0) {
          const transformedResults: SearchResult[] = exaResults.map((result, index) => ({
            title: result.title ?? '',
            link: result.url ?? '',
            snippet: result.highlights?.join(' ') || result.text || result.summary || '',
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
        const errorMessage = toError(exaError).message
        logger.warn('exa_search failed, falling back to Serper', {
          error: projectToolErrorMessageForCopilot(
            errorMessage,
            context?.resolvedSecretTraceRegistry
          ),
        })
      }
    }

    if (!hasSerperApiKey) {
      throw new OrchestrationError(
        'forbidden',
        'Web search is not configured on this Sim deployment and cannot be enabled from a tool. Answer from the workspace instead (grep/glob/read, search_sim_docs) or tell the user web search is unavailable.'
      )
    }

    const toolParams = {
      query,
      num,
      type,
      gl,
      hl,
      apiKey: env.SERPER_API_KEY ?? '',
    }

    const result = await executeTool('serper_search', toolParams, {
      resolvedSecretTraceRegistry: context?.resolvedSecretTraceRegistry,
    })
    const output = result.output as { searchResults?: SearchResult[] } | undefined
    const results = output?.searchResults ?? []

    if (!result.success) {
      const errorMsg = (result as { error?: string }).error ?? 'Search failed'
      // Classified so the provider's actual failure (rate limit, bad query)
      // reaches the model instead of the generic system-error mask.
      throw new OrchestrationError('conflict', errorMsg)
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
