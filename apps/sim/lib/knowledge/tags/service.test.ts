/**
 * @vitest-environment node
 */

import { document, embedding, knowledgeBaseTagDefinitions } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'generated-tag-id'),
  generateShortId: vi.fn(() => 'short-id'),
}))

import {
  createOrUpdateTagDefinitionsBulk,
  createTagDefinition,
  getTagUsageStats,
  updateTagDefinition,
} from '@/lib/knowledge/tags/service'

const NOW = new Date('2026-01-01T00:00:00.000Z')

function existingDefinition(overrides: Record<string, unknown>) {
  return {
    id: 'tag-def-1',
    knowledgeBaseId: 'kb-1',
    tagSlot: 'tag1',
    displayName: 'clitest-score',
    fieldType: 'text',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('createOrUpdateTagDefinitionsBulk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('honors an explicitly requested slot instead of relocating it', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [existingDefinition({ tagSlot: 'tag1' })])

    const result = await createOrUpdateTagDefinitionsBulk(
      'kb-1',
      { definitions: [{ tagSlot: 'tag4', displayName: 'clitest-saved', fieldType: 'text' }] },
      'request-1'
    )

    expect(result.errors).toEqual([])
    expect(result.created).toHaveLength(1)
    expect(result.created[0].tagSlot).toBe('tag4')
  })

  it('rejects a slot that does not belong to the declared field type', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [])

    const result = await createOrUpdateTagDefinitionsBulk(
      'kb-1',
      { definitions: [{ tagSlot: 'tag6', displayName: 'clitest-bad', fieldType: 'number' }] },
      'request-2'
    )

    expect(result.created).toEqual([])
    expect(result.errors).toEqual(['Tag slot "tag6" is not valid for field type "number"'])
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('rejects a free slot whose family does not match the declared field type', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [])

    const result = await createOrUpdateTagDefinitionsBulk(
      'kb-1',
      { definitions: [{ tagSlot: 'number4', displayName: 'clitest-wrong', fieldType: 'text' }] },
      'request-3'
    )

    expect(result.created).toEqual([])
    expect(result.errors).toEqual(['Tag slot "number4" is not valid for field type "text"'])
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('treats an identical re-declaration as a no-op instead of a duplicate error', async () => {
    const existing = existingDefinition({ tagSlot: 'number1', fieldType: 'number' })
    queueTableRows(knowledgeBaseTagDefinitions, [existing])

    const result = await createOrUpdateTagDefinitionsBulk(
      'kb-1',
      {
        definitions: [{ tagSlot: 'number1', displayName: 'clitest-score', fieldType: 'number' }],
      },
      'request-4'
    )

    expect(result.errors).toEqual([])
    expect(result.created).toEqual([])
    expect(result.updated).toEqual([existing])
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('treats an identical re-declaration without a slot as a no-op', async () => {
    const existing = existingDefinition({ tagSlot: 'tag1', fieldType: 'text' })
    queueTableRows(knowledgeBaseTagDefinitions, [existing])

    const result = await createOrUpdateTagDefinitionsBulk(
      'kb-1',
      { definitions: [{ displayName: 'clitest-score', fieldType: 'text' }] },
      'request-5'
    )

    expect(result.errors).toEqual([])
    expect(result.created).toEqual([])
    expect(result.updated).toEqual([existing])
  })

  it('refuses to rename the tag occupying a declared slot without originalDisplayName', async () => {
    const existing = existingDefinition({ tagSlot: 'tag1', fieldType: 'text' })
    queueTableRows(knowledgeBaseTagDefinitions, [existing])

    const result = await createOrUpdateTagDefinitionsBulk(
      'kb-1',
      { definitions: [{ tagSlot: 'tag1', displayName: 'clitest-renamed', fieldType: 'text' }] },
      'request-6'
    )

    expect(result.created).toEqual([])
    expect(result.updated).toEqual([])
    expect(result.errors).toEqual([
      'Tag slot "tag1" is already in use by "clitest-score"; supply originalDisplayName to rename it',
    ])
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('renames the tag a declared slot holds when originalDisplayName says so', async () => {
    const existing = existingDefinition({ tagSlot: 'tag1', fieldType: 'text' })
    queueTableRows(knowledgeBaseTagDefinitions, [existing])

    const result = await createOrUpdateTagDefinitionsBulk(
      'kb-1',
      {
        definitions: [
          {
            tagSlot: 'tag1',
            displayName: 'clitest-renamed',
            fieldType: 'text',
            originalDisplayName: 'clitest-score',
          },
        ],
      },
      'request-8'
    )

    expect(result.errors).toEqual([])
    expect(result.created).toEqual([])
    expect(result.updated).toHaveLength(1)
    expect(result.updated[0]).toMatchObject({
      id: 'tag-def-1',
      tagSlot: 'tag1',
      displayName: 'clitest-renamed',
    })
    expect(dbChainMockFns.update).toHaveBeenCalled()
  })

  it('refuses to move an existing tag into a different declared slot', async () => {
    const existing = existingDefinition({ tagSlot: 'tag1', fieldType: 'text' })
    queueTableRows(knowledgeBaseTagDefinitions, [existing])

    const result = await createOrUpdateTagDefinitionsBulk(
      'kb-1',
      {
        definitions: [
          {
            tagSlot: 'tag5',
            displayName: 'clitest-renamed',
            fieldType: 'text',
            originalDisplayName: 'clitest-score',
          },
        ],
      },
      'request-9'
    )

    expect(result.updated).toEqual([])
    expect(result.errors).toEqual([
      `Tag "clitest-score" occupies slot "tag1"; a tag's slot cannot change`,
    ])
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rejects a display name that differs from an existing one only in case', async () => {
    const existing = existingDefinition({ tagSlot: 'tag1', displayName: 'clitest-cat' })
    queueTableRows(knowledgeBaseTagDefinitions, [existing])

    const result = await createOrUpdateTagDefinitionsBulk(
      'kb-1',
      { definitions: [{ tagSlot: 'tag2', displayName: 'CLITEST-CAT', fieldType: 'text' }] },
      'request-7'
    )

    expect(result.created).toEqual([])
    expect(result.errors).toEqual(['Display name "CLITEST-CAT" already exists'])
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('reads the snapshot it compares against under the knowledge base row lock', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [])

    await createOrUpdateTagDefinitionsBulk(
      'kb-1',
      { definitions: [{ tagSlot: 'tag1', displayName: 'clitest-locked', fieldType: 'text' }] },
      'request-10'
    )

    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
  })
})

describe('getTagUsageStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * `knowledge tags usage` reported a `chunkCount` that lagged behind a chunk
   * just added to a tagged document. The count is read live, per request, and
   * through the document slot the chunk inherits — never from a stored counter
   * or the per-chunk copy of the tag.
   */
  it('counts chunks live through the document slot they inherit', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [existingDefinition({})])
    queueTableRows(document, [{ count: 2 }])
    queueTableRows(embedding, [{ count: 7 }])

    const [usage] = await getTagUsageStats('kb-1', 'req-1')

    expect(usage).toMatchObject({
      id: 'tag-def-1',
      tagSlot: 'tag1',
      displayName: 'clitest-score',
      documentCount: 2,
      chunkCount: 7,
    })
    const chunkWhere = JSON.stringify(dbChainMockFns.where.mock.calls.at(-1))
    expect(chunkWhere).toContain('document.tag1')
    expect(chunkWhere).not.toContain('embedding.tag1')
  })
})

describe('createTagDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('refuses a display name an existing definition holds in another case', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [
      existingDefinition({ displayName: 'clitest-cat' }),
    ])

    await expect(
      createTagDefinition(
        {
          knowledgeBaseId: 'kb-1',
          tagSlot: 'tag2',
          displayName: 'CLITEST-CAT',
          fieldType: 'text',
        },
        'request-11'
      )
    ).rejects.toThrow('A tag with that name already exists in this knowledge base')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('checks and inserts inside one transaction holding the knowledge base row lock', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [])

    await createTagDefinition(
      {
        knowledgeBaseId: 'kb-1',
        tagSlot: 'tag2',
        displayName: 'clitest-free',
        fieldType: 'text',
      },
      'request-12'
    )

    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.insert).toHaveBeenCalled()
  })
})

describe('updateTagDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('refuses a rename onto a sibling name that differs only in case', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [
      existingDefinition({ id: 'tag-def-1', displayName: 'clitest-cat' }),
      existingDefinition({ id: 'tag-def-2', tagSlot: 'tag2', displayName: 'clitest-dog' }),
    ])

    await expect(
      updateTagDefinition('tag-def-2', 'kb-1', { displayName: 'CLITEST-CAT' }, 'request-13')
    ).rejects.toThrow('A tag with that name already exists in this knowledge base')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('allows a definition to be renamed to another casing of its own name', async () => {
    queueTableRows(knowledgeBaseTagDefinitions, [
      existingDefinition({ id: 'tag-def-1', displayName: 'clitest-cat' }),
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      existingDefinition({ id: 'tag-def-1', displayName: 'CLITEST-CAT' }),
    ])

    const updated = await updateTagDefinition(
      'tag-def-1',
      'kb-1',
      { displayName: 'CLITEST-CAT' },
      'request-14'
    )

    expect(updated.displayName).toBe('CLITEST-CAT')
    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
  })
})
