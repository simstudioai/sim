/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('lago client', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  describe('hasValidLagoCredentials', () => {
    it('returns true when key and url are set', async () => {
      vi.stubEnv('LAGO_API_KEY', 'test-key')
      vi.stubEnv('LAGO_API_URL', 'https://api.lago.test/api/v1')
      vi.resetModules()
      const { hasValidLagoCredentials } = await import('@/lib/billing/lago/client')
      expect(hasValidLagoCredentials()).toBe(true)
    })

    it('returns false when key is missing', async () => {
      vi.stubEnv('LAGO_API_KEY', '')
      vi.stubEnv('LAGO_API_URL', 'https://api.lago.test/api/v1')
      vi.resetModules()
      const { hasValidLagoCredentials } = await import('@/lib/billing/lago/client')
      expect(hasValidLagoCredentials()).toBe(false)
    })

    it('returns false when url is missing', async () => {
      vi.stubEnv('LAGO_API_KEY', 'test-key')
      vi.stubEnv('LAGO_API_URL', '')
      vi.resetModules()
      const { hasValidLagoCredentials } = await import('@/lib/billing/lago/client')
      expect(hasValidLagoCredentials()).toBe(false)
    })

    it('returns false when both are missing', async () => {
      vi.stubEnv('LAGO_API_KEY', '')
      vi.stubEnv('LAGO_API_URL', '')
      vi.resetModules()
      const { hasValidLagoCredentials } = await import('@/lib/billing/lago/client')
      expect(hasValidLagoCredentials()).toBe(false)
    })
  })

  describe('lagoRequest', () => {
    it('sends a POST request with correct url and headers', async () => {
      vi.stubEnv('LAGO_API_KEY', 'test-key')
      vi.stubEnv('LAGO_API_URL', 'https://api.lago.test/api/v1')
      vi.resetModules()

      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ event: { transaction_id: 'tx_1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      const { lagoRequest } = await import('@/lib/billing/lago/client')

      const result = await lagoRequest('POST', '/events', {
        event: {
          transaction_id: 'tx_1',
          external_subscription_id: 'sub_1',
          code: 'ai_usage',
          properties: { tokens: 100 },
        },
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.lago.test/api/v1/api/v1/events')
      expect(opts.method).toBe('POST')
      expect(opts.headers).toMatchObject({
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
      })
      expect(result).toEqual({ event: { transaction_id: 'tx_1' } })
    })

    it('returns empty object for empty response body', async () => {
      vi.stubEnv('LAGO_API_KEY', 'test-key')
      vi.stubEnv('LAGO_API_URL', 'https://api.lago.test/api/v1')
      vi.resetModules()

      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response('', { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const { lagoRequest } = await import('@/lib/billing/lago/client')
      const result = await lagoRequest('DELETE', '/subscriptions/sub_1')
      expect(result).toEqual({})
    })

    it('throws LagoApiError on non-ok response', async () => {
      vi.stubEnv('LAGO_API_KEY', 'test-key')
      vi.stubEnv('LAGO_API_URL', 'https://api.lago.test/api/v1')
      vi.resetModules()

      const mockFetch = vi.fn().mockImplementation(
        () => Promise.resolve(new Response('{"error":"Not Found"}', { status: 404 }))
      )
      vi.stubGlobal('fetch', mockFetch)

      const { lagoRequest, LagoApiError } = await import('@/lib/billing/lago/client')

      let caught: unknown
      try {
        await lagoRequest('GET', '/customers/nonexistent')
        expect.fail('Expected lagoRequest to throw')
      } catch (err) {
        caught = err
      }

      expect(caught).toBeInstanceOf(LagoApiError)
      expect((caught as LagoApiError).status).toBe(404)
      expect((caught as LagoApiError).body).toBe('{"error":"Not Found"}')
    })

    it('propagates network errors', async () => {
      vi.stubEnv('LAGO_API_KEY', 'test-key')
      vi.stubEnv('LAGO_API_URL', 'https://api.lago.test/api/v1')
      vi.resetModules()

      const networkError = new Error('Connection refused')
      const mockFetch = vi.fn().mockRejectedValueOnce(networkError)
      vi.stubGlobal('fetch', mockFetch)

      const { lagoRequest } = await import('@/lib/billing/lago/client')
      await expect(lagoRequest('GET', '/events')).rejects.toThrow('Connection refused')
    })

    it('throws LagoApiError when LAGO_API_URL is not configured', async () => {
      vi.stubEnv('LAGO_API_KEY', 'test-key')
      vi.stubEnv('LAGO_API_URL', '')
      vi.resetModules()

      const { lagoRequest } = await import('@/lib/billing/lago/client')
      await expect(lagoRequest('GET', '/events')).rejects.toThrow('LAGO_API_URL is not configured')
    })

    it('throws LagoApiError when LAGO_API_KEY is not configured', async () => {
      vi.stubEnv('LAGO_API_KEY', '')
      vi.stubEnv('LAGO_API_URL', 'https://api.lago.test/api/v1')
      vi.resetModules()

      const { lagoRequest } = await import('@/lib/billing/lago/client')
      await expect(lagoRequest('GET', '/events')).rejects.toThrow('LAGO_API_KEY is not configured')
    })
  })

  describe('LagoApiError', () => {
    it('sets name, status, and body properties', async () => {
      vi.stubEnv('LAGO_API_KEY', 'test-key')
      vi.stubEnv('LAGO_API_URL', 'https://api.lago.test/api/v1')
      vi.resetModules()

      const { LagoApiError } = await import('@/lib/billing/lago/client')
      const err = new LagoApiError('Something went wrong', 500, 'Internal Server Error')
      expect(err.name).toBe('LagoApiError')
      expect(err.status).toBe(500)
      expect(err.body).toBe('Internal Server Error')
      expect(err.message).toBe('Something went wrong')
    })
  })
})

describe('lago webhooks', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('verifyLagoWebhookSignature', () => {
    it('returns true for valid signature', async () => {
      vi.stubEnv('LAGO_WEBHOOK_SECRET', 'whsec_test')
      vi.resetModules()

      const { verifyLagoWebhookSignature } = await import('@/lib/billing/lago/webhooks')
      const crypto = await import('node:crypto')
      const payload = JSON.stringify({ webhook_type: 'invoice.paid' })
      const hmac = crypto.createHmac('sha256', 'whsec_test')
      const signature = hmac.update(payload).digest('hex')

      expect(verifyLagoWebhookSignature(payload, signature)).toBe(true)
    })

    it('returns true for signature with sha256= prefix', async () => {
      vi.stubEnv('LAGO_WEBHOOK_SECRET', 'whsec_test')
      vi.resetModules()

      const { verifyLagoWebhookSignature } = await import('@/lib/billing/lago/webhooks')
      const crypto = await import('node:crypto')
      const payload = JSON.stringify({ webhook_type: 'invoice.paid' })
      const hmac = crypto.createHmac('sha256', 'whsec_test')
      const hex = hmac.update(payload).digest('hex')

      expect(verifyLagoWebhookSignature(payload, `sha256=${hex}`)).toBe(true)
    })

    it('returns false for invalid signature', async () => {
      vi.stubEnv('LAGO_WEBHOOK_SECRET', 'whsec_test')
      vi.resetModules()

      const { verifyLagoWebhookSignature } = await import('@/lib/billing/lago/webhooks')
      expect(verifyLagoWebhookSignature('{}', 'bad_signature')).toBe(false)
    })

    it('returns false for null signature header', async () => {
      vi.stubEnv('LAGO_WEBHOOK_SECRET', 'whsec_test')
      vi.resetModules()

      const { verifyLagoWebhookSignature } = await import('@/lib/billing/lago/webhooks')
      expect(verifyLagoWebhookSignature('{}', null)).toBe(false)
    })

    it('returns true when secret is not configured (passthrough)', async () => {
      vi.stubEnv('LAGO_WEBHOOK_SECRET', '')
      vi.resetModules()

      const { verifyLagoWebhookSignature } = await import('@/lib/billing/lago/webhooks')
      expect(verifyLagoWebhookSignature('{}', 'anything')).toBe(true)
    })

    it('returns false when signature length mismatch causes timingSafeEqual to throw', async () => {
      vi.stubEnv('LAGO_WEBHOOK_SECRET', 'whsec_test')
      vi.resetModules()

      const { verifyLagoWebhookSignature } = await import('@/lib/billing/lago/webhooks')
      // timingSafeEqual throws if buffers have different lengths
      expect(verifyLagoWebhookSignature('{}', 'ab')).toBe(false)
    })
  })
})
