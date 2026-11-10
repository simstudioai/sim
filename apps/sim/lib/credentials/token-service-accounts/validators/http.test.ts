import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it, vi } from 'vitest'
import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

const validate = tokenCheckValidator({
  serviceLabel: 'Example',
  request: ({ apiToken }) => ({
    url: 'https://api.example.com/me',
    headers: { Authorization: `Bearer ${apiToken}` },
  }),
})

describe('tokenCheckValidator', () => {
  it('accepts a token the provider answers 2xx for, sending it only to the declared host', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetch)

    await expect(validate({ apiToken: 'good' })).resolves.toMatchObject({
      displayName: 'Example',
      principal: null,
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/me',
      expect.objectContaining({
        headers: { Authorization: 'Bearer good' },
        redirect: 'error',
      })
    )
  })

  it.each([
    { status: 401, code: 'invalid_credentials' },
    { status: 403, code: 'invalid_credentials' },
    { status: 429, code: 'provider_unavailable' },
    { status: 503, code: 'provider_unavailable' },
  ])('maps a $status answer to $code', async ({ status, code }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { status })))

    await expect(validate({ apiToken: 'token' })).rejects.toMatchObject({ code })
  })

  it('treats a network failure, including a refused redirect, as the provider being unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('redirect mode is set to error'))
    )

    await expect(validate({ apiToken: 'token' })).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })
})
