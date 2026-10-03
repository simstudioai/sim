import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WEBHOOK_ID = 'webhook-uuid-1234'
const NOTIFICATION_URL = 'https://app.example.com/api/webhooks/trigger/jotform-path'

vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getProviderConfig: (webhook: { providerConfig?: Record<string, unknown> }) =>
    webhook.providerConfig || {},
  getNotificationUrl: (webhook: { path?: string | null }) =>
    `https://app.example.com/api/webhooks/trigger/${webhook.path ?? 'jotform-path'}`,
}))

import { jotformHandler } from '@/lib/webhooks/providers/jotform'

const fetchMock = vi.fn()

function createContext(providerConfig: Record<string, unknown>) {
  return {
    webhook: { id: WEBHOOK_ID, workflowId: 'wf-1', path: 'jotform-path', providerConfig },
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
})

describe('jotformHandler createSubscription', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  it('does not post again when the form already carries the URL', async () => {
    fetchMock.mockResolvedValueOnce(envelope({ '0': NOTIFICATION_URL }))

    await jotformHandler.createSubscription!(createContext({ formId: '1', apiKey: 'jf-key' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
  })

  it('treats a stored URL that differs only by a trailing slash as the same webhook', async () => {
    fetchMock.mockResolvedValueOnce(envelope({ '0': `${NOTIFICATION_URL}/` }))

    await jotformHandler.createSubscription!(createContext({ formId: '1', apiKey: 'jf-key' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails on a 200 body that carries a non-2xx responseCode', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope(null, { responseCode: '401', message: 'Invalid API Key' })
    )

    await expect(
      jotformHandler.createSubscription!(createContext({ formId: '1', apiKey: 'bad-key' }))
    ).rejects.toThrow(/Invalid API Key/)
  })
})

describe('jotformHandler deleteSubscription', () => {
  beforeEach(() => {
    resetDbChainMock()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('does not delete anything when the form no longer carries our URL', async () => {
    fetchMock.mockResolvedValueOnce(envelope({ '0': 'https://elsewhere.example.com/hook' }))

    await jotformHandler.deleteSubscription!(createContext({ formId: '1', apiKey: 'jf-key' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  /**
   * Redeploying prepares the replacement row before the retired row is cleaned up, and the
   * workflow keeps its path, so both rows name one callback on one form. Without the guard
   * the retired row's cleanup deletes the callback the live row is now relying on and the
   * trigger goes silent.
   */
  it('leaves the callback alone while an active deployment is served by it', async () => {
    queueTableRows(schemaMock.webhook, [{ path: 'jotform-path', providerConfig: { formId: '1' } }])

    await jotformHandler.deleteSubscription!(createContext({ formId: '1', apiKey: 'jf-key' }))

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
