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

  it('treats a 403 as a scoped but valid key only where the vendor says so', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { status: 403 })))
    const scoped = tokenCheckValidator({
      serviceLabel: 'Scoped',
      request: () => ({ url: 'https://api.example.com/me', headers: {} }),
      forbiddenMeansScoped: true,
    })

    await expect(scoped({ apiToken: 'token' })).resolves.toMatchObject({ displayName: 'Scoped' })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>Access denied</html>', {
          status: 403,
          headers: { 'Content-Type': 'text/html' },
        })
      )
    )
    await expect(scoped({ apiToken: 'token' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    await expect(validate({ apiToken: 'token' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('rejects a key a successful response body does not prove', async () => {
    const graphql = tokenCheckValidator({
      serviceLabel: 'GraphQL',
      request: () => ({ url: 'https://api.example.com/graphql', headers: {} }),
      acceptsBody: (body) => (body as { data?: { id?: string } }).data?.id === 'account',
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ errors: [{ extensions: { code: 'UNAUTHORIZED' } }] }))
    )
    await expect(graphql({ apiToken: 'bad' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'account' } })))
    await expect(graphql({ apiToken: 'good' })).resolves.toMatchObject({ displayName: 'GraphQL' })
  })
})
