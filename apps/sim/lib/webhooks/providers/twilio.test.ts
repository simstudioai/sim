import crypto from 'crypto'
import { createMockRequest } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { twilioHandler } from '@/lib/webhooks/providers/twilio'

/** Twilio canonical signature: HMAC-SHA1(authToken, url + sorted(key+value)) base64. */
function signTwilio(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64')
}

describe('twilioHandler', () => {
  describe('verifyAuth', () => {
    const authToken = 'test-auth-token'
    const url = 'http://localhost:3000/api/test'
    const params = { From: '+15551234567', To: '+15557654321', Body: 'hello', MessageSid: 'SM123' }
    const rawBody = new URLSearchParams(params).toString()
    const signature = signTwilio(authToken, url, params)

    it('rejects a request with an invalid signature', async () => {
      const request = createMockRequest('POST', undefined, {
        'x-twilio-signature': 'not-the-real-signature',
      })
      const res = await twilioHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: { authToken },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('accepts a request with a valid signature', async () => {
      const request = createMockRequest('POST', undefined, {
        'x-twilio-signature': signature,
      })
      const res = await twilioHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: { authToken },
        webhook: {},
        workflow: {},
      })
      expect(res).toBeNull()
    })

    it('skips verification when no auth token is configured (optional-secret convention)', async () => {
      const request = createMockRequest('POST', undefined, {})
      const res = await twilioHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: {},
        webhook: {},
        workflow: {},
      })
      expect(res).toBeNull()
    })

    it('reconstructs the public URL from forwarding headers when validating', async () => {
      const publicUrl = 'https://sim.ai/api/webhooks/trigger/twilio-sms-abc123'
      const fwdSignature = signTwilio(authToken, publicUrl, params)
      const request = createMockRequest(
        'POST',
        undefined,
        {
          'x-twilio-signature': fwdSignature,
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'sim.ai',
        },
        'http://internal-host:3000/api/webhooks/trigger/twilio-sms-abc123'
      )
      const res = await twilioHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: { authToken },
        webhook: {},
        workflow: {},
      })
      expect(res).toBeNull()
    })

    it('rejects a forged body even with a forwarded host (no valid token)', async () => {
      const request = createMockRequest(
        'POST',
        undefined,
        {
          'x-twilio-signature': signTwilio('attacker-guess', url, params),
          'x-forwarded-host': 'sim.ai',
        },
        url
      )
      const res = await twilioHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: { authToken },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })
  })

  describe('extractIdempotencyId', () => {
    it('keys status callbacks by SID + status so each delivery state is distinct', () => {
      const sent = twilioHandler.extractIdempotencyId!({ MessageSid: 'SM1', MessageStatus: 'sent' })
      const delivered = twilioHandler.extractIdempotencyId!({
        MessageSid: 'SM1',
        MessageStatus: 'delivered',
      })
      expect(sent).toBe('SM1:sent')
      expect(delivered).toBe('SM1:delivered')
      expect(sent).not.toBe(delivered)
    })
  })

  describe('matchEvent', () => {
    const match = (triggerId: string, body: Record<string, unknown>) =>
      twilioHandler.matchEvent!({
        body,
        request: new Request('http://localhost/test') as never,
        rawBody: '',
        requestId: 'r1',
        providerConfig: { triggerId },
        webhook: {},
        workflow: {},
      })

    const inbound = { MessageSid: 'SM1', From: '+1', Body: 'hi', SmsStatus: 'received' }
    const status = { MessageSid: 'SM1', MessageStatus: 'delivered', SmsStatus: 'delivered' }

    it('routes inbound messages only to the received trigger', () => {
      expect(match('twilio_sms_received', inbound)).toBe(true)
      expect(match('twilio_sms_status', inbound)).toBe(false)
    })

    it('matches neither trigger for an ambiguous payload missing status fields', () => {
      const ambiguous = { MessageSid: 'SM1', From: '+1' }
      expect(match('twilio_sms_received', ambiguous)).toBe(false)
      expect(match('twilio_sms_status', ambiguous)).toBe(false)
    })
  })

  describe('formatInput', () => {
    const ctx = (body: Record<string, unknown>) => ({
      webhook: {},
      workflow: { id: 'wf1', userId: 'u1' },
      body,
      headers: {},
      requestId: 'r1',
    })

    it('extracts MMS media items from NumMedia / MediaUrl{N}', async () => {
      const body = {
        MessageSid: 'MM123',
        NumMedia: '2',
        MediaUrl0: 'https://api.twilio.com/media/0',
        MediaContentType0: 'image/jpeg',
        MediaUrl1: 'https://api.twilio.com/media/1',
        MediaContentType1: 'image/png',
      }
      const { input } = await twilioHandler.formatInput!(ctx(body))
      const i = input as Record<string, unknown>
      expect(i.media).toEqual([
        { url: 'https://api.twilio.com/media/0', contentType: 'image/jpeg' },
        { url: 'https://api.twilio.com/media/1', contentType: 'image/png' },
      ])
    })
  })
})
