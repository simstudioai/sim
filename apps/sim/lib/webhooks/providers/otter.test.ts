/**
 * Pins the Otter webhook wire contract: which deliveries start a workflow and which collapse
 * onto an earlier run. Otter sends no signature or delivery ID, so event matching and the
 * idempotency key are the only guards between a delivery and a duplicate or spurious run.
 */
import { describe, expect, it } from 'vitest'
import { otterHandler } from '@/lib/webhooks/providers/otter'

/** A delivery shaped like the documented workspace webhook payload. */
function delivery(event: string | undefined, retrievedAt = '2026-09-28T12:00:00+00:00') {
  return {
    meta: {
      retrieved_at: retrievedAt,
      webhook: {
        name: '#Customer Calls',
        source_type: 'channel',
        ...(event === undefined ? {} : { event }),
        source: {
          id: 'ch1',
          name: 'Customer Calls',
          member_count: 3,
          discoverability: 'workspace',
        },
      },
    },
    data: { id: 'conv1', title: 'Launch sync', relationships: {} },
  }
}

const matches = (triggerId: string, body: unknown) =>
  otterHandler.matchEvent!({ body, providerConfig: { triggerId }, requestId: 'r' } as never)
const key = (body: unknown) => otterHandler.extractIdempotencyId!(body)

describe('Otter webhook provider', () => {
  it('matches both documented spellings of an event', async () => {
    expect(await matches('otter_conversation_completed', delivery('conversation_completed'))).toBe(
      true
    )
    expect(await matches('otter_conversation_shared', delivery('conversation.shared'))).toBe(true)
    expect(await matches('otter_conversation_shared', delivery('conversation_completed'))).toBe(
      false
    )
  })

  it('requires an event name for typed triggers but not for all events', async () => {
    expect(await matches('otter_conversation_completed', delivery(undefined))).toBe(false)
    expect(await matches('otter_webhook', delivery(undefined))).toBe(true)
  })

  it('collapses completed retries even when their assembly time differs', () => {
    expect(key(delivery('conversation_completed', '2026-09-28T12:00:00+00:00'))).toBe(
      key(delivery('conversation.completed', '2026-09-28T12:01:30+00:00'))
    )
  })

  it('keeps separate shares of the same conversation to the same source distinct', () => {
    const first = key(delivery('conversation_shared', '2026-09-28T12:00:00+00:00'))
    expect(first).toBe(key(delivery('conversation_shared', '2026-09-28T12:00:00+00:00')))
    expect(first).not.toBe(key(delivery('conversation_shared', '2026-10-02T09:00:00+00:00')))
  })
})
