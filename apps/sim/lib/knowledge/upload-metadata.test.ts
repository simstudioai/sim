/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_DOCUMENT_UPLOAD_RECIPES,
  knowledgeDocumentUploadMetadataSchema,
  persistedKnowledgeDocumentUploadMetadataSchema,
} from '@/lib/knowledge/upload-metadata'

describe('knowledgeDocumentUploadMetadataSchema', () => {
  it('rejects a recipe outside the accepted set', () => {
    const result = knowledgeDocumentUploadMetadataSchema.safeParse({
      processingOptions: { recipe: 'totally-bogus-recipe' },
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['processingOptions', 'recipe'])
    expect(result.error?.issues[0]?.message).toContain('recipe must be one of')
  })

  it('rejects a lang outside the enforced subtag shape', () => {
    const result = knowledgeDocumentUploadMetadataSchema.safeParse({
      processingOptions: { lang: 'zzzz-nonsense!' },
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('hyphen-separated letter and digit subtags')
  })

  /**
   * The message promises the shape, not BCP-47 conformance, so a tag the RFC
   * rejects for a trailing singleton still parses. Pinned so the two cannot
   * drift back apart into a message that claims more than the regex enforces.
   */
  it('does not claim the BCP-47 conformance it cannot enforce', () => {
    const result = knowledgeDocumentUploadMetadataSchema.safeParse({
      processingOptions: { lang: 'en-a' },
    })
    expect(result.success).toBe(true)
    expect(
      knowledgeDocumentUploadMetadataSchema.safeParse({ processingOptions: { lang: 'en_US' } })
        .error?.issues[0]?.message
    ).not.toContain('BCP-47')
  })

  it('rejects the underscore locale form callers reach for', () => {
    expect(
      knowledgeDocumentUploadMetadataSchema.safeParse({ processingOptions: { lang: 'en_US' } })
        .success
    ).toBe(false)
  })

  it('accepts what first-party callers actually send today', () => {
    const result = knowledgeDocumentUploadMetadataSchema.safeParse({
      tag1: 'product',
      processingOptions: { recipe: 'default', lang: 'en' },
    })
    expect(result.success).toBe(true)
    expect(result.data?.processingOptions).toEqual({ recipe: 'default', lang: 'en' })
  })

  it('accepts a multi-subtag language tag', () => {
    expect(
      knowledgeDocumentUploadMetadataSchema.safeParse({ processingOptions: { lang: 'zh-Hant-TW' } })
        .success
    ).toBe(true)
  })

  it('keeps the chunker recipes accepted alongside the default sentinel', () => {
    expect(KNOWLEDGE_DOCUMENT_UPLOAD_RECIPES).toContain('default')
    expect(
      knowledgeDocumentUploadMetadataSchema.safeParse({ processingOptions: { recipe: 'markdown' } })
        .success
    ).toBe(true)
  })
})

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

  it('preserves recognized values', () => {
    const parsed = persistedKnowledgeDocumentUploadMetadataSchema.parse({
      processingOptions: { recipe: 'code', lang: 'en-US' },
    })
    expect(parsed.processingOptions).toEqual({ recipe: 'code', lang: 'en-US' })
  })
})
