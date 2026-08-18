/**
 * @vitest-environment node
 */
import { dbChainMock, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

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

  /**
   * Field names and shapes taken from a captured Jotform delivery: answers sit under
   * q{qid}_{slug}, a file answer lands under the bare slug as upload URLs, and the body
   * carries form-internal keys alongside them.
   */
  it('carries a real payload through unflattened', async () => {
    const result = await jotformHandler.formatInput!({
      body: {
        formID: '243231271343446',
        submissionID: '6084250982513018472',
        formTitle: 'Tutor Appointment Form',
        username: 'UserNiloth',
        type: 'WEB',
        ip: '27.51.18.17',
        pretty: "Student's Name:Niloth P, Grade:12",
        rawRequest: JSON.stringify({
          slug: 'submit/243231271343446',
          jsExecutionTracker: 'build-date-1732271172685=>init-started',
          q3_studentsName: { first: 'Niloth', last: 'P' },
          q35_grade: '12',
          temp_upload: { q6_reports: ['Report Card.pdf#jotformfs-e4f4'] },
          reports: ['https://www.jotform.com/uploads/UserNiloth/Report%20Card.pdf'],
        }),
      },
    } as never)

    const input = result.input as Record<string, Record<string, unknown>>
    expect(input.submissionType).toBe('WEB')
    expect(input.rawRequest.q3_studentsName).toEqual({ first: 'Niloth', last: 'P' })
    expect(input.rawRequest.reports).toEqual([
      'https://www.jotform.com/uploads/UserNiloth/Report%20Card.pdf',
    ])
    expect(input.rawRequest.slug).toBe('submit/243231271343446')
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
    fetchMock
      .mockResolvedValueOnce(envelope({}))
      .mockResolvedValueOnce(envelope({ '0': NOTIFICATION_URL }))

    await jotformHandler.createSubscription!(
      createContext({ formId: '231504059977966', apiKey: 'jf-key' })
    )

    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://api.jotform.com/form/231504059977966/webhooks')
    expect(init.method).toBe('POST')
    expect(init.headers.APIKEY).toBe('jf-key')
    expect(init.body).toBe(`webhookURL=${encodeURIComponent(NOTIFICATION_URL)}`)
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

  it('uses the host that issued the key', async () => {
    fetchMock
      .mockResolvedValueOnce(envelope({}))
      .mockResolvedValueOnce(envelope({ '0': NOTIFICATION_URL }))

    await jotformHandler.createSubscription!(
      createContext({ formId: '1', apiKey: 'jf-key', apiRegion: 'eu' })
    )

    expect(fetchMock.mock.calls[1][0]).toBe('https://eu-api.jotform.com/form/1/webhooks')
  })

  it('fails when the URL is missing from the returned webhook list', async () => {
    fetchMock
      .mockResolvedValueOnce(envelope({}))
      .mockResolvedValueOnce(envelope({ '0': 'https://elsewhere.example.com/hook' }))

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
    resetDbChainMock()
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

  it('still deletes when the active deployment points at a different form', async () => {
    queueTableRows(schemaMock.webhook, [
      { path: 'jotform-path', providerConfig: { formId: '999' } },
    ])
    fetchMock
      .mockResolvedValueOnce(envelope({ '0': NOTIFICATION_URL }))
      .mockResolvedValueOnce(envelope({}))

    await jotformHandler.deleteSubscription!(createContext({ formId: '1', apiKey: 'jf-key' }))

    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
  })

  it('still deletes when the active deployment is served by a different path', async () => {
    queueTableRows(schemaMock.webhook, [{ path: 'other-path', providerConfig: { formId: '1' } }])
    fetchMock
      .mockResolvedValueOnce(envelope({ '0': NOTIFICATION_URL }))
      .mockResolvedValueOnce(envelope({}))

    await jotformHandler.deleteSubscription!(createContext({ formId: '1', apiKey: 'jf-key' }))

    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
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
