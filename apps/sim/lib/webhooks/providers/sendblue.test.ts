/**
 * @vitest-environment node
 */
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

    it('matches an outbound status update for the message_status_updated trigger', () => {
      expect(
        sendblueHandler.matchEvent!({
          body: outboundBody,
          webhook: { providerConfig: { triggerId: 'sendblue_message_status_updated' } },
          requestId: 'r1',
        } as any)
      ).toBe(true)
    })

    it('passes through when the triggerId is unknown or unset', () => {
      expect(
        sendblueHandler.matchEvent!({
          body: inboundBody,
          webhook: {},
          requestId: 'r1',
        } as any)
      ).toBe(true)
    })

    it('rejects a non-object payload for a known trigger', () => {
      expect(
        sendblueHandler.matchEvent!({
          body: 'not-an-object',
          webhook: { providerConfig: { triggerId: 'sendblue_message_received' } },
          requestId: 'r1',
        } as any)
      ).toBe(false)
    })
  })

  describe('extractIdempotencyId', () => {
    it('uses the message handle alone when no status is present', () => {
      expect(sendblueHandler.extractIdempotencyId!({ message_handle: 'handle-123' })).toBe(
        'handle-123'
      )
    })

    it('suffixes the status so SENT and DELIVERED on one handle stay distinct', () => {
      expect(
        sendblueHandler.extractIdempotencyId!({ message_handle: 'handle-123', status: 'DELIVERED' })
      ).toBe('handle-123:DELIVERED')
    })

    it('returns null when no message handle is present', () => {
      expect(sendblueHandler.extractIdempotencyId!({})).toBeNull()
      expect(sendblueHandler.extractIdempotencyId!('nope')).toBeNull()
    })
  })

  describe('formatInput', () => {
    it('returns the payload under input with empty strings normalized to null', async () => {
      const result = await sendblueHandler.formatInput!({ body: inboundBody } as any)
      expect(result.input.account_email).toBe('me@example.com')
      expect(result.input.media_url).toBeNull()
      expect(result.input.group_id).toBeNull()
      expect(result.input.is_outbound).toBe(false)
      expect(result.input.participants).toEqual([])
      expect(result.input.raw).toBe(JSON.stringify(inboundBody))
    })

    it('defaults missing fields to null and tolerates a non-object body', async () => {
      const result = await sendblueHandler.formatInput!({ body: undefined } as any)
      expect(result.input.message_handle).toBeNull()
      expect(result.input.content).toBeNull()
      expect(result.input.participants).toEqual([])
    })
  })
})
