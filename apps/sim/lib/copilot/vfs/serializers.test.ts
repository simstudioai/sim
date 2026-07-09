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
