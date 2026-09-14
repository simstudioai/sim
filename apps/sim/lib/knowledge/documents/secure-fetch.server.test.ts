/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  route: vi.fn(),
  gatewayFetch: vi.fn(),
  directFetch: vi.fn(),
}))
vi.mock('@/lib/core/network/context.server', () => ({
  resolveCurrentOutboundRoute: mocks.route,
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  createSsrfGuardedFetchWithDispatcher: () => ({ fetch: mocks.gatewayFetch }),
  secureFetchWithValidation: vi.fn(),
}))

import { OutboundRoutingError } from '@/lib/core/network/routing'
import { fetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'

const url = 'https://api.example.invalid/items'
const noRetries = { maxRetries: 0, retryBudgetMs: 1_000 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mocks.directFetch)
  mocks.route.mockResolvedValue({ kind: 'direct' })
  mocks.directFetch.mockImplementation(async () => new Response('direct'))
  mocks.gatewayFetch.mockImplementation(async () => new Response('gateway'))
})
afterEach(() => vi.unstubAllGlobals())

describe('connector request routing', () => {
  it('preserves native fetch and request options for direct organizations', async () => {
    const response = await fetchWithRetry(
      url,
      { method: 'POST', body: 'payload', headers: { authorization: 'Bearer test' } },
      noRetries
    )
    expect(await response.text()).toBe('direct')
    expect(mocks.directFetch).toHaveBeenCalledWith(url, {
      method: 'POST',
      body: 'payload',
      headers: { authorization: 'Bearer test' },
      signal: expect.any(AbortSignal),
    })
    expect(mocks.gatewayFetch).not.toHaveBeenCalled()
  })

  it('uses the validated gateway transport for a managed organization', async () => {
    mocks.route.mockResolvedValue({ kind: 'gateway' })
    const response = await fetchWithRetry(url, {}, noRetries)
    expect(await response.text()).toBe('gateway')
    expect(mocks.directFetch).not.toHaveBeenCalled()
  })

  it('reads policy after provider admission and never bypasses a revoked route', async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init: RequestInit, transport: typeof fetch) => {
        mocks.route.mockRejectedValue(new OutboundRoutingError('ROUTE_BLOCKED'))
        return transport(input, init)
      }
    )
    await expect(fetchWithRetry(url, {}, { ...noRetries, fetcher })).rejects.toMatchObject({
      code: 'ROUTE_BLOCKED',
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(mocks.directFetch).not.toHaveBeenCalled()
    expect(mocks.gatewayFetch).not.toHaveBeenCalled()
  })

  it('does not fall back to native fetch after gateway failure', async () => {
    mocks.route.mockResolvedValue({ kind: 'gateway' })
    mocks.gatewayFetch.mockRejectedValue(new OutboundRoutingError('GATEWAY_UNAVAILABLE'))
    await expect(fetchWithRetry(url, {}, noRetries)).rejects.toMatchObject({
      code: 'GATEWAY_UNAVAILABLE',
    })
    expect(mocks.directFetch).not.toHaveBeenCalled()
  })
})
