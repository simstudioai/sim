/**
 * @vitest-environment node
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/pdf'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockOpenPdfDocument } = vi.hoisted(() => ({
  mockOpenPdfDocument: vi.fn(),
}))

vi.mock('@/lib/file-parsers/pdfjs-server', () => ({
  openPdfDocument: mockOpenPdfDocument,
}))

import { PdfParser } from '@/lib/file-parsers/pdf-parser'

describe('PdfParser cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects an already-cancelled parse before opening pdf.js', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'), { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockOpenPdfDocument).not.toHaveBeenCalled()
  })

  it('forwards cancellation while pdf.js is opening', async () => {
    const controller = new AbortController()
    mockOpenPdfDocument.mockImplementationOnce(
      (_data: Uint8Array, signal?: AbortSignal) =>
        new Promise<PDFDocumentProxy>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )

    const parsing = new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'), {
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(mockOpenPdfDocument).toHaveBeenCalledOnce())
    controller.abort()

    await expect(parsing).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockOpenPdfDocument).toHaveBeenCalledWith(expect.any(Uint8Array), controller.signal)
  })

  it('cancels a pending text reader and releases page and document state', async () => {
    const reader = {
      cancel: vi.fn().mockResolvedValue(undefined),
      read: vi.fn(() => new Promise<never>(() => {})),
    }
    const page = {
      cleanup: vi.fn(),
      streamTextContent: vi.fn(() => ({ getReader: () => reader })),
    } as PDFPageProxy
    const pdf = {
      destroy: vi.fn().mockResolvedValue(undefined),
      getPage: vi.fn().mockResolvedValue(page),
      numPages: 1,
    } as PDFDocumentProxy
    mockOpenPdfDocument.mockResolvedValueOnce(pdf)
    const controller = new AbortController()

    const parsing = new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'), {
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledOnce())
    controller.abort()

    await expect(parsing).rejects.toMatchObject({ name: 'AbortError' })
    expect(reader.cancel).toHaveBeenCalledOnce()
    expect(page.cleanup).toHaveBeenCalledOnce()
    expect(pdf.destroy).toHaveBeenCalledOnce()
  })

  it('cancels a stalled text reader at the extraction deadline and returns a partial result', async () => {
    vi.useFakeTimers()
    const reader = {
      cancel: vi.fn().mockResolvedValue(undefined),
      read: vi
        .fn()
        .mockResolvedValueOnce({ value: { items: [{ str: 'partial page text' }] }, done: false })
        .mockImplementation(() => new Promise<never>(() => {})),
    }
    const page = {
      cleanup: vi.fn(),
      streamTextContent: vi.fn(() => ({ getReader: () => reader })),
    } as PDFPageProxy
    const pdf = {
      destroy: vi.fn().mockResolvedValue(undefined),
      getPage: vi.fn().mockResolvedValue(page),
      numPages: 1,
    } as PDFDocumentProxy
    mockOpenPdfDocument.mockResolvedValueOnce(pdf)

    const parsing = new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'))
    await vi.advanceTimersByTimeAsync(0)
    expect(reader.read).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(60_000)
    const result = await parsing

    expect(result.metadata).toMatchObject({ pageCount: 1, truncated: true })
    expect(result.content).toContain('partial page text')
    expect(result.content).toMatch(/PDF text truncated at parser limits/)
    expect(reader.cancel).toHaveBeenCalledOnce()
    expect(page.cleanup).toHaveBeenCalledOnce()
    expect(pdf.destroy).toHaveBeenCalledOnce()
  })

  it('stops at the extraction deadline when loading a page stalls', async () => {
    vi.useFakeTimers()
    const pdf = {
      destroy: vi.fn().mockResolvedValue(undefined),
      getPage: vi.fn(() => new Promise<never>(() => {})),
      numPages: 1,
    } as PDFDocumentProxy
    mockOpenPdfDocument.mockResolvedValueOnce(pdf)

    const parsing = new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'))
    await vi.advanceTimersByTimeAsync(0)
    expect(pdf.getPage).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(60_000)
    const result = await parsing

    expect(result.metadata).toMatchObject({ pageCount: 1, truncated: true })
    expect(pdf.destroy).toHaveBeenCalledOnce()
  })
})
