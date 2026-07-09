/**
 * @vitest-environment node
 */
import crypto from 'crypto'
import { createMockRequest } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { twilioVoiceHandler } from '@/lib/webhooks/providers/twilio-voice'

/** Twilio canonical signature: HMAC-SHA1(authToken, url + sorted(key+value)) base64. */
function signTwilio(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64')
}

describe('twilioVoiceHandler', () => {
  describe('verifyAuth', () => {
    const authToken = 'voice-auth-token'
    const url = 'http://localhost:3000/api/test'
    const params = { CallSid: 'CA123', From: '+15551234567', To: '+15557654321' }
    const rawBody = new URLSearchParams(params).toString()
    const signature = signTwilio(authToken, url, params)

    it('skips verification when no auth token is configured', async () => {
      const request = createMockRequest('POST', undefined, {})
      const res = await twilioVoiceHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: {},
        webhook: {},
        workflow: {},
      })
      expect(res).toBeNull()
    })

    it('returns 401 when the signature header is missing', async () => {
      const request = createMockRequest('POST', undefined, {})
      const res = await twilioVoiceHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: { authToken },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('returns 401 when the signature is invalid', async () => {
      const request = createMockRequest('POST', undefined, { 'x-twilio-signature': 'bad' })
      const res = await twilioVoiceHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: { authToken },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('returns null when the signature is valid', async () => {
      const request = createMockRequest('POST', undefined, { 'x-twilio-signature': signature })
      const res = await twilioVoiceHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: { authToken },
        webhook: {},
        workflow: {},
      })
      expect(res).toBeNull()
    })
  })

  describe('extractIdempotencyId', () => {
    it('prefers MessageSid, falls back to CallSid', () => {
      expect(twilioVoiceHandler.extractIdempotencyId!({ MessageSid: 'SM1' })).toBe('SM1')
      expect(twilioVoiceHandler.extractIdempotencyId!({ CallSid: 'CA1' })).toBe('CA1')
      expect(twilioVoiceHandler.extractIdempotencyId!({})).toBeNull()
    })

    it('returns null instead of throwing when body is not a record', () => {
      expect(twilioVoiceHandler.extractIdempotencyId!(null)).toBeNull()
      expect(twilioVoiceHandler.extractIdempotencyId!(undefined)).toBeNull()
      expect(twilioVoiceHandler.extractIdempotencyId!('not-an-object')).toBeNull()
      expect(twilioVoiceHandler.extractIdempotencyId!([1, 2, 3])).toBeNull()
    })

    it('distinguishes each CallStatus transition for the same CallSid', () => {
      const ringing = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'ringing',
      })
      const inProgress = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'in-progress',
      })
      const completed = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'completed',
      })
      expect(ringing).not.toBeNull()
      expect(ringing).not.toBe(inProgress)
      expect(inProgress).not.toBe(completed)
    })

    it('dedupes a retried delivery of the same CallStatus transition', () => {
      const first = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'completed',
      })
      const retry = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'completed',
      })
      expect(first).toBe(retry)
    })
  })

  describe('formatInput', () => {
    it('degrades to empty output instead of throwing when body is not a record', async () => {
      const { input } = await twilioVoiceHandler.formatInput!({
        webhook: {},
        workflow: { id: 'wf1', userId: 'u1' },
        body: null,
        headers: {},
        requestId: 'r1',
      })
      const i = input as Record<string, unknown>
      expect(i.callSid).toBeUndefined()
      expect(i.raw).toBe('{}')
    })
  })
})
