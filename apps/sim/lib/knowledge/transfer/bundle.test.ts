/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MAX_KNOWLEDGE_BUNDLE_DOCUMENTS } from '@/lib/knowledge/constants'
import {
  chunksEntryPath,
  decodeVectorBase64,
  type ExportableDocumentRecord,
  encodeVectorBase64,
  fileEntryPath,
  KnowledgeBundleVectorError,
  knowledgeBundleChunkLineSchema,
  knowledgeBundleManifestSchema,
  safeBundleLeafName,
  toManifestDocument,
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
  it('accepts a well-formed manifest', () => {
    expect(knowledgeBundleManifestSchema.safeParse(manifest()).success).toBe(true)
  })

  it('refuses any other layout version', () => {
    expect(knowledgeBundleManifestSchema.safeParse(manifest({ version: 2 })).success).toBe(false)
  })

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

  it('refuses a document with neither a file nor chunks', () => {
    expect(
      knowledgeBundleManifestSchema.safeParse(
        manifest({ documents: [manifestDocument({ file: null, chunks: null })] })
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

describe('knowledgeBundleChunkLineSchema', () => {
  it('accepts a line with and without a vector', () => {
    const line = {
      index: 0,
      content: 'Refunds take five days.',
      tokenCount: 6,
      startOffset: 0,
      endOffset: 23,
      enabled: true,
    }
    expect(knowledgeBundleChunkLineSchema.safeParse(line).success).toBe(true)
    expect(
      knowledgeBundleChunkLineSchema.safeParse({ ...line, vector: encodeVectorBase64([0.5, 1]) })
        .success
    ).toBe(true)
    expect(knowledgeBundleChunkLineSchema.safeParse({ ...line, vector: '***' }).success).toBe(false)
  })
})

describe('toManifestDocument', () => {
  const record: ExportableDocumentRecord = {
    id: DOCUMENT_ID,
    filename: 'handbook.pdf',
    mimeType: 'application/pdf',
    fileSize: 1234,
    enabled: false,
    tokenCount: 900,
    characterCount: 4000,
    tags: {
      tag1: 'Billing',
      number1: 42,
      date1: new Date('2026-01-02T00:00:00.000Z'),
      boolean1: false,
      tag2: null,
    },
  }

  it('projects exactly the manifest fields and renders tag values as strings', () => {
    const entries = {
      file: fileEntryPath(record.id, record.filename),
      chunks: chunksEntryPath(record.id),
    }
    const projected = toManifestDocument(record, entries, 7)
    expect(projected).toEqual({
      id: DOCUMENT_ID,
      filename: 'handbook.pdf',
      mimeType: 'application/pdf',
      fileSize: 1234,
      enabled: false,
      tags: {
        tag1: 'Billing',
        number1: '42',
        date1: '2026-01-02T00:00:00.000Z',
        boolean1: 'false',
      },
      file: `files/${DOCUMENT_ID}/handbook.pdf`,
      chunks: `chunks/${DOCUMENT_ID}.ndjson`,
      chunkCount: 7,
      tokenCount: 900,
      characterCount: 4000,
    })
    expect(
      knowledgeBundleManifestSchema.safeParse(manifest({ documents: [projected] })).success
    ).toBe(true)
  })
})

describe('entry paths', () => {
  it('drops directories and illegal characters from the file leaf', () => {
    expect(fileEntryPath('doc-1', '../../etc/passwd')).toBe('files/doc-1/passwd')
    expect(fileEntryPath('doc-1', 'a<b>:c.txt')).toBe('files/doc-1/a_b__c.txt')
    expect(safeBundleLeafName('..')).toBe('file')
    expect(safeBundleLeafName('x'.repeat(300))).toHaveLength(200)
  })
})

describe('vector codec', () => {
  it('round-trips float32 vectors of every stored width', () => {
    for (const width of [384, 768, 1024, 1536, 3072]) {
      const vector = Array.from({ length: width }, (_, index) => Math.fround(index / width - 0.5))
      expect(decodeVectorBase64(encodeVectorBase64(vector), width)).toEqual(vector)
    }
  })

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
