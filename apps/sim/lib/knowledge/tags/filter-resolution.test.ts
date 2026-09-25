import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetDocumentTagDefinitions, mockGetDocumentTagDefinitionsBatch } = vi.hoisted(() => ({
  mockGetDocumentTagDefinitions: vi.fn(),
  mockGetDocumentTagDefinitionsBatch: vi.fn(),
}))

vi.mock('@/lib/knowledge/tags/service', () => ({
  getDocumentTagDefinitionsByKnowledgeBaseIds: mockGetDocumentTagDefinitionsBatch,
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
    mockGetDocumentTagDefinitionsBatch.mockImplementation(
      async (ids: string[]) =>
        new Map(
          await Promise.all(ids.map(async (id) => [id, await mockGetDocumentTagDefinitions(id)]))
        )
    )
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

  it('rejects an operator the resolved field type does not implement', async () => {
    mockGetDocumentTagDefinitions.mockResolvedValue([definition('kb-1', 'tag1', 'category')])

    await expect(
      resolveKnowledgeTagFilters(
        [{ tagName: 'category', operator: 'gt', value: 'billing' }],
        ['kb-1']
      )
    ).rejects.toThrow(
      'Tag "category" is a text tag and does not support operator "gt". Supported operators: eq, neq, contains, not_contains, starts_with, ends_with'
    )
  })

  it('rejects an operator no field type implements rather than passing it through', async () => {
    mockGetDocumentTagDefinitions.mockResolvedValue([definition('kb-1', 'tag1', 'category')])

    await expect(
      resolveKnowledgeTagFilters(
        [{ tagName: 'category', operator: 'nosuchop', value: 'billing' }],
        ['kb-1']
      )
    ).rejects.toThrow('does not support operator "nosuchop"')
  })

  it('rejects "between" with no upper bound instead of dropping the predicate', async () => {
    mockGetDocumentTagDefinitions.mockResolvedValue([
      definition('kb-1', 'number1', 'score', 'number'),
    ])

    await expect(
      resolveKnowledgeTagFilters([{ tagName: 'score', operator: 'between', value: '1' }], ['kb-1'])
    ).rejects.toThrow('Tag "score" requires valueTo when using the "between" operator')
  })

  it('rejects an upper bound that is not of the tag field type', async () => {
    mockGetDocumentTagDefinitions.mockResolvedValue([
      definition('kb-1', 'number1', 'score', 'number'),
    ])

    await expect(
      resolveKnowledgeTagFilters(
        [{ tagName: 'score', operator: 'between', value: '1', valueTo: 'ten' }],
        ['kb-1']
      )
    ).rejects.toThrow('The "between" upper bound is invalid. Tag "score" expects a number value')
  })
})

describe('toKnowledgeTagFilterConditions', () => {
  it('rejects a definition stored with an unsupported field type rather than dropping the predicate', () => {
    expect(() =>
      toKnowledgeTagFilterConditions([
        { tagSlot: 'tag1', fieldType: 'nonsense', operator: 'eq', value: 'x' },
      ])
    ).toThrow('unsupported field type')
  })
})
