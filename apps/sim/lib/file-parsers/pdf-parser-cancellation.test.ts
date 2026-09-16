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

import {
  MAX_COMPLETE_PDF_PAGE_CHARS,
  MAX_COMPLETE_PDF_TEXT_BYTES,
  MAX_PDF_TEXT_CHARS,
  PdfParser,
} from '@/lib/file-parsers/pdf-parser'

function pdfWithPageText(pageCount: number, getText: (pageNumber: number) => string) {
  const cancel = vi.fn().mockResolvedValue(undefined)
  const cleanup = vi.fn()
  const getPage = vi.fn(async (pageNumber: number) => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ value: { items: [{ str: getText(pageNumber) }] }, done: false })
      .mockResolvedValue({ done: true })
    return { cleanup, streamTextContent: () => ({ getReader: () => ({ read, cancel }) }) }
  })
  const pdf = { numPages: pageCount, getPage, destroy: vi.fn().mockResolvedValue(undefined) }
  return { pdf, cleanup, cancel }
}

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

  it('completes more than the preview budget across normal pages without truncation', async () => {
    const { pdf, cleanup, cancel } = pdfWithPageText(
      1339,
      (pageNumber) => `Page ${pageNumber}: ${'Readable native text. '.repeat(430)}`
    )
    mockOpenPdfDocument.mockResolvedValueOnce(pdf)

    const result = await new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'), {
      pdfTextMode: 'complete',
    })

    expect(result.content.length).toBeGreaterThan(MAX_PDF_TEXT_CHARS)
    expect(Buffer.byteLength(result.content, 'utf8')).toBeLessThan(MAX_COMPLETE_PDF_TEXT_BYTES)
    expect(result.content).toContain('Page 1339:')
    expect(result.metadata).toMatchObject({ pageCount: 1339, truncated: false })
    expect(pdf.getPage).toHaveBeenCalledTimes(1339)
    expect(cleanup).toHaveBeenCalledTimes(1339)
    expect(cancel).not.toHaveBeenCalled()
    expect(pdf.destroy).toHaveBeenCalledOnce()
  })

  it('rejects one expanded page before reading later pages in complete mode', async () => {
    const { pdf, cleanup, cancel } = pdfWithPageText(2, () =>
      'A'.repeat(MAX_COMPLETE_PDF_PAGE_CHARS + 1)
    )
    mockOpenPdfDocument.mockResolvedValueOnce(pdf)

    await expect(
      new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'), { pdfTextMode: 'complete' })
    ).rejects.toMatchObject({
      name: 'FileParserError',
      code: 'complexity_limit',
      message: expect.stringContaining('characters per page'),
    })
    expect(pdf.getPage).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(pdf.destroy).toHaveBeenCalledOnce()
  })

  it('accounts for UTF-8 bytes and stops at the complete output ceiling', async () => {
    const pageText = '日'.repeat(MAX_COMPLETE_PDF_PAGE_CHARS)
    const { pdf } = pdfWithPageText(40, () => pageText)
    mockOpenPdfDocument.mockResolvedValueOnce(pdf)
    const pagesToExceed = Math.ceil(MAX_COMPLETE_PDF_TEXT_BYTES / Buffer.byteLength(pageText))

    await expect(
      new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'), { pdfTextMode: 'complete' })
    ).rejects.toMatchObject({
      name: 'FileParserError',
      code: 'complexity_limit',
      message: expect.stringContaining('byte output limit'),
    })
    expect(pdf.getPage).toHaveBeenCalledTimes(pagesToExceed)
    expect(pdf.destroy).toHaveBeenCalledOnce()
  })

  it('cancels complete extraction during a stalled reader and releases state', async () => {
    const controller = new AbortController()
    const read = vi.fn(() => new Promise<never>(() => {}))
    const cancel = vi.fn().mockResolvedValue(undefined)
    const page = {
      cleanup: vi.fn(),
      streamTextContent: () => ({ getReader: () => ({ read, cancel }) }),
    }
    const pdf = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue(page),
      destroy: vi.fn().mockResolvedValue(undefined),
    }
    mockOpenPdfDocument.mockResolvedValueOnce(pdf)
    const parsing = new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'), {
      pdfTextMode: 'complete',
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    controller.abort()

    await expect(parsing).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(page.cleanup).toHaveBeenCalledOnce()
    expect(pdf.destroy).toHaveBeenCalledOnce()
  })

  it('includes opening the PDF in the complete extraction deadline', async () => {
    vi.useFakeTimers()
    mockOpenPdfDocument.mockImplementationOnce(
      (_data: Uint8Array, signal?: AbortSignal) =>
        new Promise<PDFDocumentProxy>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const parsing = new PdfParser()
      .parseBuffer(Buffer.from('%PDF-1.4'), { pdfTextMode: 'complete' })
      .catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(60_000)

    expect(await parsing).toMatchObject({ name: 'FileParserError', code: 'complexity_limit' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects an excessive page count before starting complete extraction', async () => {
    const { pdf } = pdfWithPageText(10_001, () => 'text')
    mockOpenPdfDocument.mockResolvedValueOnce(pdf)

    await expect(
      new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'), { pdfTextMode: 'complete' })
    ).rejects.toMatchObject({ name: 'FileParserError', code: 'complexity_limit' })
    expect(pdf.getPage).not.toHaveBeenCalled()
    expect(pdf.destroy).toHaveBeenCalledOnce()
  })

  it('bounds stalled document cleanup by the complete extraction deadline', async () => {
    vi.useFakeTimers()
    const { pdf } = pdfWithPageText(1, () => 'Readable text')
    pdf.destroy.mockImplementation(() => new Promise<never>(() => {}))
    mockOpenPdfDocument.mockResolvedValueOnce(pdf)
    const parsing = new PdfParser()
      .parseBuffer(Buffer.from('%PDF-1.4'), { pdfTextMode: 'complete' })
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(pdf.destroy).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(60_000)

    expect(await parsing).toMatchObject({ name: 'FileParserError', code: 'complexity_limit' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
