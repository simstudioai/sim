/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  v2BulkKnowledgeDocumentsDataSchema,
  v2GetKnowledgeBaseContract,
} from '@/lib/api/contracts/v2/knowledge'
import { v2BulkKnowledgeChunksDataSchema } from '@/lib/api/contracts/v2/knowledge-chunks'

/**
 * The two bulk surfaces answer the same question — "which of the ids I named
 * did nothing?" — so they are pinned against each other rather than against a
 * literal, which is what stops one of them being renamed on its own again.
 */
describe('bulk knowledge outcomes', () => {
  it('reports the matched count and the unmatched ids under the same names on both', () => {
    const documents = Object.keys(v2BulkKnowledgeDocumentsDataSchema.shape)
    const chunks = Object.keys(v2BulkKnowledgeChunksDataSchema.shape)

    for (const field of ['operation', 'processed', 'errors']) {
      expect(chunks).toContain(field)
      expect(documents).toContain(field)
    }
    expect(documents).not.toContain('updatedCount')
  })

  it('accepts a zero-match document sweep as a success body rather than an error', () => {
    const parsed = v2BulkKnowledgeDocumentsDataSchema.safeParse({
      operation: 'disable',
      processed: 0,
      errors: ['No matching documents found to disable: document-missing'],
      documentIds: [],
    })

    expect(parsed.success).toBe(true)
  })
})

describe('knowledge base read lifecycle', () => {
  it('says which lifecycle the read addresses on the identifier a caller types', () => {
    const described = v2GetKnowledgeBaseContract.params?.shape.knowledgeBaseId.description

    expect(described).toBeTypeOf('string')
    expect(described).toContain('Active knowledge bases only')
    expect(described).toContain('archived')
  })
})
