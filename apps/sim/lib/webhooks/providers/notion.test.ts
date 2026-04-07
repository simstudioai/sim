import { describe, expect, it } from 'vitest'
import { notionHandler } from '@/lib/webhooks/providers/notion'
import { isNotionPayloadMatch } from '@/triggers/notion/utils'

describe('Notion webhook provider', () => {
  it('matches both legacy and newer schema updated event names', () => {
    expect(
      isNotionPayloadMatch('notion_database_schema_updated', {
        type: 'database.schema_updated',
      })
    ).toBe(true)

    expect(
      isNotionPayloadMatch('notion_database_schema_updated', {
        type: 'data_source.schema_updated',
      })
    ).toBe(true)
  })

  it('builds a stable idempotency key from event type and id', () => {
    const key = notionHandler.extractIdempotencyId!({
      id: 'evt_123',
      type: 'page.created',
    })

    expect(key).toBe('notion:page.created:evt_123')
  })
})
