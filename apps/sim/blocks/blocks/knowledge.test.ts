import { describe, expect, it } from 'vitest'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'
import { knowledgeSearchTool } from '@/tools/knowledge/search'

/**
 * A search response with billing attached, shaped like `POST /api/knowledge/search`
 * answers it. `transformResponse` lifts `tokens` and `model` out of `cost` onto the
 * output, which is why the block has to declare all three.
 */
function billedSearchResponse(): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        results: [],
        query: 'refund policy',
        totalResults: 0,
        cost: {
          input: 0.00001,
          output: 0,
          total: 0.00001,
          tokens: { prompt: 3, completion: 0, total: 3 },
          model: 'text-embedding-3-small',
          pricing: { input: 0.02, output: 0 },
        },
      },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

describe('Knowledge block outputs', () => {
  it('declares every top-level key the search tool emits, so `blocks get knowledge` is complete', async () => {
    const transformed = await knowledgeSearchTool.transformResponse!(billedSearchResponse(), {})

    const emitted = Object.keys(transformed.output).sort()
    expect(emitted).toEqual(['cost', 'model', 'query', 'results', 'tokens', 'totalResults'])
    for (const key of emitted) {
      expect(KnowledgeBlock.outputs[key], `outputs.${key} is undeclared`).toBeDefined()
    }
  })

  it('describes the billing outputs', () => {
    expect(KnowledgeBlock.outputs.cost).toMatchObject({ type: 'json' })
    expect(KnowledgeBlock.outputs.tokens).toMatchObject({ type: 'json' })
    expect(KnowledgeBlock.outputs.model).toMatchObject({ type: 'string' })
    for (const key of ['cost', 'tokens', 'model'] as const) {
      const definition = KnowledgeBlock.outputs[key] as { description?: string }
      expect(definition.description, `outputs.${key} needs a description`).toBeTruthy()
    }
  })
})
