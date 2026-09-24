/** @vitest-environment node */
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: fetchMock,
}))

import { fetchLinkPreview } from '@/lib/link-preview/fetch-preview'

const PAGE = 'https://example.com/docs/guide'
const IMAGE = 'https://images.example.com/card.png'
function page(image = IMAGE) {
  return new Response(
    `<meta property="og:title" content="Guide"><meta property="og:description" content="A useful guide"><meta property="og:image" content="${image}">`,
    { headers: { 'content-type': 'text/html' } }
  )
}

describe('public link preview images', () => {
  beforeEach(() => fetchMock.mockReset())

  it('normalizes a raster to a bounded thumbnail and guards both requests and redirects', async () => {
    const input = await sharp({
      create: { width: 1200, height: 630, channels: 3, background: '#5577aa' },
    })
      .png()
      .toBuffer()
    fetchMock
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(
        new Response(new Uint8Array(input), { headers: { 'content-type': 'image/png' } })
      )
    const result = await fetchLinkPreview(PAGE)
    expect(result?.title).toBe('Guide')
    expect(result?.image).toMatch(/^data:image\/webp;base64,/)
    const buffer = Buffer.from(result!.image!.split(',')[1], 'base64')
    expect(buffer.length).toBeLessThanOrEqual(128 * 1024)
    expect(await sharp(buffer).metadata()).toMatchObject({
      format: 'webp',
      width: 640,
      height: 336,
    })
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toMatchObject({
        profile: 'contentFetch',
        maxRedirects: 3,
        signal: expect.any(AbortSignal),
      })
      expect(() => options.assertRedirectTarget('http://example.com')).toThrow()
      expect(() => options.assertRedirectTarget('https://user:password@example.com')).toThrow()
    }
    expect(fetchMock.mock.calls[0][1].maxResponseBytes).toBe(1024 * 1024)
    expect(fetchMock.mock.calls[1][1].maxResponseBytes).toBe(2 * 1024 * 1024)
  })

  it.each(['http://example.com/image.png', 'data:image/png;base64,AA==', 'file:///tmp/image.png'])(
    'skips unsafe image schemes: %s',
    async (image) => {
      fetchMock.mockResolvedValueOnce(page(image))
      expect(await fetchLinkPreview(PAGE)).toEqual({
        title: 'Guide',
        description: 'A useful guide',
        siteName: null,
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('resolves relative images against the final redirected page', async () => {
    fetchMock
      .mockImplementationOnce(async (_url, options) => {
        options.assertRedirectTarget('https://example.com/new/page')
        return page('../card.png')
      })
      .mockResolvedValueOnce(new Response('', { status: 404 }))
    await fetchLinkPreview(PAGE)
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/card.png')
  })

  it('retains text metadata when the image is blocked by the network guard', async () => {
    fetchMock.mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error('Private IP blocked'))
    expect(await fetchLinkPreview(PAGE)).toMatchObject({
      title: 'Guide',
      description: 'A useful guide',
    })
  })

  it('rejects SVG even when served with a raster content type', async () => {
    fetchMock
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(
        new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>',
          { headers: { 'content-type': 'image/png' } }
        )
      )
    expect((await fetchLinkPreview(PAGE))?.image).toBeUndefined()
  })

  it('propagates caller cancellation instead of publishing an incomplete cached preview', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValueOnce(page()).mockImplementationOnce(async (_url, options) => {
      controller.abort()
      options.signal.throwIfAborted()
    })
    await expect(fetchLinkPreview(PAGE, controller.signal)).rejects.toThrow()
  })

  it('retains page metadata when only the optional image exhausts the deadline', async () => {
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    fetchMock.mockResolvedValueOnce(page()).mockImplementationOnce(async (_url, options) => {
      deadline.abort(new DOMException('Preview deadline exceeded', 'TimeoutError'))
      options.signal.throwIfAborted()
    })
    try {
      expect(await fetchLinkPreview(PAGE, new AbortController().signal)).toEqual({
        title: 'Guide',
        description: 'A useful guide',
        siteName: null,
        imageRetryable: true,
      })
    } finally {
      timeout.mockRestore()
    }
  })

  it('rejects credentials before making a request', async () => {
    await expect(fetchLinkPreview('https://user:password@example.com')).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('admits only two image requests at once and releases capacity without queueing the rest', async () => {
    const releases: Array<() => void> = []
    fetchMock.mockImplementation(async (url) => {
      if (url !== IMAGE) return page()
      return new Promise<Response>((resolve) => {
        releases.push(() => resolve(new Response('', { status: 404 })))
      })
    })
    const pending = Array.from({ length: 60 }, (_, index) => fetchLinkPreview(`${PAGE}?n=${index}`))
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    expect(fetchMock.mock.calls.filter(([url]) => url === IMAGE)).toHaveLength(2)
    releases.forEach((release) => release())
    const results = await Promise.all(pending)
    expect(results.filter((result) => result?.imageRetryable)).toHaveLength(58)

    fetchMock.mockResolvedValueOnce(page()).mockResolvedValueOnce(new Response('', { status: 404 }))
    expect((await fetchLinkPreview(PAGE))?.imageRetryable).toBeUndefined()
    expect(fetchMock.mock.calls.filter(([url]) => url === IMAGE)).toHaveLength(3)
  })

  it('marks temporary image-server failures as retryable while preserving text', async () => {
    fetchMock.mockResolvedValueOnce(page()).mockResolvedValueOnce(new Response('', { status: 503 }))
    expect(await fetchLinkPreview(PAGE)).toMatchObject({ title: 'Guide', imageRetryable: true })
  })
})
