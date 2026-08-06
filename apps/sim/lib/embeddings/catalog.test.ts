/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { splitByItemLimit } from '@/lib/embeddings/batching'
import {
  EMBEDDING_MODELS,
  getEmbeddingModelInfo,
  getKbEligibleModels,
  getModelsForProvider,
  KB_EMBEDDING_DIMENSIONS,
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

  it('lists native dimensions first in every Matryoshka list', () => {
    for (const [modelId, info] of Object.entries(EMBEDDING_MODELS)) {
      if (!info.supportedDimensions) continue
      expect(info.supportedDimensions[0], `${modelId} native size is not first`).toBe(
        info.nativeDimensions
      )
      // Descending order is what the block's dropdown renders.
      expect([...info.supportedDimensions]).toEqual(
        [...info.supportedDimensions].sort((a, b) => b - a)
      )
    }
  })

  it('only marks a model KB-eligible when it can emit the fixed KB vector width', () => {
    for (const modelId of getKbEligibleModels()) {
      const info = EMBEDDING_MODELS[modelId]
      const canEmit =
        info.nativeDimensions === KB_EMBEDDING_DIMENSIONS ||
        info.supportedDimensions?.includes(KB_EMBEDDING_DIMENSIONS)
      expect(canEmit, `${modelId} cannot emit ${KB_EMBEDDING_DIMENSIONS} dimensions`).toBe(true)
    }
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

describe('splitByItemLimit', () => {
  it('returns a single batch when under the cap', () => {
    expect(splitByItemLimit([1, 2, 3], 96)).toEqual([[1, 2, 3]])
  })

  it("chunks to Gemini's 100-item cap", () => {
    const items = Array.from({ length: 250 }, (_, i) => i)
    const batches = splitByItemLimit(items, 100)
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50])
    expect(batches.flat()).toEqual(items)
  })

  it("chunks to Cohere's 96-item cap", () => {
    const items = Array.from({ length: 200 }, (_, i) => i)
    const batches = splitByItemLimit(items, 96)
    expect(batches.map((b) => b.length)).toEqual([96, 96, 8])
    expect(batches.flat()).toEqual(items)
  })
})
