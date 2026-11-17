import { describe, expect, it } from 'vitest'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'

function mapToolCall(params: Record<string, unknown>, operation: string) {
  const mapper = KnowledgeBlock.tools.config?.params
  if (!mapper) throw new Error('Knowledge block has no params mapper')
  return mapper(params, { operation })
}

describe('Knowledge mapper on tool calls (operation only in context)', () => {
  it('coerces a model-sent "false" to a boolean for update_chunk', () => {
    const mapped = mapToolCall(
      { knowledgeBaseId: 'kb-1', documentId: 'doc-1', chunkId: 'chunk-1', enabled: 'false' },
      'update_chunk'
    )

    expect(mapped.enabled).toBe(false)
  })

  it('forwards the stored status filter and search for list_chunks', () => {
    const mapped = mapToolCall(
      {
        knowledgeBaseId: 'kb-1',
        documentId: 'doc-1',
        chunkSearch: 'pricing',
        chunkEnabledFilter: 'false',
      },
      'list_chunks'
    )

    expect(mapped).toMatchObject({ search: 'pricing', enabled: 'false' })
  })

  it('keeps the model status filter when the stored row holds the default "all"', () => {
    const mapped = mapToolCall(
      { knowledgeBaseId: 'kb-1', documentId: 'doc-1', chunkEnabledFilter: 'all', enabled: 'true' },
      'list_chunks'
    )

    expect(mapped.enabled).toBe('true')
  })

  it('sends the stored upsert document id as documentId', () => {
    const mapped = mapToolCall(
      { knowledgeBaseId: 'kb-1', upsertDocumentId: ' doc-9 ', name: 'Doc', content: 'Body' },
      'upsert_document'
    )

    expect(mapped.documentId).toBe('doc-9')
  })
})
