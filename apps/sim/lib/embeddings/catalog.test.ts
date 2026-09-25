import { describe, expect, it } from 'vitest'
import {
  EMBEDDING_MODELS,
  getKbEligibleModels,
  getKbEmbeddingDimensions,
  KB_EMBEDDING_STORAGE_DIMENSIONS,
  resolveDimensions,
} from '@/lib/embeddings/catalog'
import { EMBEDDING_MODEL_PRICING } from '@/providers/models'

describe('embedding catalog', () => {
  it('gives every model a pricing entry so hosted-key billing cannot silently be free', () => {
    for (const [modelId, info] of Object.entries(EMBEDDING_MODELS)) {
      expect(
        EMBEDDING_MODEL_PRICING[info.pricingId],
        `missing pricing for ${modelId}`
      ).toBeDefined()
    }
  })

  it('never declares a request token budget below its own per-input ceiling', () => {
    for (const [modelId, info] of Object.entries(EMBEDDING_MODELS)) {
      if (info.maxTokensPerRequest === undefined) continue
      expect(
        info.maxTokensPerRequest,
        `${modelId} would truncate a maximal single input`
      ).toBeGreaterThanOrEqual(info.maxInputTokens)
    }
  })

  it('only marks a model KB-eligible when it can emit a storable vector width', () => {
    for (const modelId of getKbEligibleModels()) {
      const widths = getKbEmbeddingDimensions(EMBEDDING_MODELS[modelId])
      expect(
        widths,
        `${modelId} emits none of ${KB_EMBEDDING_STORAGE_DIMENSIONS.join(', ')}`
      ).not.toHaveLength(0)
    }
  })
})

describe('resolveDimensions', () => {
  const gemini = EMBEDDING_MODELS['gemini-embedding-001']
  const ada = EMBEDDING_MODELS['text-embedding-ada-002']

  it('rejects an unsupported size and names what is allowed', () => {
    expect(() => resolveDimensions(gemini, 999)).toThrow(/does not support 999/)
    expect(() => resolveDimensions(ada, 256)).toThrow(/does not support 256/)
  })
})
