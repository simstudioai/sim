/**
 * @vitest-environment node
 */
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PermanentDocumentProcessingError } from '@/lib/knowledge/documents/document-processing-error'
import type { OcrRequestPolicy } from '@/lib/knowledge/documents/ocr-request-policy'
import { buildLargestFittingPdfChunk } from '@/lib/knowledge/documents/pdf-ocr-chunking'

async function createSourcePdf(pageCount: number): Promise<PDFDocument> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let page = 0; page < pageCount; page++) {
    pdf.addPage().drawText(`Unique OCR test page ${page + 1} ${'x'.repeat(page * 40)}`, { font })
  }
  return pdf
}

function policy(overrides: Partial<OcrRequestPolicy> = {}): OcrRequestPolicy {
  return {
    maxBytes: 1_000_000,
    maxPages: 1000,
    maxChunks: 10,
    concurrency: 2,
    ...overrides,
  }
}

describe('buildLargestFittingPdfChunk', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serializes a fitting page range once', async () => {
    const source = await createSourcePdf(20)
    const save = vi.spyOn(PDFDocument.prototype, 'save')

    const chunk = await buildLargestFittingPdfChunk(source, 0, 20, policy())

    expect(chunk.endPage).toBe(19)
    expect(save).toHaveBeenCalledOnce()
  })

  it('obeys the page ceiling while retaining a contiguous range', async () => {
    const source = await createSourcePdf(5)

    const chunk = await buildLargestFittingPdfChunk(source, 1, 5, policy({ maxPages: 2 }))

    expect(chunk.startPage).toBe(1)
    expect(chunk.endPage).toBe(2)
  })

  it('shrinks a chunk until its serialized bytes fit', async () => {
    const source = await createSourcePdf(3)
    const onePage = await buildLargestFittingPdfChunk(source, 0, 3, policy({ maxPages: 1 }))
    const twoPages = await buildLargestFittingPdfChunk(source, 0, 3, policy({ maxPages: 2 }))
    expect(twoPages.buffer.length).toBeGreaterThan(onePage.buffer.length)

    const maxBytes = twoPages.buffer.length - 1
    const chunk = await buildLargestFittingPdfChunk(source, 0, 3, policy({ maxBytes, maxPages: 3 }))

    expect(chunk.buffer.length).toBeLessThanOrEqual(maxBytes)
    expect(chunk.endPage).toBeLessThan(2)
  })

  it('returns the fitting serialized candidate without rebuilding it', async () => {
    const source = await createSourcePdf(4)
    const threePages = await buildLargestFittingPdfChunk(source, 0, 4, policy({ maxPages: 3 }))
    const originalSave = PDFDocument.prototype.save
    const serializedPages: number[] = []
    vi.spyOn(PDFDocument.prototype, 'save').mockImplementation(function (
      this: PDFDocument,
      options
    ) {
      serializedPages.push(this.getPageCount())
      return originalSave.call(this, options)
    })

    const chunk = await buildLargestFittingPdfChunk(
      source,
      0,
      4,
      policy({ maxBytes: threePages.buffer.length - 1 })
    )

    expect(chunk.endPage).toBe(1)
    expect(serializedPages).toEqual([4, 2, 3])
  })

  it('permanently rejects a page that cannot fit by itself', async () => {
    const source = await createSourcePdf(1)
    const onePage = await buildLargestFittingPdfChunk(source, 0, 1, policy())

    const failure = buildLargestFittingPdfChunk(
      source,
      0,
      1,
      policy({ maxBytes: onePage.buffer.length - 1 })
    )

    await expect(failure).rejects.toBeInstanceOf(PermanentDocumentProcessingError)
    await expect(failure).rejects.toThrow(/Page 1 cannot fit/)
  })
})
