import { describe, expect, it } from 'vitest'
import { sendblueHandler } from '@/lib/webhooks/providers/sendblue'

const inboundBody = {
  accountEmail: 'me@example.com',
  content: 'hello',
  media_url: '',
  is_outbound: false,
  status: 'RECEIVED',
  message_handle: 'handle-123',
  from_number: '+19998887777',
  number: '+18887776666',
  group_id: '',
}

const outboundBody = {
  ...inboundBody,
  is_outbound: true,
  status: 'SENT',
}

describe('sendblueHandler', () => {
  describe('matchEvent', () => {
    it('matches an inbound message for the message_received trigger', () => {
      expect(
        sendblueHandler.matchEvent!({
          body: inboundBody,
          webhook: { providerConfig: { triggerId: 'sendblue_message_received' } },
          requestId: 'r1',
        } as any)
      ).toBe(true)
    })

    it('rejects an outbound event for the message_received trigger', () => {
      expect(
        sendblueHandler.matchEvent!({
          body: outboundBody,
          webhook: { providerConfig: { triggerId: 'sendblue_message_received' } },
          requestId: 'r1',
        } as any)
      ).toBe(false)
    })
  })

  describe('extractIdempotencyId', () => {
    it('suffixes the status so SENT and DELIVERED on one handle stay distinct', () => {
      expect(
        sendblueHandler.extractIdempotencyId!({ message_handle: 'handle-123', status: 'DELIVERED' })
      ).toBe('handle-123:DELIVERED')
    })
  })
})
