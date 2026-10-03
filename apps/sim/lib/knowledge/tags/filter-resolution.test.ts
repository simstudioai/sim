import {
  knowledgeTagsServiceMock,
  knowledgeTagsServiceMockFns,
} from '@sim/testing/mocks/knowledge-tags-service.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/tags/service', () => knowledgeTagsServiceMock)

import {
  resolveKnowledgeTagFilters,
  toKnowledgeTagFilterConditions,
} from '@/lib/knowledge/tags/filter-resolution'

const mockGetDocumentTagDefinitions = knowledgeTagsServiceMockFns.mockGetDocumentTagDefinitions

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
  it('resolves a tag ID and derives its slot and field type from the selected knowledge base', async () => {
    mockGetDocumentTagDefinitions.mockResolvedValue([
      definition('kb-1', 'number1', 'score', 'number'),
    ])

    const resolved = await resolveKnowledgeTagFilters(
      [
        {
          tagId: 'kb-1-number1',
          tagSlot: 'tag7',
          fieldType: 'text',
          operator: 'gte',
          value: 10,
        },
      ] as never,
      ['kb-1']
    )

    expect(resolved.structuredFilters).toEqual([
      { tagSlot: 'number1', fieldType: 'number', operator: 'gte', value: 10, valueTo: undefined },
    ])
  })

  it('rejects a tag ID that does not belong to the selected knowledge base', async () => {
    mockGetDocumentTagDefinitions.mockResolvedValue([definition('kb-1', 'tag1', 'category')])

    await expect(
      resolveKnowledgeTagFilters(
        [{ tagId: 'tag-from-another-kb', operator: 'eq', value: 'billing' }],
        ['kb-1']
      )
    ).rejects.toThrow('Tag IDs not found in the selected knowledge base: tag-from-another-kb')
  })

  it('rejects tag ID filters across multiple knowledge bases before loading definitions', async () => {
    await expect(
      resolveKnowledgeTagFilters(
        [{ tagId: 'tag-definition-id', operator: 'eq', value: 'billing' }],
        ['kb-1', 'kb-2']
      )
    ).rejects.toThrow('Tag ID filters can only search one knowledge base at a time')

    expect(mockGetDocumentTagDefinitions).not.toHaveBeenCalled()
  })

  it.each([
    { tagName: 'category', tagId: 'tag-definition-id' },
    {},
    { tagId: '   ' },
    { tagName: 'category', tagId: 123 },
  ])('rejects a filter without exactly one identifier', async (identifier) => {
    await expect(
      resolveKnowledgeTagFilters([{ ...identifier, operator: 'eq', value: 'billing' }] as never, [
        'kb-1',
      ])
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Each tag filter must include exactly one of tagName or tagId',
    })

    expect(mockGetDocumentTagDefinitions).not.toHaveBeenCalled()
  })

  it('validates operators against the field type resolved from a tag ID', async () => {
    mockGetDocumentTagDefinitions.mockResolvedValue([
      definition('kb-1', 'boolean1', 'enabled', 'boolean'),
    ])

    await expect(
      resolveKnowledgeTagFilters(
        [
          {
            tagId: 'kb-1-boolean1',
            fieldType: 'text',
            operator: 'contains',
            value: true,
          },
        ],
        ['kb-1']
      )
    ).rejects.toThrow('Tag "enabled" is a boolean tag and does not support operator "contains"')
  })

  it('validates values against the field type resolved from a tag ID', async () => {
    mockGetDocumentTagDefinitions.mockResolvedValue([
      definition('kb-1', 'number1', 'score', 'number'),
    ])

    await expect(
      resolveKnowledgeTagFilters(
        [
          {
            tagId: 'kb-1-number1',
            fieldType: 'text',
            operator: 'gte',
            value: 'not-a-number',
          },
        ],
        ['kb-1']
      )
    ).rejects.toThrow('Tag "score" expects a number value')
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
