import { describe, expect, it } from 'vitest'
import { IntercomV2Block } from '@/blocks/blocks/intercom'

function mapParams(params: Record<string, unknown>) {
  const mapper = IntercomV2Block.tools.config?.params
  if (!mapper) throw new Error('Intercom block has no params mapper')
  return mapper(params)
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

  it.each(['0', '-5', '   ', '1.5'])('rejects %j as a snooze time', (snoozedUntil) => {
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
