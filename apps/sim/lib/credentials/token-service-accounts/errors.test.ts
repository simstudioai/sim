import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchProvider,
  isHostNotFound,
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
    vi.stubGlobal('fetch', mockFetch)
  })

  describe('fetchProvider', () => {
    it('preserves caller cancellation instead of reporting a provider outage', async () => {
      const controller = new AbortController()
      const reason = new Error('Caller cancelled credential verification')
      controller.abort(reason)
      mockFetch.mockImplementationOnce((_input: unknown, init: RequestInit) => {
        init.signal?.throwIfAborted()
        return Promise.resolve(new Response())
      })

      await expect(fetchProvider(PROVIDER_URL, { signal: controller.signal }, 'self')).rejects.toBe(
        reason
      )
    })

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
  })

  describe('isHostNotFound', () => {
    it('reads ENOTFOUND on the cause even when the outer error carries another code', () => {
      const error = Object.assign(new TypeError('fetch failed'), {
        code: 'UND_ERR_CONNECT',
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
      })

      expect(isHostNotFound(error)).toBe(true)
    })

    it('does not treat a transient resolver failure as a missing host', () => {
      const error = Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }),
      })

      expect(isHostNotFound(error)).toBe(false)
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
  })

  describe('throwForProviderResponse', () => {
    it.each([401])('maps %i to invalid_credentials with the response status', async (status) => {
      const res = new Response('denied', { status })

      const error = await expectValidationError(throwForProviderResponse(res, 'self'))

      expect(error.code).toBe('invalid_credentials')
      expect(error.status).toBe(status)
    })

    /**
     * `provider_unavailable` renders as `503 + Retry-After`, so classifying a
     * permanently-wrong `domain`, `orgId`, or `clientId` as an outage tells a
     * conforming client to retry input that can never succeed.
     */
    it.each([400, 404])(
      'maps the non-transient %i to invalid_credentials, never an outage',
      async (status) => {
        const res = new Response('bad request', { status })

        const error = await expectValidationError(throwForProviderResponse(res, 'self'))

        expect(error.code).toBe('invalid_credentials')
        expect(error.status).toBe(status)
      }
    )

    it.each([408, 429, 503])('keeps the transient %i an outage', async (status) => {
      const res = new Response('slow down', { status })

      const error = await expectValidationError(throwForProviderResponse(res, 'self'))

      expect(error.code).toBe('provider_unavailable')
    })
  })

  describe('readProviderErrorSnippet', () => {
    it('truncates the body to 500 characters', async () => {
      const res = new Response('x'.repeat(2000), { status: 500 })

      const snippet = await readProviderErrorSnippet(res)

      expect(snippet).toBe(`${'x'.repeat(500)}...`)
    })

    it('stops reading an oversized error body instead of buffering all of it', async () => {
      let pulled = 0
      const chunk = new Uint8Array(16 * 1024).fill(120)
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled++
          if (pulled > 1000) controller.close()
          else controller.enqueue(chunk)
        },
      })

      await expect(readProviderErrorSnippet(new Response(body, { status: 500 }))).resolves.toBe('')
      expect(pulled).toBeLessThan(20)
    })

    it('never throws on an unreadable body', async () => {
      const res = new Response('gone', { status: 500 })
      await res.text()

      await expect(readProviderErrorSnippet(res)).resolves.toBe('')
    })
  })
})
