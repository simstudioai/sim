/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  EMBEDDING_MODELS,
  findEmbeddingModelInfo,
  getEmbeddingModelInfo,
  getKbEligibleModels,
  getKbEmbeddingDimensions,
  getModelsForProvider,
  hasApproximateTokenCount,
  KB_EMBEDDING_STORAGE_DIMENSIONS,
  resolveDimensions,
} from '@/lib/embeddings/catalog'
import { EMBEDDING_MODEL_PRICING } from '@/providers/models'

describe('embedding catalog', () => {
  it('throws a named error for an unknown model', () => {
    expect(() => getEmbeddingModelInfo('not-a-model')).toThrow(
      'Unsupported embedding model: not-a-model'
    )
  })

  it('gives every model a pricing entry so hosted-key billing cannot silently be free', () => {
    for (const [modelId, info] of Object.entries(EMBEDDING_MODELS)) {
      expect(
        EMBEDDING_MODEL_PRICING[info.pricingId],
        `missing pricing for ${modelId}`
      ).toBeDefined()
    }
  })

  it('offers the native size among the Matryoshka options, largest first', () => {
    for (const [modelId, info] of Object.entries(EMBEDDING_MODELS)) {
      if (!info.supportedDimensions) continue
      /**
       * The native size must be selectable — it is what the block pre-selects —
       * but need not lead the list: codestral-embed defaults to 1536 and tops
       * out at 3072, so its options straddle the default.
       */
      expect(
        info.supportedDimensions.includes(info.nativeDimensions),
        `${modelId} does not offer its native size`
      ).toBe(true)
      // Descending order is what the block's dropdown renders.
      expect([...info.supportedDimensions]).toEqual(
        [...info.supportedDimensions].sort((a, b) => b - a)
      )
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

  it('resolves an ollama-prefixed model to every storable width', () => {
    const info = getEmbeddingModelInfo('ollama/nomic-embed-text')
    expect(info.provider).toBe('ollama')
    expect(getKbEmbeddingDimensions(info)).toEqual([...KB_EMBEDDING_STORAGE_DIMENSIONS])
    expect(findEmbeddingModelInfo('ollama/')).toBeUndefined()
  })

  it('keeps the KB-eligible set to the three models knowledge bases already index with', () => {
    // Widening this set changes which models KB_EMBEDDING_MODEL accepts, so it
    // is a deliberate decision rather than a side effect of adding a provider.
    expect(getKbEligibleModels().sort()).toEqual([
      'gemini-embedding-001',
      'text-embedding-3-large',
      'text-embedding-3-small',
    ])
  })

  it('groups models under the provider that actually serves them', () => {
    expect(getModelsForProvider('gemini')).toEqual(['gemini-embedding-001'])
    expect(getModelsForProvider('cohere')).toEqual(['embed-v4.0'])
    expect(getModelsForProvider('mistral')).toEqual(['mistral-embed', 'codestral-embed'])
  })
})

describe('resolveDimensions', () => {
  const gemini = EMBEDDING_MODELS['gemini-embedding-001']
  const ada = EMBEDDING_MODELS['text-embedding-ada-002']

  it('falls back to native when nothing is requested', () => {
    expect(resolveDimensions(gemini)).toBe(3072)
    expect(resolveDimensions(ada)).toBe(1536)
  })

  it('accepts a supported reduction', () => {
    expect(resolveDimensions(gemini, 768)).toBe(768)
  })

  it('rejects an unsupported size and names what is allowed', () => {
    expect(() => resolveDimensions(gemini, 999)).toThrow(/does not support 999/)
    expect(() => resolveDimensions(ada, 256)).toThrow(/does not support 256/)
  })
})

/**
 * Batching counts tokens with tiktoken, which only has encodings for OpenAI
 * models; every other id falls back to cl100k. This flag records which models
 * are counted approximately. It must not be used to shrink the ceiling —
 * truncating below a provider's declared limit drops valid content silently,
 * which is strictly worse than the visible rejection it would guard against.
 */
describe('hasApproximateTokenCount', () => {
  it('is false only for tiktoken-native models', () => {
    for (const [id, info] of Object.entries(EMBEDDING_MODELS)) {
      expect(hasApproximateTokenCount(info), id).toBe(info.tokenizerProvider !== 'openai')
    }
  })

  it('covers at least one model, so the flag stays meaningful', () => {
    const approximate = Object.values(EMBEDDING_MODELS).filter(hasApproximateTokenCount)
    expect(approximate.length).toBeGreaterThan(0)
  })
})
