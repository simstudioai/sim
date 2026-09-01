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

    it('rejects when Standard Webhooks headers are missing', async () => {
      const rawBody = JSON.stringify({ event_type: 'note.generated' })

      const res = await granolaHandler.verifyAuth!({
        ...baseAuthCtx,
        request: requestWithHeaders('evt_1', nowSeconds()),
        rawBody,
        requestId: 'granola-t2',
        providerConfig: { signingSecret: SIGNING_SECRET },
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

    it('matches an event the trigger subscribes to', async () => {
      await expect(
        granolaHandler.matchEvent!({
          ...matchCtx,
          body: { event_type: 'note.edited' },
          providerConfig: { triggerId: 'granola_note_edited' },
        })
      ).resolves.toBe(true)
    })

    it('skips an event the trigger does not subscribe to', async () => {
      await expect(
        granolaHandler.matchEvent!({
          ...matchCtx,
          body: { event_type: 'note.generated' },
          providerConfig: { triggerId: 'granola_note_edited' },
        })
      ).resolves.toBe(false)
    })

    it('matches every note event for the all-events trigger', async () => {
      for (const eventType of ['note.generated', 'note.edited', 'note.access_granted']) {
        await expect(
          granolaHandler.matchEvent!({
            ...matchCtx,
            body: { event_type: eventType },
            providerConfig: { triggerId: 'granola_webhook' },
          })
        ).resolves.toBe(true)
      }
    })
  })

  describe('formatInput', () => {
    it('maps a note.generated payload onto the trigger outputs', async () => {
      const body = {
        event_id: '8f1c2a4e-6b3d-4e8f-9a2b-1c5d7e9f0a3b',
        event_type: 'note.generated',
        note_id: 'not_1d3tmYTlCICgjy',
        occurred_at: '2026-01-27T15:30:00Z',
      }

      const result = await granolaHandler.formatInput!({
        webhook: {},
        workflow: {},
        body,
        requestId: 'granola-fmt1',
      } as never)

      expect(result.input).toEqual({
        event_id: '8f1c2a4e-6b3d-4e8f-9a2b-1c5d7e9f0a3b',
        event_type: 'note.generated',
        note_id: 'not_1d3tmYTlCICgjy',
        occurred_at: '2026-01-27T15:30:00Z',
        changed_fields: null,
        payload: body,
      })
    })

    it('surfaces changed_fields on a note.edited payload', async () => {
      const result = await granolaHandler.formatInput!({
        webhook: {},
        workflow: {},
        body: {
          event_id: 'evt_2',
          event_type: 'note.edited',
          note_id: 'not_2',
          occurred_at: '2026-01-27T16:00:00Z',
          data: { changed_fields: ['summary'] },
        },
        requestId: 'granola-fmt2',
      } as never)

      expect(result.input.changed_fields).toEqual(['summary'])
    })
  })

  describe('extractIdempotencyId', () => {
    it('keys on event_id, which Granola reuses across retries', () => {
      expect(
        granolaHandler.extractIdempotencyId!({ event_id: 'evt_9', event_type: 'note.edited' })
      ).toBe('evt_9')
    })

    it('returns null when no event_id is present', () => {
      expect(granolaHandler.extractIdempotencyId!({ event_type: 'note.edited' })).toBeNull()
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

    it('registers an endpoint scoped to the trigger events and returns system-managed fields', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: 'whe_2mKr8fQxLp7Ta3', signing_secret: SIGNING_SECRET }),
      })

      const result = await granolaHandler.createSubscription!({
        webhook: {
          id: 'wh_1',
          path: 'abc123',
          providerConfig: {
            apiKey: 'grn_key',
            triggerId: 'granola_note_edited',
            scopes: 'personal, public',
            folderIds: 'fol_2mKr8fQxLp7Ta3',
          },
        },
        requestId: 'granola-sub1',
      } as never)

      expect(result?.providerConfigUpdates).toEqual({
        externalId: 'whe_2mKr8fQxLp7Ta3',
        signingSecret: SIGNING_SECRET,
        eventTypes: ['note.edited'],
      })

      const [, init] = fetchMock.mock.calls[0]
      const sent = JSON.parse(init.body)
      expect(sent.events).toEqual(['note.edited'])
      expect(sent.scopes).toEqual(['personal', 'public'])
      expect(sent.folder_ids).toEqual(['fol_2mKr8fQxLp7Ta3'])
    })

    it('defaults scopes when the field is left blank', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: 'whe_1', signing_secret: SIGNING_SECRET }),
      })

      await granolaHandler.createSubscription!({
        webhook: {
          id: 'wh_2',
          path: 'p2',
          providerConfig: { apiKey: 'grn_key', triggerId: 'granola_webhook', scopes: '' },
        },
        requestId: 'granola-sub2',
      } as never)

      const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(sent.scopes).toEqual(['personal', 'public'])
      expect(sent.folder_ids).toBeUndefined()
    })

    it('throws a plan-specific message when the workspace has no webhooks API', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' })

      await expect(
        granolaHandler.createSubscription!({
          webhook: { id: 'wh_3', path: 'p3', providerConfig: { apiKey: 'grn_key' } },
          requestId: 'granola-sub3',
        } as never)
      ).rejects.toThrow(/Business or Enterprise plan/)
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

    it('does not attempt cleanup when Granola rejected the request outright', async () => {
      /* A non-2xx means no endpoint was created, so a recovery listing would be pure noise. */
      fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => 'scope disabled' })

      await expect(
        granolaHandler.createSubscription!({
          webhook: { id: 'wh_11', path: 'p11', providerConfig: { apiKey: 'grn_key' } },
          requestId: 'granola-orphan4',
        } as never)
      ).rejects.toThrow(/scope/i)

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

    it('throws when the API key is missing so the deploy rolls back', async () => {
      await expect(
        granolaHandler.createSubscription!({
          webhook: { id: 'wh_4', path: 'p4', providerConfig: {} },
          requestId: 'granola-sub4',
        } as never)
      ).rejects.toThrow(/API Key is required/)

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('deletes the endpoint it created', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 })

      await granolaHandler.deleteSubscription!({
        webhook: { id: 'wh_5', providerConfig: { apiKey: 'grn_key', externalId: 'whe_5' } },
        requestId: 'granola-del1',
      } as never)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://public-api.granola.ai/v1/webhook-endpoints/whe_5')
      expect(init.method).toBe('DELETE')
    })

    it('treats an already-deleted endpoint as success', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 })

      await expect(
        granolaHandler.deleteSubscription!({
          webhook: { id: 'wh_6', providerConfig: { apiKey: 'grn_key', externalId: 'whe_6' } },
          requestId: 'granola-del2',
          strict: true,
        } as never)
      ).resolves.toBeUndefined()
    })

    it('does not throw on delete failures unless strict', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 })

      await expect(
        granolaHandler.deleteSubscription!({
          webhook: { id: 'wh_7', providerConfig: { apiKey: 'grn_key', externalId: 'whe_7' } },
          requestId: 'granola-del3',
        } as never)
      ).resolves.toBeUndefined()

      await expect(
        granolaHandler.deleteSubscription!({
          webhook: { id: 'wh_7', providerConfig: { apiKey: 'grn_key', externalId: 'whe_7' } },
          requestId: 'granola-del4',
          strict: true,
        } as never)
      ).rejects.toThrow()
    })
  })
})
