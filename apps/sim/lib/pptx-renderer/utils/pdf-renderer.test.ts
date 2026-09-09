/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderPdfToImage } from '@/lib/pptx-renderer/utils/pdf-renderer'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('renderPdfToImage', () => {
  it('skips rendering when isolated canvas rendering is unavailable', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    expect(await renderPdfToImage(new Uint8Array([1]), 10, 10)).toBeNull()
  })

  it('supplies matching library and worker assets and preserves result/error behavior', async () => {
    vi.useFakeTimers()
    const postMessage = vi.fn()
    const worker = { postMessage, onmessage: null as ((event: MessageEvent) => void) | null }
    vi.stubGlobal('window', { location: { href: 'https://example.com/preview' } })
    /** Model the root-relative asset strings returned by the production bundler. */
    vi.spyOn(URL.prototype, 'toString').mockImplementation(function () {
      return `/_next/static/media/${this.pathname.split('/').pop()}`
    })
    vi.stubGlobal('OffscreenCanvas', class {})
    vi.stubGlobal(
      'Worker',
      vi.fn(function Worker() {
        return worker
      })
    )
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rendered-pdf')
    const input = new Uint8Array([1, 2, 3])

    const result = renderPdfToImage(input, 20, 10)
    const [message, transfer] = postMessage.mock.calls[0]
    expect(message).toMatchObject({
      width: 20,
      height: 10,
      pdfjsUrl: 'https://example.com/_next/static/media/pdf.min.mjs',
      pdfjsWorkerUrl: 'https://example.com/_next/static/media/pdf.worker.min.mjs',
    })
    expect(message.pdfData).toEqual(input)
    expect(message.pdfData).not.toBe(input)
    expect(transfer).toEqual([message.pdfData.buffer])
    worker.onmessage?.({ data: { id: message.id, blob: new Blob(['png']) } } as MessageEvent)
    expect(await result).toBe('blob:rendered-pdf')

    const failed = renderPdfToImage(input, 20, 10)
    worker.onmessage?.({
      data: { id: postMessage.mock.calls[1][0].id, error: 'Invalid PDF' },
    } as MessageEvent)
    expect(await failed).toBeNull()
  })
})
