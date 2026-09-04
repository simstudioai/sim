/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { knowledgeEmbeddingFamily } from '@/lib/core/config/env-capabilities'
import {
  DEFAULT_EMBEDDING_MODEL,
  getEmbeddingModelInfo,
  getKbEligibleModels,
} from '@/lib/embeddings/catalog'

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

  it('classifies any model on the deployment’s own Ollama by its routing prefix', () => {
    for (const model of ['ollama/nomic-embed-text', 'ollama/mxbai-embed-large:335m', 'OLLAMA/x']) {
      expect(knowledgeEmbeddingFamily({ KB_EMBEDDING_MODEL: model }), model).toBe('ollama')
    }
  })

  it('falls back to the family of the model an unset variable defaults to', () => {
    const defaultFamily = getEmbeddingModelInfo(DEFAULT_EMBEDDING_MODEL).provider
    expect(knowledgeEmbeddingFamily({})).toBe(defaultFamily)
    expect(knowledgeEmbeddingFamily({ KB_EMBEDDING_MODEL: '   ' })).toBe(defaultFamily)
    /** An unrecognised id falls back to the default model, which is OpenAI's. */
    expect(knowledgeEmbeddingFamily({ KB_EMBEDDING_MODEL: 'not-a-model' })).toBe(defaultFamily)
  })
})
