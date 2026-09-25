import { describe, expect, it } from 'vitest'
import { MAX_KNOWLEDGE_BUNDLE_DOCUMENTS } from '@/lib/knowledge/constants'
import {
  decodeVectorBase64,
  encodeVectorBase64,
  KnowledgeBundleVectorError,
  knowledgeBundleManifestSchema,
} from '@/lib/knowledge/transfer/bundle'

const DOCUMENT_ID = 'a2f1c3d4-1111-4222-8333-444455556666'

function manifestDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: DOCUMENT_ID,
    filename: 'handbook.pdf',
    mimeType: 'application/pdf',
    fileSize: 1234,
    enabled: true,
    tags: { tag1: 'Billing' },
    file: `files/${DOCUMENT_ID}/handbook.pdf`,
    chunks: `chunks/${DOCUMENT_ID}.ndjson`,
    chunkCount: 3,
    tokenCount: 900,
    characterCount: 4000,
    ...overrides,
  }
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    exportedAt: '2026-09-08T12:00:00.000Z',
    embedding: { model: 'text-embedding-3-small', dimension: 1536, vectorsIncluded: true },
    knowledgeBase: {
      name: 'Support docs',
      description: null,
      chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
    },
    tags: [{ slot: 'tag1', displayName: 'Product', fieldType: 'text' }],
    documents: [manifestDocument()],
    ...overrides,
  }
}

describe('knowledgeBundleManifestSchema', () => {
  /** Strictness is what keeps a tampered or future field from silently riding along. */
  it('refuses unknown fields at every level', () => {
    expect(knowledgeBundleManifestSchema.safeParse({ ...manifest(), acl: ['ws'] }).success).toBe(
      false
    )
    expect(
      knowledgeBundleManifestSchema.safeParse(
        manifest({ documents: [manifestDocument({ connectorId: 'kc-1' })] })
      ).success
    ).toBe(false)
    expect(
      knowledgeBundleManifestSchema.safeParse(
        manifest({ documents: [manifestDocument({ uploadedBy: 'user-1' })] })
      ).success
    ).toBe(false)
  })

  it('refuses a dimension no storage column holds', () => {
    expect(
      knowledgeBundleManifestSchema.safeParse(
        manifest({ embedding: { model: 'x', dimension: 1000, vectorsIncluded: false } })
      ).success
    ).toBe(false)
  })

  it('refuses a tag slot that does not belong to its field type', () => {
    expect(
      knowledgeBundleManifestSchema.safeParse(
        manifest({ tags: [{ slot: 'number1', displayName: 'Product', fieldType: 'text' }] })
      ).success
    ).toBe(false)
  })

  it('refuses duplicate tag slots and case-insensitively duplicate tag names', () => {
    expect(
      knowledgeBundleManifestSchema.safeParse(
        manifest({
          tags: [
            { slot: 'tag1', displayName: 'Product', fieldType: 'text' },
            { slot: 'tag1', displayName: 'Region', fieldType: 'text' },
          ],
        })
      ).success
    ).toBe(false)
    expect(
      knowledgeBundleManifestSchema.safeParse(
        manifest({
          tags: [
            { slot: 'tag1', displayName: 'Product', fieldType: 'text' },
            { slot: 'tag2', displayName: 'product', fieldType: 'text' },
          ],
        })
      ).success
    ).toBe(false)
  })

  it('refuses entry paths that do not belong to the document', () => {
    expect(
      knowledgeBundleManifestSchema.safeParse(
        manifest({ documents: [manifestDocument({ file: 'files/other/handbook.pdf' })] })
      ).success
    ).toBe(false)
    expect(
      knowledgeBundleManifestSchema.safeParse(
        manifest({ documents: [manifestDocument({ chunks: 'chunks/other.ndjson' })] })
      ).success
    ).toBe(false)
  })

  it('caps the document list', () => {
    const documents = Array.from({ length: MAX_KNOWLEDGE_BUNDLE_DOCUMENTS + 1 }, (_, index) =>
      manifestDocument({
        id: `doc-${index}`,
        file: `files/doc-${index}/handbook.pdf`,
        chunks: `chunks/doc-${index}.ndjson`,
      })
    )
    expect(knowledgeBundleManifestSchema.safeParse(manifest({ documents })).success).toBe(false)
  })
})

describe('vector codec', () => {
  it('refuses a payload whose width differs from the declared dimension', () => {
    expect(() => decodeVectorBase64(encodeVectorBase64([1, 2, 3]), 4)).toThrow(
      KnowledgeBundleVectorError
    )
  })

  it('refuses non-finite values', () => {
    expect(() => decodeVectorBase64(encodeVectorBase64([1, Number.NaN]), 2)).toThrow(
      KnowledgeBundleVectorError
    )
    expect(() => decodeVectorBase64(encodeVectorBase64([Number.POSITIVE_INFINITY, 1]), 2)).toThrow(
      KnowledgeBundleVectorError
    )
  })
})
