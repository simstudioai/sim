/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { openPdf, destroy } = vi.hoisted(() => ({ openPdf: vi.fn(), destroy: vi.fn() }))
vi.mock('@/lib/file-parsers/pdfjs-server', () => ({ openPdfDocument: openPdf }))

import { countMistralPdfPages } from '@/lib/internal/mistral/page-count'

describe('Mistral PDF page measurement', () => {
  const bytes = Buffer.from('%PDF-1.7 page-count fixture')
  beforeEach(() => {
    vi.clearAllMocks()
    destroy.mockResolvedValue(undefined)
    openPdf.mockResolvedValue({ numPages: 3, destroy })
  })
  afterEach(() => vi.useRealTimers())

  it('uses the parsed page count and releases the PDF without extracting text', async () => {
    await expect(countMistralPdfPages(bytes)).resolves.toBe(3)
    expect(openPdf).toHaveBeenCalledWith(new Uint8Array(bytes), expect.any(AbortSignal))
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('does not parse non-PDF bytes or trust an invalid page count', async () => {
    await expect(countMistralPdfPages(Buffer.from('not a PDF'))).resolves.toBeUndefined()
    expect(openPdf).not.toHaveBeenCalled()
    openPdf.mockResolvedValue({ numPages: 0, destroy })
    await expect(countMistralPdfPages(bytes)).resolves.toBeUndefined()
  })

  it('retains conservative accounting when encrypted or malformed PDFs cannot be opened', async () => {
    openPdf.mockRejectedValue(new Error('Password required'))
    await expect(countMistralPdfPages(bytes)).resolves.toBeUndefined()
  })

  it('bounds a stalled PDF opening and releases a document that arrives after cancellation', async () => {
    vi.useFakeTimers()
    let completeOpening!: (pdf: { numPages: number; destroy: typeof destroy }) => void
    openPdf.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeOpening = resolve
        })
    )
    const result = countMistralPdfPages(bytes)
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(result).resolves.toBeUndefined()
    expect(openPdf.mock.calls[0][1].aborted).toBe(true)
    completeOpening({ numPages: 3, destroy })
    await vi.advanceTimersByTimeAsync(1)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('preserves caller cancellation and does not wait for stalled cleanup', async () => {
    const controller = new AbortController()
    openPdf.mockImplementation(async () => {
      controller.abort(new Error('Caller cancelled'))
      return { numPages: 3, destroy }
    })
    destroy.mockImplementation(() => new Promise(() => {}))
    await expect(countMistralPdfPages(bytes, controller.signal)).rejects.toThrow('Caller cancelled')
    expect(destroy).toHaveBeenCalled()
  })
})
