import { document, knowledgeBase, knowledgeBaseTagDefinitions } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteAllTagDefinitions,
  deleteTagDefinition,
  KnowledgeTagProvenanceConflictError,
} from '@/lib/knowledge/tags/service'

const KNOWLEDGE_BASE_ID = 'knowledge-base-1'
const TAG_DEFINITION = {
  id: 'tag-definition-1',
  knowledgeBaseId: KNOWLEDGE_BASE_ID,
  tagSlot: 'tag1',
  displayName: 'Classification',
}

function queueSingleTagDeletion(conflict: boolean): void {
  queueTableRows(knowledgeBase, [{ id: KNOWLEDGE_BASE_ID }])
  queueTableRows(knowledgeBaseTagDefinitions, [TAG_DEFINITION])
  queueTableRows(document, conflict ? [{ id: 'document-1' }] : [])
}

describe('knowledge tag deletion provenance', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('rejects uncertain or nonempty tracked provenance before mutating data', async () => {
    queueSingleTagDeletion(true)

    await expect(
      deleteTagDefinition(KNOWLEDGE_BASE_ID, TAG_DEFINITION.id, 'request-1')
    ).rejects.toBeInstanceOf(KnowledgeTagProvenanceConflictError)

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('clears every bounded tag slot through the same guarded mutation path', async () => {
    queueTableRows(knowledgeBase, [{ id: KNOWLEDGE_BASE_ID }])
    queueTableRows(knowledgeBaseTagDefinitions, [
      { id: 'tag-definition-1', tagSlot: 'tag1' },
      { id: 'tag-definition-2', tagSlot: 'number1' },
    ])
    queueTableRows(document, [])

    await expect(deleteAllTagDefinitions(KNOWLEDGE_BASE_ID, 'request-1')).resolves.toBe(2)

    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ tag1: null, number1: null })
  })
})
