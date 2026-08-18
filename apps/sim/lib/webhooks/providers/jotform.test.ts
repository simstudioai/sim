/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WEBHOOK_ID = 'webhook-uuid-1234'
const NOTIFICATION_URL = 'https://app.example.com/api/webhooks/trigger/jotform-path'

vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getProviderConfig: (webhook: { providerConfig?: Record<string, unknown> }) =>
    webhook.providerConfig || {},
  getNotificationUrl: () => NOTIFICATION_URL,
}))

import { jotformHandler } from '@/lib/webhooks/providers/jotform'

const fetchMock = vi.fn()

function createContext(providerConfig: Record<string, unknown>) {
  return {
    webhook: { id: WEBHOOK_ID, path: 'jotform-path', providerConfig },
    workflow: {},
    userId: 'user-1',
    requestId: 'req-1',
  } as never
}

/** Jotform wraps every response in an envelope and reports failures inside it. */
function envelope(content: unknown, overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ responseCode: 200, content, ...overrides }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('jotformHandler formatInput', () => {
  it('maps the multipart fields and parses rawRequest', async () => {
    const result = await jotformHandler.formatInput!({
      body: {
        formID: '231504059977966',
        submissionID: '5678',
        formTitle: 'Contact Us',
        username: 'acme',
        ip: '198.51.100.4',
        type: 'WEB',
        pretty: 'Name:Bart Simpson, Email:bart@example.com',
        rawRequest: '{"q3_name":{"first":"Bart","last":"Simpson"},"q4_email":"bart@example.com"}',
      },
    } as never)

    expect(result.input).toEqual({
      formId: '231504059977966',
      submissionId: '5678',
      formTitle: 'Contact Us',
      username: 'acme',
      ip: '198.51.100.4',
      submissionType: 'WEB',
      pretty: 'Name:Bart Simpson, Email:bart@example.com',
      rawRequest: {
        q3_name: { first: 'Bart', last: 'Simpson' },
        q4_email: 'bart@example.com',
      },
      raw: expect.objectContaining({ submissionID: '5678' }),
    })
  })

  it('keeps the submission when rawRequest is not valid JSON', async () => {
    const result = await jotformHandler.formatInput!({
      body: { submissionID: '5678', rawRequest: 'not json' },
    } as never)

    expect((result.input as Record<string, unknown>).rawRequest).toBeNull()
    expect((result.input as Record<string, unknown>).submissionId).toBe('5678')
  })
})

describe('jotformHandler extractIdempotencyId', () => {
  it('keys on the submission id', () => {
    expect(jotformHandler.extractIdempotencyId!({ submissionID: '5678' })).toBe('submission:5678')
  })

  it('returns null without a submission id', () => {
    expect(jotformHandler.extractIdempotencyId!({ formID: '1' })).toBeNull()
  })
})

describe('jotformHandler createSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('registers the notification URL on the form', async () => {
    fetchMock.mockResolvedValueOnce(envelope({ '0': NOTIFICATION_URL }))

    await jotformHandler.createSubscription!(
      createContext({ formId: '231504059977966', apiKey: 'jf-key' })
    )

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.jotform.com/form/231504059977966/webhooks')
    expect(init.method).toBe('POST')
    expect(init.headers.APIKEY).toBe('jf-key')
    expect(init.body).toBe(`webhookURL=${encodeURIComponent(NOTIFICATION_URL)}`)
  })

  it('uses the host that issued the key', async () => {
    fetchMock.mockResolvedValueOnce(envelope({ '0': NOTIFICATION_URL }))

    await jotformHandler.createSubscription!(
      createContext({ formId: '1', apiKey: 'jf-key', apiRegion: 'eu' })
    )

    expect(fetchMock.mock.calls[0][0]).toBe('https://eu-api.jotform.com/form/1/webhooks')
  })

  it('fails when the URL is missing from the returned webhook list', async () => {
    fetchMock.mockResolvedValueOnce(envelope({ '0': 'https://elsewhere.example.com/hook' }))

    await expect(
      jotformHandler.createSubscription!(createContext({ formId: '1', apiKey: 'jf-key' }))
    ).rejects.toThrow(/did not register the webhook URL/)
  })

  it('fails on a 200 body that carries a non-2xx responseCode', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope(null, { responseCode: '401', message: 'Invalid API Key' })
    )

    await expect(
      jotformHandler.createSubscription!(createContext({ formId: '1', apiKey: 'bad-key' }))
    ).rejects.toThrow(/Invalid API Key/)
  })

  it('fails before calling Jotform when the API key is missing', async () => {
    await expect(
      jotformHandler.createSubscription!(createContext({ formId: '1' }))
    ).rejects.toThrow(/API Key is required/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('jotformHandler deleteSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('resolves the webhook id by URL before deleting it', async () => {
    fetchMock
      .mockResolvedValueOnce(
        envelope({ '0': 'https://elsewhere.example.com/hook', '1': NOTIFICATION_URL })
      )
      .mockResolvedValueOnce(envelope({ '0': 'https://elsewhere.example.com/hook' }))

    await jotformHandler.deleteSubscription!(createContext({ formId: '1', apiKey: 'jf-key' }))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.jotform.com/form/1/webhooks/1')
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
  })

  it('does not delete anything when the form no longer carries our URL', async () => {
    fetchMock.mockResolvedValueOnce(envelope({ '0': 'https://elsewhere.example.com/hook' }))

    await jotformHandler.deleteSubscription!(createContext({ formId: '1', apiKey: 'jf-key' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('swallows a failed cleanup unless the caller is strict', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    await expect(
      jotformHandler.deleteSubscription!(createContext({ formId: '1', apiKey: 'jf-key' }))
    ).resolves.toBeUndefined()

    await expect(
      jotformHandler.deleteSubscription!({
        ...(createContext({ formId: '1', apiKey: 'jf-key' }) as object),
        strict: true,
      } as never)
    ).rejects.toThrow(/network down/)
  })
})
