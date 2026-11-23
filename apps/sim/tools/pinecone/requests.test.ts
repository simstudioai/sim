import { describe, expect, it } from 'vitest'
import { createLLMToolSchema } from '@/tools/params'
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

  it('fetches a single plain ID typed on the canvas, which is not JSON', () => {
    const params = { indexHost: INDEX_HOST, namespace: 'docs', apiKey: 'key' }
    const plain = buildUrl<PineconeFetchParams>(fetchTool, {
      ...params,
      ids: ' vec-1 ' as unknown as string[],
    })
    expect(plain.searchParams.getAll('ids')).toEqual(['vec-1'])

    const jsonArray = buildUrl<PineconeFetchParams>(fetchTool, {
      ...params,
      ids: '["vec-1", "vec-2"]' as unknown as string[],
    })
    expect(jsonArray.searchParams.getAll('ids')).toEqual(['vec-1', 'vec-2'])

    const numericLooking = buildUrl<PineconeFetchParams>(fetchTool, {
      ...params,
      ids: '1e3' as unknown as string[],
    })
    expect(numericLooking.searchParams.getAll('ids')).toEqual(['1e3'])
  })
})

describe('pinecone_search_text request', () => {
  const baseParams: PineconeSearchTextParams = {
    indexHost: INDEX_HOST,
    namespace: 'docs',
    searchQuery: 'capital of France',
    apiKey: 'key',
  }

  it('rejects a missing namespace instead of searching a namespace named "undefined"', () => {
    const { namespace: _omitted, ...withoutNamespace } = baseParams
    const untyped = withoutNamespace as PineconeSearchTextParams
    expect(() => buildUrl<PineconeSearchTextParams>(searchTextTool, untyped)).toThrow(
      /namespace is required/
    )
  })

  it('tells an agent the namespace is required, since the search URL cannot be built without it', async () => {
    const { schema } = await createLLMToolSchema(searchTextTool, {})
    expect(schema.required).toContain('namespace')
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
      rerank: {
        model: 'bge-reranker-v2-m3',
        rank_fields: ['chunk_text'],
        query: { text: 'Paris' },
      },
    })
    expect(withObjectQuery.rerank.query).toBe('Paris')

    const withBlankQuery = body({
      ...baseParams,
      rerank: { model: 'bge-reranker-v2-m3', rank_fields: ['chunk_text'], query: '  ' },
    })
    expect(withBlankQuery.rerank.query).toBeUndefined()
  })
})
