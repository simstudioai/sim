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
})
