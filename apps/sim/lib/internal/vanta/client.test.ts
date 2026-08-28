/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchVantaWithAuth } from '@/lib/internal/vanta/client'

describe('Vanta provider client', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes caller cancellation through token exchange and provider work', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ access_token: 'token', expires_in: 0 }, { status: 200 })
    )
    const controller = new AbortController()
    const provider = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))

    await fetchVantaWithAuth(
      {
        clientId: 'client-cancellation',
        clientSecret: 'secret-cancellation',
        scope: 'scope',
      },
      provider,
      { signal: controller.signal }
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vanta.com/oauth/token',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(provider).toHaveBeenCalledWith('token')
  })

  it('aborts the shared token request when its last waiter cancels', async () => {
    let tokenSignal: AbortSignal | undefined
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          tokenSignal = init?.signal ?? undefined
          tokenSignal?.addEventListener('abort', () => reject(tokenSignal?.reason), { once: true })
        })
    )
    const controller = new AbortController()
    const provider = vi.fn()
    const pending = fetchVantaWithAuth(
      {
        clientId: 'client-abort',
        clientSecret: 'secret-abort',
        scope: 'scope',
      },
      provider,
      { signal: controller.signal }
    )
    await vi.waitFor(() => expect(tokenSignal).toBeDefined())
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(tokenSignal?.aborted).toBe(true)
    expect(provider).not.toHaveBeenCalled()
  })

  it('consumes a 401 response and retries once with a fresh token', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ access_token: 'token-1', expires_in: 0 }, { status: 200 })
      )
      .mockResolvedValueOnce(
        Response.json({ access_token: 'token-2', expires_in: 0 }, { status: 200 })
      )
    let cancelled = false
    const unauthorized = new Response(
      new ReadableStream({
        start: (controller) => {
          controller.enqueue(new TextEncoder().encode('unauthorized'))
          controller.close()
        },
        cancel: () => {
          cancelled = true
        },
      }),
      { status: 401 }
    )
    const provider = vi
      .fn()
      .mockResolvedValueOnce(unauthorized)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))

    const response = await fetchVantaWithAuth(
      {
        clientId: 'client-retry',
        clientSecret: 'secret-retry',
        scope: 'scope',
      },
      provider
    )

    expect(response.status).toBe(200)
    expect(provider.mock.calls).toEqual([['token-1'], ['token-2']])
    expect(cancelled).toBe(false)
    expect(unauthorized.bodyUsed).toBe(true)
  })
})
