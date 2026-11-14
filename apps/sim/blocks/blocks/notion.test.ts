import { triggersMock } from '@sim/testing/mocks/triggers.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => triggersMock)

import { NotionV2Block } from '@/blocks/blocks/notion'

describe('Notion agent operation resolution', () => {
  const mapper = NotionV2Block.tools.config?.params
  if (!mapper) throw new Error('Notion block has no params mapper')

  it('parses page properties set in the tool row when the operation is in the context', () => {
    const mapped = mapper(
      { databaseId: 'db-1', properties: '{"Status":{"select":{"name":"Done"}}}' },
      { operation: 'notion_add_database_row' }
    )

    expect(mapped.properties).toEqual({ Status: { select: { name: 'Done' } } })
  })

  it('accepts an already parsed query filter from the model', () => {
    const filter = { property: 'Status', select: { equals: 'Done' } }
    const mapped = mapper({ databaseId: 'db-1', filter }, { operation: 'notion_query_database' })

    expect(mapped.filter).toBe(JSON.stringify(filter))
  })
})
