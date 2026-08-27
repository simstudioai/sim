/**
 * @vitest-environment node
 */

import { knowledgeBaseTagDefinitions } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { assertTagSlotsAreDefined } from '@/lib/knowledge/tags/service'

const KNOWLEDGE_BASE_ID = 'kb-1'
const NOW = new Date('2026-01-01T00:00:00.000Z')

function definition(tagSlot: string, displayName: string) {
  return {
    id: `tag-def-${tagSlot}`,
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    tagSlot,
    displayName,
    fieldType: 'text',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('assertTagSlotsAreDefined', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('refuses a value written into a slot the knowledge base has not defined', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [definition('tag1', 'category')])

    await expect(
      assertTagSlotsAreDefined(KNOWLEDGE_BASE_ID, { tag1: 'billing', tag2: 'purple' })
    ).rejects.toThrow(
      'The following tags are not defined in this knowledge base: "tag2". Please define them at the knowledge base level first.'
    )
  })

  it('rejects with the same validation code the tag-filter surface uses', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [])

    await expect(
      assertTagSlotsAreDefined(KNOWLEDGE_BASE_ID, { tag1: 'unicorn' })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(new OrchestrationError('validation', 'x').code).toBe('validation')
  })

  it('admits a value whose slot is defined', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [definition('tag1', 'category')])

    await expect(
      assertTagSlotsAreDefined(KNOWLEDGE_BASE_ID, { tag1: 'billing' })
    ).resolves.toBeUndefined()
  })

  it('admits clearing an undefined slot, so state written before the guard can be erased', async () => {
    await expect(
      assertTagSlotsAreDefined(KNOWLEDGE_BASE_ID, { tag2: '', tag3: null, tag4: undefined })
    ).resolves.toBeUndefined()
  })

  it('ignores non-slot keys carried alongside the tag values', async () => {
    await expect(
      assertTagSlotsAreDefined(KNOWLEDGE_BASE_ID, { filename: 'renamed.txt', enabled: true })
    ).resolves.toBeUndefined()
  })
})
