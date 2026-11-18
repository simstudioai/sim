import { describe, expect, it } from 'vitest'
import { fetchTool } from '@/tools/pinecone/fetch'
import { searchTextTool } from '@/tools/pinecone/search_text'
import type { PineconeFetchParams, PineconeSearchTextParams } from '@/tools/pinecone/types'

const INDEX_HOST = 'https://example-index.svc.example.pinecone.io'

function buildUrl<P>(tool: { request: { url: unknown } }, params: P): URL {
  const url = tool.request.url as (params: P) => string
  return new URL(url(params))
}

describe('pinecone_fetch request', () => {
  it('repeats the ids query parameter once per vector id', () => {
    const url = buildUrl<PineconeFetchParams>(fetchTool, {
      indexHost: INDEX_HOST,
      ids: ['vec-1', 'vec-2'],
      namespace: 'docs',
      apiKey: 'key',
    })

    expect(url.searchParams.getAll('ids')).toEqual(['vec-1', 'vec-2'])
  })
})

describe('pinecone_search_text request', () => {
  const baseParams: PineconeSearchTextParams = {
    indexHost: INDEX_HOST,
    searchQuery: 'capital of France',
    apiKey: 'key',
  }

  it('rejects a missing namespace instead of searching a namespace named "undefined"', () => {
    expect(() => buildUrl<PineconeSearchTextParams>(searchTextTool, baseParams)).toThrow(
      /namespace is required/
    )
  })

  it('sends the rerank query as a string', () => {
    const body = searchTextTool.request.body as (
      params: PineconeSearchTextParams
    ) => Record<string, Record<string, unknown>>

    const withoutQuery = body({
      ...baseParams,
      rerank: { model: 'bge-reranker-v2-m3', rank_fields: ['chunk_text'] },
    })
    expect(withoutQuery.rerank.query).toBeUndefined()

    const withObjectQuery = body({
      ...baseParams,
      rerank: { model: 'bge-reranker-v2-m3', query: { text: 'Paris' } },
    })
    expect(withObjectQuery.rerank.query).toBe('Paris')

    const withBlankQuery = body({
      ...baseParams,
      rerank: { model: 'bge-reranker-v2-m3', query: '  ' },
    })
    expect(withBlankQuery.rerank.query).toBeUndefined()
  })
})
