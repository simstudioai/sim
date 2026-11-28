import { describe, expect, it } from 'vitest'
import { voyageaiContextualizedEmbeddingsTool } from '@/tools/voyageai/contextualized_embeddings'
import { voyageaiRerankTool } from '@/tools/voyageai/rerank'

function bodyOf<P>(tool: { request: { body?: (params: P) => unknown } }, params: P) {
  return tool.request.body?.(params)
}

describe('voyageai_contextualized_embeddings', () => {
  const base = { apiKey: 'pa-test', model: 'voyage-context-4', inputType: 'document' as const }
  const bodyFor = (params: Record<string, unknown>) =>
    bodyOf(voyageaiContextualizedEmbeddingsTool, params as never)

  it('lets Voyage chunk documents at the full 32,000-token window', () => {
    const documents = ['first document text', 'second document text']
    const expected = { inputs: documents, enable_auto_chunking: true, chunk_size: 32_000 }
    expect(bodyFor({ ...base, input: documents })).toMatchObject(expected)
    expect(bodyFor({ ...base, input: JSON.stringify(documents) })).toMatchObject(expected)
  })

  it('rejects documents given as pre-cut chunk lists, which Voyage refuses with auto-chunking', () => {
    expect(() => bodyFor({ ...base, input: [['intro', 'body'], ['other']] })).toThrow(
      /one non-empty text/
    )
  })

  it('never auto-chunks queries, which Voyage rejects', () => {
    const query = { ...base, inputType: 'query' as const }
    for (const input of [['a query'], [['a query']]]) {
      const body = bodyFor({ ...query, input }) as Record<string, unknown>
      expect(body).toMatchObject({ input_type: 'query', inputs: input })
      expect(body).not.toHaveProperty('enable_auto_chunking')
      expect(body).not.toHaveProperty('chunk_size')
    }
  })

  it('requires the model and the input type to be named', () => {
    expect(() => bodyFor({ apiKey: 'pa-test', inputType: 'document', input: ['a'] })).toThrow(
      /Model is required/
    )
    expect(() => bodyFor({ apiKey: 'pa-test', model: 'voyage-context-4', input: ['a'] })).toThrow(
      /Input type is required/
    )
    expect(() =>
      bodyOf(voyageaiRerankTool, { apiKey: 'pa-test', query: 'q', documents: ['a'] })
    ).toThrow(/Model is required/)
  })

  it('restores document and chunk order from the response indexes', async () => {
    const response = new Response(
      JSON.stringify({
        data: [
          { index: 1, data: [{ index: 0, embedding: [3], text: 'c' }] },
          {
            index: 0,
            data: [
              { index: 1, embedding: [2], text: 'b' },
              { index: 0, embedding: [1], text: 'a' },
            ],
          },
        ],
        model: 'voyage-context-4',
        usage: { total_tokens: 9 },
      })
    )
    const result = await voyageaiContextualizedEmbeddingsTool.transformResponse?.(response)
    expect(result?.output).toMatchObject({
      embeddings: [[[1], [2]], [[3]]],
      chunks: [['a', 'b'], ['c']],
      dimensions: 1,
      totalTokens: 9,
    })
  })
})

describe('voyageai_rerank', () => {
  it('bills by the model Voyage reports and fails closed on an unpriced one', () => {
    const getCost = voyageaiRerankTool.hosting?.pricing
    if (getCost?.type !== 'custom') throw new Error('rerank pricing must be custom')
    const priced = getCost.getCost({}, { model: 'rerank-3-lite', totalTokens: 1_000_000 })
    expect(priced).toMatchObject({ cost: 0.02 })
    expect(() => getCost.getCost({}, { model: 'rerank-0', totalTokens: 1 })).toThrow(
      /No pricing configured/
    )
  })
})
