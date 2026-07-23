import crypto from 'node:crypto'
import { resetEnvMock, setEnv } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rootlyHandler } from '@/lib/webhooks/providers/rootly'

function signRootlyBody(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}${rawBody}`, 'utf8').digest('hex')
}

function requestWithRootlySignature(
  secret: string,
  timestamp: string,
  rawBody: string
): NextRequest {
  const signature = signRootlyBody(secret, timestamp, rawBody)
  return new NextRequest('http://localhost/test', {
    headers: {
      'X-Rootly-Signature': `t=${timestamp},v1=${signature}`,
    },
  })
}

describe('Rootly webhook provider', () => {
  it('accepts a correctly signed request within the allowed timestamp window', async () => {
    const secret = 'rootly-secret'
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const rawBody = JSON.stringify({
      event: { id: 'evt-1', type: 'incident.created', issued_at: '2022-11-27T19:44:33.633-08:00' },
      data: { id: 'inc-1', title: 'Sparkling Frost' },
    })

    const res = await rootlyHandler.verifyAuth!({
      request: requestWithRootlySignature(secret, timestamp, rawBody),
      rawBody,
      requestId: 'rootly-t1',
      providerConfig: { webhookSecret: secret },
      webhook: {},
      workflow: {},
    })

    expect(res).toBeNull()
  })

  it('rejects when the signing secret is missing from config (fail-closed)', async () => {
    const rawBody = JSON.stringify({ event: { id: 'evt-1', type: 'incident.created' }, data: {} })

    const res = await rootlyHandler.verifyAuth!({
      request: new NextRequest('http://localhost/test'),
      rawBody,
      requestId: 'rootly-t1b',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })

    expect(res?.status).toBe(401)
  })

  it('rejects a request with an invalid signature', async () => {
    const secret = 'rootly-secret'
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const rawBody = JSON.stringify({ event: { id: 'evt-1', type: 'incident.created' }, data: {} })

    const req = new NextRequest('http://localhost/test', {
      headers: { 'X-Rootly-Signature': `t=${timestamp},v1=deadbeef` },
    })

    const res = await rootlyHandler.verifyAuth!({
      request: req,
      rawBody,
      requestId: 'rootly-t2',
      providerConfig: { webhookSecret: secret },
      webhook: {},
      workflow: {},
    })

    expect(res?.status).toBe(401)
  })

  it('rejects when the signature header is missing', async () => {
    const secret = 'rootly-secret'
    const rawBody = JSON.stringify({ event: { id: 'evt-1', type: 'incident.created' }, data: {} })

    const res = await rootlyHandler.verifyAuth!({
      request: new NextRequest('http://localhost/test'),
      rawBody,
      requestId: 'rootly-t3',
      providerConfig: { webhookSecret: secret },
      webhook: {},
      workflow: {},
    })

    expect(res?.status).toBe(401)
  })

  it('rejects when the timestamp skew is too large', async () => {
    const secret = 'rootly-secret'
    const timestamp = (Math.floor(Date.now() / 1000) - 600).toString()
    const rawBody = JSON.stringify({ event: { id: 'evt-1', type: 'incident.created' }, data: {} })

    const res = await rootlyHandler.verifyAuth!({
      request: requestWithRootlySignature(secret, timestamp, rawBody),
      rawBody,
      requestId: 'rootly-t4',
      providerConfig: { webhookSecret: secret },
      webhook: {},
      workflow: {},
    })

    expect(res?.status).toBe(401)
  })

  it('skips events that do not match the configured trigger', async () => {
    const body = { event: { id: 'evt-1', type: 'incident.updated' }, data: { id: 'inc-1' } }
    const matched = await rootlyHandler.matchEvent!({
      body,
      requestId: 'rootly-t5',
      providerConfig: { triggerId: 'rootly_incident_created' },
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
    })
    expect(matched).toBe(false)
  })

  it('matches events that match the configured trigger', async () => {
    const body = { event: { id: 'evt-1', type: 'incident.created' }, data: { id: 'inc-1' } }
    const matched = await rootlyHandler.matchEvent!({
      body,
      requestId: 'rootly-t6',
      providerConfig: { triggerId: 'rootly_incident_created' },
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
    })
    expect(matched).toBe(true)
  })

  it('formats input with keys matching the trigger outputs', async () => {
    const body = {
      event: { id: 'evt-1', type: 'incident.created', issued_at: '2022-11-27T19:44:33.633-08:00' },
      data: { id: 'inc-1', title: 'Sparkling Frost' },
    }
    const result = await rootlyHandler.formatInput!({
      body,
      webhook: {},
      workflow: { id: 'wf-1', userId: 'user-1' },
      headers: {},
      requestId: 'rootly-t7',
    })
    expect(result.input).toEqual({
      eventId: 'evt-1',
      eventType: 'incident.created',
      issuedAt: '2022-11-27T19:44:33.633-08:00',
      data: { id: 'inc-1', title: 'Sparkling Frost' },
    })
  })

  it('extracts the event id for idempotency', () => {
    const id = rootlyHandler.extractIdempotencyId!({
      event: { id: 'evt-1', type: 'incident.created' },
      data: {},
    })
    expect(id).toBe('evt-1')
  })

  describe('createSubscription', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
      setEnv({ NEXT_PUBLIC_APP_URL: 'https://app.test' })
      vi.stubGlobal('fetch', fetchMock)
      fetchMock.mockReset()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      resetEnvMock()
    })

    it('creates a Rootly endpoint with a generated secret and the mapped event type', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ data: { id: 'wh-123', type: 'webhooks_endpoints' } }),
      })

      const result = await rootlyHandler.createSubscription!({
        webhook: {
          id: 'webhook-1',
          path: 'abc-path',
          providerConfig: { apiKey: 'rootly-key', triggerId: 'rootly_incident_created' },
        },
        workflow: {},
        userId: 'user-1',
        requestId: 'req-create-1',
        request: new NextRequest('http://localhost/test'),
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.rootly.com/v1/webhooks/endpoints')
      expect(init.method).toBe('POST')
      const sent = JSON.parse(init.body)
      expect(sent.data.type).toBe('webhooks_endpoints')
      expect(sent.data.attributes.event_types).toEqual(['incident.created'])
      expect(typeof sent.data.attributes.secret).toBe('string')
      expect(sent.data.attributes.secret.length).toBeGreaterThan(0)
      expect(sent.data.attributes.url).toContain('/api/webhooks/trigger/abc-path')

      expect(result?.providerConfigUpdates?.externalId).toBe('wh-123')
      expect(result?.providerConfigUpdates?.webhookSecret).toBe(sent.data.attributes.secret)
    })

    it('subscribes to all event types when triggerId is generic/unknown', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ data: { id: 'wh-456' } }),
      })

      await rootlyHandler.createSubscription!({
        webhook: {
          id: 'webhook-2',
          path: 'p2',
          providerConfig: { apiKey: 'rootly-key', triggerId: 'rootly_webhook' },
        },
        workflow: {},
        userId: 'user-1',
        requestId: 'req-create-2',
        request: new NextRequest('http://localhost/test'),
      })

      const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(sent.data.attributes.event_types).toEqual([
        'incident.created',
        'incident.updated',
        'incident.resolved',
        'alert.created',
      ])
    })

    it('throws a friendly error on 401', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ errors: [{ detail: 'unauthorized' }] }),
      })

      await expect(
        rootlyHandler.createSubscription!({
          webhook: {
            id: 'webhook-3',
            path: 'p3',
            providerConfig: { apiKey: 'bad-key', triggerId: 'rootly_incident_created' },
          },
          workflow: {},
          userId: 'user-1',
          requestId: 'req-create-3',
          request: new NextRequest('http://localhost/test'),
        })
      ).rejects.toThrow(/Invalid Rootly API key/)
    })

    it('throws when apiKey is missing', async () => {
      await expect(
        rootlyHandler.createSubscription!({
          webhook: {
            id: 'webhook-4',
            path: 'p4',
            providerConfig: { triggerId: 'rootly_alert_created' },
          },
          workflow: {},
          userId: 'user-1',
          requestId: 'req-create-4',
          request: new NextRequest('http://localhost/test'),
        })
      ).rejects.toThrow(/Rootly API key is required/)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('deleteSubscription', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
      vi.stubGlobal('fetch', fetchMock)
      fetchMock.mockReset()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('deletes the endpoint by externalId', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, body: null })

      await rootlyHandler.deleteSubscription!({
        webhook: {
          id: 'webhook-1',
          providerConfig: { apiKey: 'rootly-key', externalId: 'wh-123' },
        },
        workflow: {},
        requestId: 'req-del-1',
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.rootly.com/v1/webhooks/endpoints/wh-123')
      expect(init.method).toBe('DELETE')
    })

    it('skips when apiKey or externalId is missing and does not throw', async () => {
      await rootlyHandler.deleteSubscription!({
        webhook: { id: 'webhook-2', providerConfig: { externalId: 'wh-123' } },
        workflow: {},
        requestId: 'req-del-2',
      })
      await rootlyHandler.deleteSubscription!({
        webhook: { id: 'webhook-3', providerConfig: { apiKey: 'rootly-key' } },
        workflow: {},
        requestId: 'req-del-3',
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('does not throw on a non-ok response in non-strict mode', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

      await expect(
        rootlyHandler.deleteSubscription!({
          webhook: {
            id: 'webhook-4',
            providerConfig: { apiKey: 'rootly-key', externalId: 'wh-9' },
          },
          workflow: {},
          requestId: 'req-del-4',
        })
      ).resolves.toBeUndefined()
    })
  })
})
