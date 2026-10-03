import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/pdf'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockOpenPdfDocument } = vi.hoisted(() => ({
  mockOpenPdfDocument: vi.fn(),
}))

vi.mock('@/lib/file-parsers/pdfjs-server', () => ({
  openPdfDocument: mockOpenPdfDocument,
}))

import {
  MAX_COMPLETE_PDF_PAGE_CHARS,
  MAX_COMPLETE_PDF_TEXT_BYTES,
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

  it('rejects an excessive page count before starting complete extraction', async () => {
    const { pdf } = pdfWithPageText(10_001, () => 'text')
    mockOpenPdfDocument.mockResolvedValueOnce(pdf)

    await expect(
      new PdfParser().parseBuffer(Buffer.from('%PDF-1.4'), { pdfTextMode: 'complete' })
    ).rejects.toMatchObject({ name: 'FileParserError', code: 'complexity_limit' })
    expect(pdf.getPage).not.toHaveBeenCalled()
    expect(pdf.destroy).toHaveBeenCalledOnce()
  })
})
