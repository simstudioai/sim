/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { v2KnowledgeTaggedDocumentSchema } from '@/lib/api/contracts/v2/knowledge'
import type { DocumentTagDefinition } from '@/lib/knowledge/tags/types'
import {
  toV2DocumentSummary,
  toV2DocumentTags,
  toV2TaggedDocument,
} from '@/app/api/v2/knowledge/utils'

const uploadedAt = new Date('2026-08-01T00:00:00.000Z')

const documentRow = {
  id: 'doc-1',
  knowledgeBaseId: 'kb-1',
  filename: 'invoice.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
  processingStatus: 'completed',
  chunkCount: 4,
  tokenCount: 512,
  characterCount: 2048,
  enabled: true,
  uploadedAt,
  tag1: 'billing',
  number1: 7,
}

const tagDefinitions: DocumentTagDefinition[] = [
  {
    id: 'def-1',
    knowledgeBaseId: 'kb-1',
    tagSlot: 'tag1',
    displayName: 'category',
    fieldType: 'text',
    createdAt: uploadedAt,
    updatedAt: uploadedAt,
  } as DocumentTagDefinition,
]

describe('toV2DocumentSummary', () => {
  it('serializes the shared document fields', () => {
    expect(toV2DocumentSummary(documentRow)).toEqual({
      id: 'doc-1',
      knowledgeBaseId: 'kb-1',
      filename: 'invoice.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      processingStatus: 'completed',
      chunkCount: 4,
      tokenCount: 512,
      characterCount: 2048,
      enabled: true,
      createdAt: '2026-08-01T00:00:00.000Z',
    })
  })

  it('returns a null createdAt for a document with no upload timestamp', () => {
    expect(toV2DocumentSummary({ ...documentRow, uploadedAt: null }).createdAt).toBeNull()
  })

  it('reads an absent processing status as pending', () => {
    expect(toV2DocumentSummary({ ...documentRow, processingStatus: null }).processingStatus).toBe(
      'pending'
    )
  })
})

describe('toV2TaggedDocument', () => {
  it('produces a contract-valid list item with tags keyed by display name', () => {
    const projected = toV2TaggedDocument(documentRow, tagDefinitions)
    expect(v2KnowledgeTaggedDocumentSchema.parse(projected)).toEqual(projected)
    expect(projected.tags).toEqual({ category: 'billing', number1: 7 })
  })

  it('does not throw when the document has no upload timestamp', () => {
    const projected = toV2TaggedDocument({ ...documentRow, uploadedAt: null }, tagDefinitions)
    expect(projected.createdAt).toBeNull()
    expect(v2KnowledgeTaggedDocumentSchema.parse(projected)).toEqual(projected)
  })
})

describe('toV2DocumentTags', () => {
  it('serializes a date-valued slot as an ISO string', () => {
    expect(toV2DocumentTags({ date1: new Date('2026-08-02T00:00:00.000Z') }, [])).toEqual({
      date1: '2026-08-02T00:00:00.000Z',
    })
  })
})
