import { document, knowledgeBase, knowledgeBaseTagDefinitions } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
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
})
