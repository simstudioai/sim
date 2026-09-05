/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  inspectCapability,
  KNOWLEDGE_EMBEDDINGS_CAPABILITY,
  knowledgeEmbeddingFamily,
} from '@/lib/core/config/env-capabilities'
import {
  DEFAULT_EMBEDDING_MODEL,
  getEmbeddingModelInfo,
  getKbEligibleModels,
  getKbEmbeddingDimensions,
  KB_EMBEDDING_STORAGE_DIMENSIONS,
} from '@/lib/embeddings/catalog'
import { isKbEmbeddingModel } from '@/lib/knowledge/embedding-models'

/**
 * `knowledgeEmbeddingFamily` decides which credential the setup CLI and the
 * capability status treat as serving knowledge embeddings. It lives in
 * `@sim/deployment-config`, which cannot import the app's model catalog, so it
 * classifies model ids by shape instead. These pin the two together: a catalog
 * model whose family the classifier gets wrong would make a correctly
 * configured deployment report as unconfigured, and an incorrectly configured
 * one report as ready.
 */
describe('knowledgeEmbeddingFamily', () => {
  it('agrees with the catalog for every model a knowledge base can be created with', () => {
    for (const model of getKbEligibleModels()) {
      expect(knowledgeEmbeddingFamily({ KB_EMBEDDING_MODEL: model }), model).toBe(
        getEmbeddingModelInfo(model).provider
      )
    }
  })

  /**
   * The capability also duplicates each model's storable widths, to reject a
   * width the selected model cannot emit. A width the catalog allows but the
   * capability rejects blocks a working deployment; the reverse passes a
   * configuration the runtime silently overrides.
   */
  it('accepts exactly the widths the catalog says each model can be indexed at', () => {
    for (const model of getKbEligibleModels()) {
      const widths = getKbEmbeddingDimensions(getEmbeddingModelInfo(model))
      for (const width of KB_EMBEDDING_STORAGE_DIMENSIONS) {
        const issues = inspectCapability(KNOWLEDGE_EMBEDDINGS_CAPABILITY, {
          KB_EMBEDDING_MODEL: model,
          EMBEDDING_OUTPUT_DIMS: String(width),
          OPENAI_API_KEY: 'k',
          GEMINI_API_KEY: 'k',
        }).providers.flatMap((provider) => provider.invalidFields)
        expect(issues.includes('EMBEDDING_OUTPUT_DIMS'), `${model} @ ${width}`).toBe(
          !widths.includes(width)
        )
      }
    }
  })

  it('classifies any model on the deployment’s own Ollama by its routing prefix', () => {
    for (const model of ['ollama/nomic-embed-text', 'ollama/mxbai-embed-large:335m']) {
      expect(knowledgeEmbeddingFamily({ KB_EMBEDDING_MODEL: model }), model).toBe('ollama')
    }
  })

  /**
   * The classifier decides which credential the CLI reports as serving knowledge
   * embeddings; the runtime decides which one actually gets used. An id the
   * runtime rejects falls back to the default model, so the classifier has to
   * call it that family too — otherwise a deployment holding only the credential
   * it names passes its status check and fails every embedding call.
   */
  it('agrees with the runtime on ids the runtime does not accept', () => {
    const defaultFamily = getEmbeddingModelInfo(DEFAULT_EMBEDDING_MODEL).provider
    const rejected = [
      '',
      '   ',
      'not-a-model',
      'gemini-embedding-999',
      'Gemini-Embedding-001',
      'gemini',
      'OLLAMA/nomic-embed-text',
      'ollama/',
      'toString',
      'constructor',
    ]
    for (const model of rejected) {
      expect(isKbEmbeddingModel(model), `${model} must not be a KB model`).toBe(false)
      expect(knowledgeEmbeddingFamily({ KB_EMBEDDING_MODEL: model }), model).toBe(defaultFamily)
    }
    expect(knowledgeEmbeddingFamily({})).toBe(defaultFamily)
  })
})
