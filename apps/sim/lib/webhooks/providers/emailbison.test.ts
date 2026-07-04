/**
 * @vitest-environment node
 */
import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { emailBisonHandler } from '@/lib/webhooks/providers/emailbison'

const WEBHOOK_ID = 'webhook-uuid-1234'
const PUBLIC_BASE_URL = 'https://my-instance.emailbison.com'

function makeWebhook(providerConfig: Record<string, unknown>) {
  return {
    id: WEBHOOK_ID,
    path: 'abc',
    providerConfig,
  } as unknown as Parameters<typeof emailBisonHandler.deleteSubscription>[0]['webhook']
}

function jsonSecureResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: () => null },
    body: { cancel: vi.fn() },
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    arrayBuffer: vi.fn(),
  }
}

describe('emailBisonHandler createSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = undefined
  })

  it('rejects an apiBaseUrl that resolves to a blocked address before making a request', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: false,
      error: 'URL resolves to a blocked address',
    })

    const webhook = makeWebhook({
      apiKey: 'test-key',
      apiBaseUrl: 'https://169.254.169.254',
      triggerId: 'emailbison_email_sent',
    })

    await expect(
      emailBisonHandler.createSubscription({
        webhook,
        workflow: {} as never,
        userId: 'user-1',
        requestId: 'req-1',
      } as never)
    ).rejects.toThrow('Email Bison Instance URL could not be validated.')

    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('creates the webhook subscription for a valid public instance URL', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      jsonSecureResponse(200, { data: { id: 42 } })
    )

    const webhook = makeWebhook({
      apiKey: 'test-key',
      apiBaseUrl: PUBLIC_BASE_URL,
      triggerId: 'emailbison_email_sent',
    })

    const result = await emailBisonHandler.createSubscription({
      webhook,
      workflow: {} as never,
      userId: 'user-1',
      requestId: 'req-1',
    } as never)

    expect(result).toEqual({ providerConfigUpdates: { externalId: '42' } })
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      expect.stringContaining(PUBLIC_BASE_URL),
      '203.0.113.10',
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('emailBisonHandler deleteSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an apiBaseUrl that resolves to a blocked address before making a request', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: false,
      error: 'URL resolves to a blocked address',
    })

    const webhook = makeWebhook({
      apiKey: 'test-key',
      apiBaseUrl: 'https://127.0.0.1',
      externalId: '42',
    })

    await emailBisonHandler.deleteSubscription({
      webhook,
      workflow: {} as never,
      requestId: 'req-1',
      strict: false,
    } as never)

    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('throws when strict and the apiBaseUrl resolves to a blocked address', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: false,
      error: 'URL resolves to a blocked address',
    })

    const webhook = makeWebhook({
      apiKey: 'test-key',
      apiBaseUrl: 'https://127.0.0.1',
      externalId: '42',
    })

    await expect(
      emailBisonHandler.deleteSubscription({
        webhook,
        workflow: {} as never,
        requestId: 'req-1',
        strict: true,
      } as never)
    ).rejects.toThrow('Email Bison Instance URL could not be validated.')

    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('deletes the webhook subscription for a valid public instance URL', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      jsonSecureResponse(200, {})
    )

    const webhook = makeWebhook({
      apiKey: 'test-key',
      apiBaseUrl: PUBLIC_BASE_URL,
      externalId: '42',
    })

    await emailBisonHandler.deleteSubscription({
      webhook,
      workflow: {} as never,
      requestId: 'req-1',
      strict: false,
    } as never)

    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      expect.stringContaining(PUBLIC_BASE_URL),
      '203.0.113.10',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})
