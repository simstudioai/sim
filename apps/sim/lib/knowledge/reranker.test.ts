/**
 * @vitest-environment node
 */
import { setupGlobalFetchMock } from '@sim/testing/mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import { rerank } from '@/lib/knowledge/reranker'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const envSnapshot = { ...env }

describe('Knowledge reranker model boundary', () => {
  beforeEach(() => {
    setupGlobalFetchMock({
      json: { results: [{ index: 0, relevance_score: 0.9 }] },
    })
    env.COHERE_API_KEY = 'cohere-key'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of Object.keys(env)) delete (env as Record<string, unknown>)[key]
    Object.assign(env, envSnapshot)
  })

  it('projects query and documents at egress while returning the original item', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'encrypted-token' },
    ])
    registry.recordResolved('TOKEN', 'secret-value')
    const item = { id: 'chunk-1', text: 'stored secret-value content' }

    const result = await runWithKnowledgeModelInputProvenance(registry, () =>
      rerank('find secret-value', [item], {
        model: 'rerank-v4.0-fast',
        topN: 1,
      })
    )

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://api.cohere.com/v2/rerank',
      expect.objectContaining({
        body: JSON.stringify({
          model: 'rerank-v4.0-fast',
          query: 'find {{TOKEN}}',
          documents: ['stored {{TOKEN}} content'],
          top_n: 1,
        }),
      })
    )
    expect(result.results[0]?.item).toBe(item)
    expect(result.results[0]?.item.text).toBe('stored secret-value content')
  })
})
