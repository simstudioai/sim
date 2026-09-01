/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  fetchProviderJson,
  fetchProviderJsonWithStatus,
  RetryableProviderNetworkError,
} from '@/lib/selectors/server/providers/provider-http'

const mockFetch = vi.fn()

function openBody(onCancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{}'))
    },
    cancel: onCancel,
  })
}

describe('provider HTTP selector boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterAll(() => vi.unstubAllGlobals())

  it('cancels rejected and declared-oversized provider bodies', async () => {
    const rejectedCancel = vi.fn()
    mockFetch.mockResolvedValueOnce(
      new Response(openBody(rejectedCancel), { status: 502, statusText: 'Bad Gateway' })
    )

    await expect(fetchProviderJson('https://provider.example/items')).rejects.toBeInstanceOf(
      SelectorOptionsUnavailableError
    )
    expect(rejectedCancel).toHaveBeenCalledOnce()

    const oversizedCancel = vi.fn()
    mockFetch.mockResolvedValueOnce(
      new Response(openBody(oversizedCancel), {
        status: 200,
        headers: { 'content-length': String(16 * 1024 * 1024 + 1) },
      })
    )

    await expect(fetchProviderJson('https://provider.example/items')).rejects.toBeInstanceOf(
      SelectorOptionsUnavailableError
    )
    expect(oversizedCancel).toHaveBeenCalledOnce()
  })

  it('returns only an allowlisted error status after discarding its body', async () => {
    const cancel = vi.fn()
    mockFetch.mockResolvedValueOnce(new Response(openBody(cancel), { status: 404 }))

    await expect(
      fetchProviderJsonWithStatus('https://provider.example/item', undefined, {
        passthroughStatuses: [404],
      })
    ).resolves.toEqual({ ok: false, status: 404 })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('can preserve a generic retry signal without exposing the raw network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed with provider-secret-canary'))

    await expect(
      fetchProviderJsonWithStatus('https://provider.example/item', undefined, {
        passthroughNetworkErrors: true,
      })
    ).rejects.toEqual(new RetryableProviderNetworkError())
  })

  it.each([
    [401, SelectorConnectionUnavailableError, 401],
    [403, SelectorConnectionUnavailableError, 403],
    [429, SelectorOptionsUnavailableError, 429],
    [500, SelectorOptionsUnavailableError, 502],
  ])(
    'maps provider status %s without exposing its body',
    async (status, ErrorType, expectedStatus) => {
      const cancel = vi.fn()
      mockFetch.mockResolvedValueOnce(
        new Response(openBody(cancel), { status, statusText: 'provider-controlled diagnostic' })
      )

      await expect(fetchProviderJson('https://provider.example/items')).rejects.toMatchObject({
        name: ErrorType.name,
        status: expectedStatus,
        message:
          status === 401 || status === 403 ? 'Connection unavailable' : 'Options unavailable',
      })
      expect(cancel).toHaveBeenCalledOnce()
    }
  )
})
