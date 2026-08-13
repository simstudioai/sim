/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetDocumentTagDefinitions } = vi.hoisted(() => ({
  mockGetDocumentTagDefinitions: vi.fn(),
}))

vi.mock('@/lib/knowledge/tags/service', () => ({
  getDocumentTagDefinitions: mockGetDocumentTagDefinitions,
}))

import {
  resolveKnowledgeTagFilters,
  toKnowledgeTagFilterConditions,
} from '@/lib/knowledge/tags/filter-resolution'

const CREATED_AT = new Date('2025-01-10T09:00:00Z')

function definition(
  knowledgeBaseId: string,
  tagSlot: string,
  displayName: string,
  fieldType = 'text'
) {
  return {
    id: `${knowledgeBaseId}-${tagSlot}`,
    knowledgeBaseId,
    tagSlot,
    displayName,
    fieldType,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }
}

describe('resolveKnowledgeTagFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a display name to the slot it is stored in', async () => {
    mockGetDocumentTagDefinitions.mockResolvedValue([definition('kb-1', 'tag1', 'category')])

    const resolved = await resolveKnowledgeTagFilters(
      [{ tagName: 'category', operator: 'eq', value: 'billing' }],
      ['kb-1']
    )

    expect(resolved.structuredFilters).toEqual([
      { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'billing', valueTo: undefined },
    ])
    expect(resolved.definitionsByKnowledgeBase.get('kb-1')).toHaveLength(1)
  })

  it('rejects a tag name the knowledge base does not define instead of ignoring it', async () => {
    mockGetDocumentTagDefinitions.mockResolvedValue([definition('kb-1', 'tag1', 'category')])

    await expect(
      resolveKnowledgeTagFilters(
        [{ tagName: 'not-a-tag', operator: 'eq', value: 'billing' }],
        ['kb-1']
      )
    ).rejects.toThrow('not defined in this knowledge base')
  })

  it('rejects a tag missing from one of several knowledge bases', async () => {
    mockGetDocumentTagDefinitions
      .mockResolvedValueOnce([definition('kb-1', 'tag1', 'category')])
      .mockResolvedValueOnce([definition('kb-2', 'tag1', 'other')])

    await expect(
      resolveKnowledgeTagFilters(
        [{ tagName: 'category', operator: 'eq', value: 'billing' }],
        ['kb-1', 'kb-2']
      )
    ).rejects.toThrow('does not exist in all selected knowledge bases')
  })

  it('rejects a tag mapped to different slots across knowledge bases', async () => {
    mockGetDocumentTagDefinitions
      .mockResolvedValueOnce([definition('kb-1', 'tag1', 'category')])
      .mockResolvedValueOnce([definition('kb-2', 'tag2', 'category')])

    await expect(
      resolveKnowledgeTagFilters(
        [{ tagName: 'category', operator: 'eq', value: 'billing' }],
        ['kb-1', 'kb-2']
      )
    ).rejects.toThrow('is not mapped consistently')
  })
})

describe('toKnowledgeTagFilterConditions', () => {
  it('narrows resolved filters onto the document-list filter shape', () => {
    expect(
      toKnowledgeTagFilterConditions([
        { tagSlot: 'number1', fieldType: 'number', operator: 'gte', value: 2 },
      ])
    ).toEqual([
      { tagSlot: 'number1', fieldType: 'number', operator: 'gte', value: 2, valueTo: undefined },
    ])
  })

  it('rejects a definition stored with an unsupported field type rather than dropping the predicate', () => {
    expect(() =>
      toKnowledgeTagFilterConditions([
        { tagSlot: 'tag1', fieldType: 'nonsense', operator: 'eq', value: 'x' },
      ])
    ).toThrow('unsupported field type')
  })
})
