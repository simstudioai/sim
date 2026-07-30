/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchProvider,
  parseProviderJson,
  readProviderErrorSnippet,
  TokenServiceAccountValidationError,
  throwForProviderResponse,
} from '@/lib/credentials/token-service-accounts/errors'

const mockFetch = vi.fn()

const PROVIDER_URL = 'https://api.example-provider.com/v1/self'

async function expectValidationError(
  promise: Promise<unknown>
): Promise<TokenServiceAccountValidationError> {
  const error = await promise.then(
    () => {
      throw new Error('expected a TokenServiceAccountValidationError to be thrown')
    },
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
  return error as TokenServiceAccountValidationError
}

describe('token service-account error helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('fetchProvider', () => {
    it('maps a rejected fetch to provider_unavailable 502', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'))

      const error = await expectValidationError(fetchProvider(PROVIDER_URL, {}, 'self'))

      expect(error.code).toBe('provider_unavailable')
      expect(error.status).toBe(502)
      expect(error.logDetail).toEqual({ step: 'self', reason: 'network error reaching provider' })
    })

    it('never includes the URL in logDetail', async () => {
      mockFetch.mockRejectedValue(new Error(`ECONNREFUSED ${PROVIDER_URL}`))

      const error = await expectValidationError(fetchProvider(PROVIDER_URL, {}, 'self'))

      expect(JSON.stringify(error.logDetail)).not.toContain(PROVIDER_URL)
      expect(JSON.stringify(error.logDetail)).not.toContain('example-provider')
    })

    it('returns the response untouched when fetch resolves', async () => {
      const res = new Response('ok', { status: 200 })
      mockFetch.mockResolvedValue(res)

      await expect(fetchProvider(PROVIDER_URL, {}, 'self')).resolves.toBe(res)
    })
  })

  describe('parseProviderJson', () => {
    it('maps a non-JSON body to provider_unavailable 502', async () => {
      const res = new Response('<html>502 Bad Gateway</html>', { status: 200 })

      const error = await expectValidationError(parseProviderJson(res, 'self'))

      expect(error.code).toBe('provider_unavailable')
      expect(error.status).toBe(502)
      expect(error.logDetail).toEqual({
        step: 'self',
        reason: 'provider returned a non-JSON response body',
      })
    })

    it('returns the parsed body for valid JSON', async () => {
      const res = new Response(JSON.stringify({ id: 'acct-1' }), { status: 200 })

      await expect(parseProviderJson(res, 'self')).resolves.toEqual({ id: 'acct-1' })
    })
  })

  describe('throwForProviderResponse', () => {
    it.each([401, 403])(
      'maps %i to invalid_credentials with the response status',
      async (status) => {
        const res = new Response('denied', { status })

        const error = await expectValidationError(throwForProviderResponse(res, 'self'))

        expect(error.code).toBe('invalid_credentials')
        expect(error.status).toBe(status)
      }
    )

    it.each([429, 500, 503])(
      'maps %i to provider_unavailable with the response status',
      async (status) => {
        const res = new Response('provider trouble', { status })

        const error = await expectValidationError(throwForProviderResponse(res, 'self'))

        expect(error.code).toBe('provider_unavailable')
        expect(error.status).toBe(status)
      }
    )

    it('returns without throwing on a 2xx response', async () => {
      const res = new Response('ok', { status: 200 })

      await expect(throwForProviderResponse(res, 'self')).resolves.toBeUndefined()
    })
  })

  describe('readProviderErrorSnippet', () => {
    it('truncates the body to 500 characters', async () => {
      const res = new Response('x'.repeat(2000), { status: 500 })

      const snippet = await readProviderErrorSnippet(res)

      expect(snippet).toBe(`${'x'.repeat(500)}...`)
    })

    it('never throws on an unreadable body', async () => {
      const res = new Response('gone', { status: 500 })
      vi.spyOn(res, 'text').mockRejectedValue(new Error('body stream already read'))

      await expect(readProviderErrorSnippet(res)).resolves.toBe('')
    })
  })
})
