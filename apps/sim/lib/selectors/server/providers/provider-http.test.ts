/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SelectorOptionsUnavailableError } from '@/lib/selectors/server/errors'
import {
  fetchProviderJson,
  fetchProviderJsonWithStatus,
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
})
