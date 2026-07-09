import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { instantlyHandler } from '@/lib/webhooks/providers/instantly'

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
}

describe('Instantly webhook provider', () => {
  it('verifyAuth rejects when secretToken is missing (fail-closed)', async () => {
    const res = await instantlyHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't1',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('verifyAuth rejects when the token header is missing', async () => {
    const res = await instantlyHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't2',
      providerConfig: { secretToken: 'expected-token' },
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('verifyAuth rejects an incorrect token', async () => {
    const res = await instantlyHandler.verifyAuth!({
      request: reqWithHeaders({ 'x-sim-webhook-token': 'wrong-token' }),
      rawBody: '{}',
      requestId: 't3',
      providerConfig: { secretToken: 'expected-token' },
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('verifyAuth accepts a matching token', async () => {
    const res = await instantlyHandler.verifyAuth!({
      request: reqWithHeaders({ 'x-sim-webhook-token': 'expected-token' }),
      rawBody: '{}',
      requestId: 't4',
      providerConfig: { secretToken: 'expected-token' },
      webhook: {},
      workflow: {},
    })
    expect(res).toBeNull()
  })

  it('matchEvent passes all events through for the generic webhook trigger', async () => {
    const matched = await instantlyHandler.matchEvent!({
      body: { event_type: 'lead_interested' },
      requestId: 't5',
      providerConfig: { triggerId: 'instantly_webhook' },
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
    })
    expect(matched).toBe(true)
  })

  it('matchEvent filters events that do not match the configured trigger', async () => {
    const matched = await instantlyHandler.matchEvent!({
      body: { event_type: 'email_opened' },
      requestId: 't6',
      providerConfig: { triggerId: 'instantly_email_sent' },
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
    })
    expect(matched).toBe(false)
  })

  it('matchEvent matches events for the configured trigger', async () => {
    const matched = await instantlyHandler.matchEvent!({
      body: { event_type: 'email_sent' },
      requestId: 't7',
      providerConfig: { triggerId: 'instantly_email_sent' },
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
    })
    expect(matched).toBe(true)
  })

  it('matchEvent accepts both link-click event type spellings', async () => {
    const matchedA = await instantlyHandler.matchEvent!({
      body: { event_type: 'link_clicked' },
      requestId: 't8a',
      providerConfig: { triggerId: 'instantly_link_clicked' },
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
    })
    const matchedB = await instantlyHandler.matchEvent!({
      body: { event_type: 'email_link_clicked' },
      requestId: 't8b',
      providerConfig: { triggerId: 'instantly_link_clicked' },
      webhook: {},
      workflow: {},
      request: new NextRequest('http://localhost/test'),
    })
    expect(matchedA).toBe(true)
    expect(matchedB).toBe(true)
  })

  it('formats input with keys matching the trigger outputs', async () => {
    const body = {
      timestamp: '2026-07-08T12:00:00.000Z',
      event_type: 'reply_received',
      workspace: 'ws-1',
      campaign_id: 'camp-1',
      campaign_name: 'Q3 Outreach',
      lead_email: 'lead@example.com',
      email_account: 'sender@example.com',
      unibox_url: 'https://app.instantly.ai/unibox/1',
      step: 2,
      variant: 1,
      is_first: true,
      email_id: 'email-1',
      reply_text_snippet: 'Sounds good',
      reply_subject: 'Re: Q3 Outreach',
      reply_text: 'Sounds good, thanks!',
      reply_html: '<p>Sounds good, thanks!</p>',
    }

    const result = await instantlyHandler.formatInput!({
      body,
      webhook: {},
      workflow: { id: 'wf-1', userId: 'user-1' },
      headers: {},
      requestId: 't9',
    })

    expect(result.input).toEqual({
      timestamp: '2026-07-08T12:00:00.000Z',
      eventType: 'reply_received',
      workspace: 'ws-1',
      campaignId: 'camp-1',
      campaignName: 'Q3 Outreach',
      leadEmail: 'lead@example.com',
      emailAccount: 'sender@example.com',
      uniboxUrl: 'https://app.instantly.ai/unibox/1',
      step: 2,
      variant: 1,
      isFirst: true,
      emailId: 'email-1',
      emailSubject: null,
      emailText: null,
      emailHtml: null,
      replyTextSnippet: 'Sounds good',
      replySubject: 'Re: Q3 Outreach',
      replyText: 'Sounds good, thanks!',
      replyHtml: '<p>Sounds good, thanks!</p>',
      payload: body,
    })
  })

  describe('extractIdempotencyId', () => {
    it('prefers the email_id when present, qualified by timestamp', () => {
      const id = instantlyHandler.extractIdempotencyId!({
        event_type: 'email_sent',
        email_id: 'email-123',
        campaign_id: 'camp-1',
        lead_email: 'lead@example.com',
        timestamp: '2026-07-08T12:00:00.000Z',
      })
      expect(id).toBe('instantly:email_sent:email-123:2026-07-08T12:00:00.000Z')
    })

    it('returns null when email_id is present but timestamp is missing, rather than risk a false collision', () => {
      const id = instantlyHandler.extractIdempotencyId!({
        event_type: 'email_sent',
        email_id: 'email-123',
      })
      expect(id).toBeNull()
    })

    it('falls back to a content-based key without an email_id', () => {
      const id = instantlyHandler.extractIdempotencyId!({
        event_type: 'lead_interested',
        campaign_id: 'camp-1',
        lead_email: 'lead@example.com',
        timestamp: '2026-07-08T12:00:00.000Z',
      })
      expect(id).toBe('instantly:lead_interested:camp-1:lead@example.com:2026-07-08T12:00:00.000Z')
    })

    it('is stable across retries of the same delivery', () => {
      const body = {
        event_type: 'lead_interested',
        campaign_id: 'camp-1',
        lead_email: 'lead@example.com',
        timestamp: '2026-07-08T12:00:00.000Z',
      }
      const first = instantlyHandler.extractIdempotencyId!(body)
      const second = instantlyHandler.extractIdempotencyId!({ ...body })
      expect(first).toBe(second)
    })

    it('is stable across retries of the same email_id-keyed delivery', () => {
      const body = {
        event_type: 'email_opened',
        email_id: 'email-123',
        timestamp: '2026-07-08T12:00:00.000Z',
      }
      const first = instantlyHandler.extractIdempotencyId!(body)
      const second = instantlyHandler.extractIdempotencyId!({ ...body })
      expect(first).toBe(second)
    })

    it('does not collide across distinct occurrences of the same email_id (e.g. repeat opens/clicks/replies)', () => {
      const firstOpen = instantlyHandler.extractIdempotencyId!({
        event_type: 'email_opened',
        email_id: 'email-123',
        timestamp: '2026-07-08T12:00:00.000Z',
      })
      const secondOpen = instantlyHandler.extractIdempotencyId!({
        event_type: 'email_opened',
        email_id: 'email-123',
        timestamp: '2026-07-08T13:30:00.000Z',
      })
      expect(firstOpen).not.toBe(secondOpen)
    })

    it('returns null when there is not enough data to build a stable key', () => {
      expect(instantlyHandler.extractIdempotencyId!({ event_type: 'account_error' })).toBeNull()
      expect(instantlyHandler.extractIdempotencyId!({})).toBeNull()
      expect(instantlyHandler.extractIdempotencyId!('not-an-object')).toBeNull()
    })
  })

  describe('createSubscription', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test')
      vi.stubGlobal('fetch', fetchMock)
      fetchMock.mockReset()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    })

    it('creates an Instantly webhook with the mapped event type', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'wh-123' }),
      })

      const result = await instantlyHandler.createSubscription!({
        webhook: {
          id: 'webhook-1',
          path: 'abc-path',
          providerConfig: { triggerApiKey: 'instantly-key', triggerId: 'instantly_email_sent' },
        },
        workflow: {},
        userId: 'user-1',
        requestId: 'req-create-1',
        request: new NextRequest('http://localhost/test'),
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.instantly.ai/api/v2/webhooks')
      expect(init.method).toBe('POST')
      expect(init.headers.Authorization).toBe('Bearer instantly-key')
      const sent = JSON.parse(init.body)
      expect(sent.event_type).toBe('email_sent')
      expect(sent.target_hook_url).toContain('/api/webhooks/trigger/abc-path')
      expect(typeof sent.headers['X-Sim-Webhook-Token']).toBe('string')

      expect(result?.providerConfigUpdates?.externalId).toBe('wh-123')
    })

    it('maps the link-clicked trigger to the email_link_clicked subscription event', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'wh-456' }) })

      await instantlyHandler.createSubscription!({
        webhook: {
          id: 'webhook-2',
          path: 'p2',
          providerConfig: { triggerApiKey: 'instantly-key', triggerId: 'instantly_link_clicked' },
        },
        workflow: {},
        userId: 'user-1',
        requestId: 'req-create-2',
        request: new NextRequest('http://localhost/test'),
      })

      const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(sent.event_type).toBe('email_link_clicked')
    })

    it('throws a friendly error on 401', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'unauthorized' }),
      })

      await expect(
        instantlyHandler.createSubscription!({
          webhook: {
            id: 'webhook-3',
            path: 'p3',
            providerConfig: { triggerApiKey: 'bad-key', triggerId: 'instantly_email_sent' },
          },
          workflow: {},
          userId: 'user-1',
          requestId: 'req-create-3',
          request: new NextRequest('http://localhost/test'),
        })
      ).rejects.toThrow(/Invalid Instantly API Key/)
    })

    it('throws when the API key is missing', async () => {
      await expect(
        instantlyHandler.createSubscription!({
          webhook: {
            id: 'webhook-4',
            path: 'p4',
            providerConfig: { triggerId: 'instantly_email_sent' },
          },
          workflow: {},
          userId: 'user-1',
          requestId: 'req-create-4',
          request: new NextRequest('http://localhost/test'),
        })
      ).rejects.toThrow(/Instantly API Key is required/)
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

    it('deletes the webhook by externalId', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, body: null })

      await instantlyHandler.deleteSubscription!({
        webhook: {
          id: 'webhook-1',
          providerConfig: { triggerApiKey: 'instantly-key', externalId: 'wh-123' },
        },
        workflow: {},
        requestId: 'req-del-1',
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.instantly.ai/api/v2/webhooks/wh-123')
      expect(init.method).toBe('DELETE')
    })

    it('skips when apiKey or externalId is missing and does not throw', async () => {
      await instantlyHandler.deleteSubscription!({
        webhook: { id: 'webhook-2', providerConfig: { externalId: 'wh-123' } },
        workflow: {},
        requestId: 'req-del-2',
      })
      await instantlyHandler.deleteSubscription!({
        webhook: { id: 'webhook-3', providerConfig: { triggerApiKey: 'instantly-key' } },
        workflow: {},
        requestId: 'req-del-3',
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('does not throw on a non-ok response in non-strict mode', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

      await expect(
        instantlyHandler.deleteSubscription!({
          webhook: {
            id: 'webhook-4',
            providerConfig: { triggerApiKey: 'instantly-key', externalId: 'wh-9' },
          },
          workflow: {},
          requestId: 'req-del-4',
        })
      ).resolves.toBeUndefined()
    })
  })
})
