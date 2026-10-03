import { describe, expect, it } from 'vitest'
import { persistedKnowledgeDocumentUploadMetadataSchema } from '@/lib/knowledge/upload-metadata'

describe('persistedKnowledgeDocumentUploadMetadataSchema', () => {
  it('drops a recipe persisted before the enum landed instead of throwing', () => {
    const parsed = persistedKnowledgeDocumentUploadMetadataSchema.parse({
      tag1: 'product',
      processingOptions: { recipe: 'super-chunker-9000', lang: 'en' },
    })
    expect(parsed.processingOptions).toEqual({ recipe: undefined, lang: 'en' })
    expect(parsed.tag1).toBe('product')
  })

  it('drops a lang persisted before the language-tag shape landed instead of throwing', () => {
    const parsed = persistedKnowledgeDocumentUploadMetadataSchema.parse({
      processingOptions: { recipe: 'default', lang: 'en_US' },
    })
    expect(parsed.processingOptions).toEqual({ recipe: 'default', lang: undefined })
  })

  it('does not throw on a session whose processing options are wholly unrecognized', () => {
    expect(() =>
      persistedKnowledgeDocumentUploadMetadataSchema.parse({
        processingOptions: { recipe: 42, lang: false },
      })
    ).not.toThrow()
  })
})
