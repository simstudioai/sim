/**
 * @vitest-environment node
 */
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

    it('rejects a forged request with no signature header', async () => {
      const request = createMockRequest('POST', undefined, {
        'content-type': 'application/x-www-form-urlencoded',
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
    it('prefers MessageSid, falls back to CallSid', () => {
      expect(twilioHandler.extractIdempotencyId!({ MessageSid: 'SM1' })).toBe('SM1')
      expect(twilioHandler.extractIdempotencyId!({ CallSid: 'CA1' })).toBe('CA1')
      expect(twilioHandler.extractIdempotencyId!({})).toBeNull()
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

    it('maps inbound SMS params to aligned output keys', async () => {
      const body = {
        MessageSid: 'SM123',
        AccountSid: 'AC123',
        From: '+15551234567',
        To: '+15557654321',
        Body: 'hello world',
        NumMedia: '0',
        NumSegments: '1',
        SmsStatus: 'received',
        ApiVersion: '2010-04-01',
        FromCity: 'SAN FRANCISCO',
        FromState: 'CA',
        FromCountry: 'US',
      }
      const { input } = await twilioHandler.formatInput!(ctx(body))
      const i = input as Record<string, unknown>
      expect(i.messageSid).toBe('SM123')
      expect(i.from).toBe('+15551234567')
      expect(i.to).toBe('+15557654321')
      expect(i.body).toBe('hello world')
      expect(i.smsStatus).toBe('received')
      expect(i.numMedia).toBe('0')
      expect(i.media).toEqual([])
      expect(i.fromCity).toBe('SAN FRANCISCO')
      expect(i.raw).toBe(JSON.stringify(body))
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

    it('maps status-callback params including ErrorCode on failure', async () => {
      const body = {
        MessageSid: 'SM999',
        MessageStatus: 'failed',
        SmsStatus: 'failed',
        ErrorCode: '30008',
        From: '+15550000000',
        To: '+15551111111',
      }
      const { input } = await twilioHandler.formatInput!(ctx(body))
      const i = input as Record<string, unknown>
      expect(i.messageStatus).toBe('failed')
      expect(i.errorCode).toBe('30008')
      expect(i.media).toEqual([])
    })
  })
})
