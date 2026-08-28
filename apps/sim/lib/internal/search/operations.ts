import { isRecordLike } from '@sim/utils/object'
import { SEARCH_TOOL_COST } from '@/lib/billing/constants'
import { env } from '@/lib/core/config/env'
import type { SearchResponse } from '@/tools/search/types'

interface SearchOperationInput {
  query: string
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export async function executeSearchOperation(
  input: SearchOperationInput,
  signal?: AbortSignal
): Promise<SearchResponse['output']> {
  signal?.throwIfAborted()
  const exaApiKey = env.EXA_API_KEY
  if (!exaApiKey) throw new Error('Search service not configured')

  const { executeTool } = await import('@/tools')
  const result = await executeTool(
    'exa_search',
    {
      query: input.query,
      type: 'auto',
      useAutoprompt: true,
      highlights: true,
      apiKey: exaApiKey,
    },
    { signal }
  )
  signal?.throwIfAborted()
  if (!result.success) throw new Error(result.error || 'Search failed')

  const rawResults =
    isRecordLike(result.output) && Array.isArray(result.output.results) ? result.output.results : []
  const results = rawResults.map((rawResult, index) => {
    const resultRecord = isRecordLike(rawResult) ? rawResult : {}
    const highlights = Array.isArray(resultRecord.highlights)
      ? resultRecord.highlights.filter((value): value is string => typeof value === 'string')
      : []
    return {
      title: optionalString(resultRecord.title) ?? '',
      link: optionalString(resultRecord.url) ?? '',
      snippet: highlights.join(' ... '),
      ...(optionalString(resultRecord.publishedDate)
        ? { date: optionalString(resultRecord.publishedDate) }
        : {}),
      position: index + 1,
    }
  })

  return {
    results,
    query: input.query,
    totalResults: results.length,
    source: 'exa',
    cost: {
      input: 0,
      output: 0,
      total: SEARCH_TOOL_COST,
      tokens: { input: 0, output: 0, total: 0 },
      model: 'search-exa',
      pricing: {
        input: 0,
        cachedInput: 0,
        output: 0,
        updatedAt: new Date().toISOString(),
      },
    },
  }
}
