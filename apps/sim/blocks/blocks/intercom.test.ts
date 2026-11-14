import { describe, expect, it } from 'vitest'
import { IntercomV2Block } from '@/blocks/blocks/intercom'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = IntercomV2Block.tools.config?.params
  if (!mapper) throw new Error('Intercom block has no params mapper')
  return mapper(params, context)
}

describe('Intercom snooze timestamps', () => {
  it('sends a positive whole Unix timestamp as a number', () => {
    expect(
      mapParams({
        operation: 'snooze_conversation',
        conversationId: 'c1',
        admin_id: 'a1',
        snoozed_until: '1767225600',
      }).snoozed_until
    ).toBe(1767225600)
  })

  it.each(['0', '-5', '   ', '1.5', 0])('rejects %j as a snooze time', (snoozedUntil) => {
    expect(() =>
      mapParams({
        operation: 'snooze_conversation',
        conversationId: 'c1',
        admin_id: 'a1',
        snoozed_until: snoozedUntil,
      })
    ).toThrow('positive whole Unix timestamp')
  })
})

describe('Intercom agent operation resolution', () => {
  it('keeps a boolean disable_notifications when the operation arrives only in the context', () => {
    const mapped = mapParams(
      { ticket_type_id: 't1', disable_notifications: true },
      { operation: 'create_ticket' }
    )

    expect(mapped.disable_notifications).toBe(true)
  })
})
