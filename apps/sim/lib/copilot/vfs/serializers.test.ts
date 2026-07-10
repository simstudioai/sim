/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { serializeFileMeta, serializeKBMeta, serializeTableMeta } from './serializers'

describe('VFS metadata serializers', () => {
  it('includes the authoritative file update timestamp', () => {
    const metadata = JSON.parse(
      serializeFileMeta({
        id: 'file-1',
        name: 'notes.md',
        contentType: 'text/markdown',
        size: 42,
        uploadedAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-09T12:34:56.000Z'),
      })
    )

    expect(metadata.updatedAt).toBe('2026-07-09T12:34:56.000Z')
  })

  it('preserves live table and knowledge-base counts', () => {
    const table = JSON.parse(
      serializeTableMeta({
        id: 'table-1',
        name: 'Customers',
        schema: { columns: [] },
        rowCount: 137,
        maxRows: 10_000,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-09T00:00:00.000Z'),
      })
    )
    const knowledgeBase = JSON.parse(
      serializeKBMeta({
        id: 'kb-1',
        name: 'Handbook',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 1536,
        tokenCount: 12_345,
        documentCount: 19,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-09T00:00:00.000Z'),
      })
    )

    expect(table.rowCount).toBe(137)
    expect(knowledgeBase.documentCount).toBe(19)
  })
})

describe('serializeKBMeta', () => {
  const baseKb = {
    id: 'kb-1',
    name: 'Support Docs',
    description: null,
    embeddingModel: 'text-embedding-3-small',
    embeddingDimension: 1536,
    tokenCount: 42,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    documentCount: 3,
  }

  it('includes tag definitions when present', () => {
    const json = JSON.parse(
      serializeKBMeta({
        ...baseKb,
        tagDefinitions: [
          { tagName: 'Important', tagSlot: 'tag1', fieldType: 'text' },
          { tagName: 'Department', tagSlot: 'tag2', fieldType: 'text' },
        ],
      })
    )

    const textOperators = ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with']
    expect(json.tagDefinitions).toEqual([
      { tagName: 'Important', tagSlot: 'tag1', fieldType: 'text', operators: textOperators },
      { tagName: 'Department', tagSlot: 'tag2', fieldType: 'text', operators: textOperators },
    ])
  })

  // `between` is legal for number/date but not text/boolean -- the agent cannot infer this.
  it.each([
    ['number', ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between']],
    ['date', ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between']],
    ['boolean', ['eq', 'neq']],
  ])('exposes the operators legal for a %s tag', (fieldType, expected) => {
    const json = JSON.parse(
      serializeKBMeta({
        ...baseKb,
        tagDefinitions: [{ tagName: 'Tag', tagSlot: 'tag1', fieldType }],
      })
    )

    expect(json.tagDefinitions[0].operators).toEqual(expected)
  })

  it('emits an empty operator list for an unrecognized field type rather than throwing', () => {
    const json = JSON.parse(
      serializeKBMeta({
        ...baseKb,
        tagDefinitions: [{ tagName: 'Tag', tagSlot: 'tag1', fieldType: 'mystery' }],
      })
    )

    expect(json.tagDefinitions[0].operators).toEqual([])
  })

  it('omits tag definitions when empty or undefined', () => {
    const empty = JSON.parse(serializeKBMeta({ ...baseKb, tagDefinitions: [] }))
    const missing = JSON.parse(serializeKBMeta(baseKb))

    expect(empty).not.toHaveProperty('tagDefinitions')
    expect(missing).not.toHaveProperty('tagDefinitions')
  })
})
