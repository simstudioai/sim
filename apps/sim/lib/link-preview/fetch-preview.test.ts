import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: fetchMock,
}))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
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

  it.each([
    new Error('Private IP blocked'),
    new Error('Redirect blocked'),
    new PayloadSizeLimitError({ label: 'response body', maxBytes: 2 * 1024 * 1024 }),
  ])('does not retry permanent image failures: %s', async (error) => {
    fetchMock.mockResolvedValueOnce(page()).mockRejectedValueOnce(error)
    expect(await fetchLinkPreview(PAGE)).toEqual({
      title: 'Guide',
      description: 'A useful guide',
      siteName: null,
    })
  })

  it.each(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'DNS_TIMEOUT'])(
    'retries transient fetch failures through their cause chain: %s',
    async (code) => {
      const cause = Object.assign(new Error('Upstream unavailable'), { code })
      fetchMock
        .mockResolvedValueOnce(page())
        .mockRejectedValueOnce(new Error('Fetch failed', { cause }))
      expect(await fetchLinkPreview(PAGE)).toMatchObject({ title: 'Guide', imageRetryable: true })
    }
  )

  it('retries an image whose body closes before completing', async () => {
    const interrupted = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([137, 80, 78, 71]))
        controller.error(
          Object.assign(new Error('Stream closed before completing'), {
            code: 'ERR_STREAM_PREMATURE_CLOSE',
          })
        )
      },
    })
    fetchMock
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(
        new Response(interrupted, { headers: { 'content-type': 'image/png' } })
      )
    expect(await fetchLinkPreview(PAGE)).toEqual({
      title: 'Guide',
      description: 'A useful guide',
      siteName: null,
      imageRetryable: true,
    })
  })

  it.each([
    { status: 404, contentType: 'image/png', retryable: undefined },
    { status: 429, contentType: 'image/png', retryable: true },
    { status: 503, contentType: 'image/png', retryable: true },
    { status: 200, contentType: 'image/svg+xml', retryable: undefined },
  ])(
    'cancels rejected image bodies: $status $contentType',
    async ({ status, contentType, retryable }) => {
      const cancel = vi.fn()
      const response = new Response(new ReadableStream({ cancel }), {
        status,
        headers: { 'content-type': contentType },
      })
      const read = vi.spyOn(response, 'arrayBuffer')
      fetchMock.mockResolvedValueOnce(page()).mockResolvedValueOnce(response)
      const result = await fetchLinkPreview(PAGE)
      expect(result?.imageRetryable).toBe(retryable)
      expect(cancel).toHaveBeenCalledOnce()
      expect(read).not.toHaveBeenCalled()
    }
  )

  it.each([
    { status: 404, contentType: 'text/html' },
    { status: 503, contentType: 'text/html' },
    { status: 200, contentType: 'application/octet-stream' },
    { status: 200, contentType: 'text/html-invalid' },
  ])('cancels rejected page bodies: $status $contentType', async ({ status, contentType }) => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), {
      status,
      headers: { 'content-type': contentType },
    })
    const read = vi.spyOn(response, 'text')
    fetchMock.mockResolvedValueOnce(response)
    expect(await fetchLinkPreview(PAGE)).toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
    expect(read).not.toHaveBeenCalled()
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

  it('rejects credentials before making a request', async () => {
    await expect(fetchLinkPreview('https://user:password@example.com')).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
