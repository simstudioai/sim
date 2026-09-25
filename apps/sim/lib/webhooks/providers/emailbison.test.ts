import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { emailBisonHandler } from '@/lib/webhooks/providers/emailbison'

const WEBHOOK_ID = 'webhook-uuid-1234'

function makeWebhook(providerConfig: Record<string, unknown>) {
  return {
    id: WEBHOOK_ID,
    path: 'abc',
    providerConfig,
  } as unknown as Parameters<typeof emailBisonHandler.deleteSubscription>[0]['webhook']
}

describe('emailBisonHandler createSubscription', () => {
  beforeEach(() => {
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
})

describe('emailBisonHandler deleteSubscription', () => {
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
})
