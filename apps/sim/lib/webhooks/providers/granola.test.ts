import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { granolaHandler } from '@/lib/webhooks/providers/granola'

const SECRET_BYTES = Buffer.from('granola-test-secret-key-padding!!!!!')
const SIGNING_SECRET = `whsec_${SECRET_BYTES.toString('base64')}`

function signGranolaBody(msgId: string, timestamp: string, rawBody: string): string {
  const sig = crypto
    .createHmac('sha256', SECRET_BYTES)
    .update(`${msgId}.${timestamp}.${rawBody}`, 'utf8')
    .digest('base64')
  return `v1,${sig}`
}

function requestWithHeaders(msgId: string, timestamp: string, signature?: string): NextRequest {
  const headers: Record<string, string> = {
    'webhook-id': msgId,
    'webhook-timestamp': timestamp,
  }
  if (signature !== undefined) headers['webhook-signature'] = signature
  return new NextRequest('http://localhost/test', { headers })
}

const baseAuthCtx = { webhook: {}, workflow: {}, rawBody: '' }

const nowSeconds = () => `${Math.floor(Date.now() / 1000)}`

describe('Granola webhook provider', () => {
  describe('verifyAuth', () => {
    it('rejects when the signing secret is missing', async () => {
      const res = await granolaHandler.verifyAuth!({
        ...baseAuthCtx,
        request: requestWithHeaders('evt_1', nowSeconds(), 'v1,x'),
        rawBody: '{}',
        requestId: 'granola-t1',
        providerConfig: {},
      })

      expect(res?.status).toBe(401)
    })

    it('accepts a correctly signed delivery', async () => {
      const rawBody = JSON.stringify({ event_type: 'note.generated', note_id: 'not_1' })
      const ts = nowSeconds()

      const res = await granolaHandler.verifyAuth!({
        ...baseAuthCtx,
        request: requestWithHeaders('evt_1', ts, signGranolaBody('evt_1', ts, rawBody)),
        rawBody,
        requestId: 'granola-t3',
        providerConfig: { signingSecret: SIGNING_SECRET },
      })

      expect(res).toBeNull()
    })

    it('rejects a signature computed over a different body', async () => {
      const ts = nowSeconds()
      const signature = signGranolaBody('evt_1', ts, '{"event_type":"note.generated"}')

      const res = await granolaHandler.verifyAuth!({
        ...baseAuthCtx,
        request: requestWithHeaders('evt_1', ts, signature),
        rawBody: '{"event_type":"note.edited"}',
        requestId: 'granola-t4',
        providerConfig: { signingSecret: SIGNING_SECRET },
      })

      expect(res?.status).toBe(401)
    })

    it('rejects a replayed delivery outside the timestamp tolerance', async () => {
      const rawBody = JSON.stringify({ event_type: 'note.generated' })
      const staleTs = `${Math.floor(Date.now() / 1000) - 10 * 60}`

      const res = await granolaHandler.verifyAuth!({
        ...baseAuthCtx,
        request: requestWithHeaders('evt_1', staleTs, signGranolaBody('evt_1', staleTs, rawBody)),
        rawBody,
        requestId: 'granola-t5',
        providerConfig: { signingSecret: SIGNING_SECRET },
      })

      expect(res?.status).toBe(401)
    })

    it('accepts when one of several space-separated signatures matches', async () => {
      const rawBody = JSON.stringify({ event_type: 'note.generated' })
      const ts = nowSeconds()
      const valid = signGranolaBody('evt_1', ts, rawBody)

      const res = await granolaHandler.verifyAuth!({
        ...baseAuthCtx,
        request: requestWithHeaders('evt_1', ts, `v1,bogussignature ${valid}`),
        rawBody,
        requestId: 'granola-t6',
        providerConfig: { signingSecret: SIGNING_SECRET },
      })

      expect(res).toBeNull()
    })
  })

  describe('matchEvent', () => {
    const matchCtx = { webhook: {}, workflow: {}, requestId: 'granola-match' }

    it('skips an event the trigger does not subscribe to', async () => {
      await expect(
        granolaHandler.matchEvent!({
          ...matchCtx,
          body: { event_type: 'note.generated' },
          providerConfig: { triggerId: 'granola_note_edited' },
        })
      ).resolves.toBe(false)
    })
  })

  describe('extractIdempotencyId', () => {
    it('keys on event_id, which Granola reuses across retries', () => {
      expect(
        granolaHandler.extractIdempotencyId!({ event_id: 'evt_9', event_type: 'note.edited' })
      ).toBe('evt_9')
    })
  })

  describe('subscription lifecycle', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
      fetchMock.mockReset()
      vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('deletes the endpoint when a 2xx response omits the signing secret', async () => {
      /**
       * The registration service only rolls back external state when createSubscription
       * RETURNS, so a handler that throws must not leave an endpoint behind — it would keep
       * delivering to a path whose signature can never be verified, with no id recorded for
       * undeploy to clean up, and duplicate on every retry.
       */
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 'whe_orphan' }),
      })
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200 })

      await expect(
        granolaHandler.createSubscription!({
          webhook: { id: 'wh_8', path: 'p8', providerConfig: { apiKey: 'grn_key' } },
          requestId: 'granola-orphan1',
        } as never)
      ).rejects.toThrow(/signing secret|ID and signing/)

      const [url, init] = fetchMock.mock.calls[1]
      expect(init.method).toBe('DELETE')
      expect(url).toBe('https://public-api.granola.ai/v1/webhook-endpoints/whe_orphan')
    })

    it('leaves the endpoint alone when the response carries no id', async () => {
      /**
       * A redeploy reuses the live registration's path, so the candidate and the currently
       * serving endpoint share a callback URL. Recovering by URL would delete the live
       * deployment's endpoint and kill a working trigger, so with no id there is nothing safe
       * to do — leaking beats taking down live traffic. This asserts no lookup or delete is
       * attempted, guarding against reintroducing URL matching.
       */
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({}),
      })

      await expect(
        granolaHandler.createSubscription!({
          webhook: { id: 'wh_9', path: 'p9', providerConfig: { apiKey: 'grn_key' } },
          requestId: 'granola-orphan2',
        } as never)
      ).rejects.toThrow()

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('still surfaces the original error when orphan cleanup itself fails', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 'whe_orphan' }),
      })
      fetchMock.mockRejectedValueOnce(new Error('network down'))

      await expect(
        granolaHandler.createSubscription!({
          webhook: { id: 'wh_12', path: 'p12', providerConfig: { apiKey: 'grn_key' } },
          requestId: 'granola-orphan5',
        } as never)
      ).rejects.toThrow(/signing secret|ID and signing/)
    })
  })
})
