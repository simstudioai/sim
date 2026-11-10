import { jsonResponse } from '@sim/testing/helpers/http'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

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

  it('reports a key the vendor rejects with a server error as invalid, not an outage', async () => {
    const check = tokenCheckValidator({
      serviceLabel: 'ErrorBody',
      request: () => ({ url: 'https://api.example.com/graphql', headers: {} }),
      rejectsKey: (body) => (body as { code?: string }).code === 'auth_failed',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 'auth_failed' }, { status: 500 }))
    )
    await expect(check({ apiToken: 'bad' })).rejects.toMatchObject({ code: 'invalid_credentials' })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 'other' }, { status: 500 }))
    )
    await expect(check({ apiToken: 'any' })).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})

describe('tokenCheckValidator with a typed host', () => {
  const secureFetch = inputValidationMockFns.mockSecureFetchWithValidation
  const validateHost = tokenCheckValidator({
    serviceLabel: 'Example',
    domain: ({ domain }) => {
      const url = new URL(`https://${domain?.trim()}`)
      if (url.username || url.pathname !== '/') throw new Error('not a bare host')
      return url.host
    },
    egress: 'configuredEndpoint',
    request: ({ apiToken, domain }) => ({
      url: `https://${domain}/api/me`,
      headers: { Authorization: `Bearer ${apiToken}` },
    }),
  })

  beforeEach(() => {
    secureFetch.mockReset()
  })

  it('verifies at the normalized host through the guarded egress and stores that host', async () => {
    secureFetch.mockResolvedValue(jsonResponse({ ok: true }))

    await expect(
      validateHost({ apiToken: 'good', domain: ' Tools.Example.com ' })
    ).resolves.toMatchObject({ normalizedDomain: 'tools.example.com' })
    expect(secureFetch).toHaveBeenCalledWith(
      'https://tools.example.com/api/me',
      expect.objectContaining({ profile: 'configuredEndpoint', maxRedirects: 0 })
    )
  })

  it('refuses a host its normalizer rejects without sending the token anywhere', async () => {
    await expect(
      validateHost({ apiToken: 'good', domain: 'evil.example.com@tools.example.com' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(secureFetch).not.toHaveBeenCalled()
  })

  it('reports a host that does not exist as not found', async () => {
    secureFetch.mockRejectedValue(
      new Error('url hostname could not be resolved', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
      })
    )

    await expect(
      validateHost({ apiToken: 'good', domain: 'tools.exmaple.com' })
    ).rejects.toMatchObject({ code: 'site_not_found' })
  })

  it('keeps an error body that echoes the token out of the error details', async () => {
    const echoing = tokenCheckValidator({
      serviceLabel: 'Echo',
      errorBodyEchoesToken: true,
      request: ({ apiToken }) => ({
        url: 'https://api.example.com/me',
        headers: { Token: apiToken },
      }),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid token tok-secret' }, 401))
    )

    const error = await echoing({ apiToken: 'tok-secret' }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'invalid_credentials' })
    expect(JSON.stringify(error)).not.toContain('tok-secret')
  })
})
