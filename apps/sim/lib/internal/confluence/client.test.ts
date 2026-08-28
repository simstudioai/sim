/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetConfluenceCloudId } = vi.hoisted(() => ({
  mockGetConfluenceCloudId: vi.fn(),
}))

vi.mock('@/tools/confluence/utils', () => ({
  getConfluenceCloudId: mockGetConfluenceCloudId,
}))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { ConfluenceClient, createConfluenceClient } from '@/lib/internal/confluence/client'
import { ConfluenceOperationError } from '@/lib/internal/confluence/errors'

const CLOUD_ID = '12345678-1234-1234-1234-123456789012'

describe('ConfluenceClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('applies Atlassian authentication and forwards cancellation', async () => {
    const response = Response.json({ id: 'page-1' })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const client = new ConfluenceClient(CLOUD_ID, 'access-token')

    await expect(
      client.json(client.apiV2('/pages/page-1'), {}, controller.signal)
    ).resolves.toEqual({ id: 'page-1' })

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.atlassian.com/ex/confluence/${CLOUD_ID}/wiki/api/v2/pages/page-1`,
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer access-token',
        },
        signal: controller.signal,
      })
    )
    expect(response.bodyUsed).toBe(true)
  })

  it('consumes provider error bodies and preserves provider status', async () => {
    const response = new Response(JSON.stringify({ message: 'Page not found' }), {
      status: 404,
      statusText: 'Not Found',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const client = new ConfluenceClient(CLOUD_ID, 'access-token')

    let caught: unknown
    try {
      await client.json(client.apiV2('/pages/missing'))
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ConfluenceOperationError)
    expect(caught).toMatchObject({ status: 404 })
    expect(response.bodyUsed).toBe(true)
  })

  it.each([
    { status: 200, maxBytes: 10 * 1024 * 1024, label: 'Confluence response' },
    { status: 502, maxBytes: 64 * 1024, label: 'Confluence error response' },
  ])('bounds and cancels $status provider responses', async ({ status, maxBytes, label }) => {
    let cancelled = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel: () => {
          cancelled = true
        },
      }),
      { status, headers: { 'content-length': String(maxBytes + 1) } }
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const client = new ConfluenceClient(CLOUD_ID, 'access-token')

    await expect(client.json(client.apiV2('/pages/page-1'))).rejects.toEqual(
      new PayloadSizeLimitError({ label, maxBytes, observedBytes: maxBytes + 1 })
    )
    expect(cancelled).toBe(true)
  })

  it('does not issue a request after cancellation', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()
    const client = new ConfluenceClient(CLOUD_ID, 'access-token')

    await expect(
      client.fetch(client.apiV2('/pages/page-1'), {}, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops waiting for cloud discovery when execution is cancelled', async () => {
    mockGetConfluenceCloudId.mockReturnValue(new Promise<string>(() => {}))
    const controller = new AbortController()
    const pending = createConfluenceClient(
      { domain: 'example.atlassian.net', accessToken: 'access-token' },
      controller.signal
    )

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockGetConfluenceCloudId).toHaveBeenCalledWith('example.atlassian.net', 'access-token')
  })
})
