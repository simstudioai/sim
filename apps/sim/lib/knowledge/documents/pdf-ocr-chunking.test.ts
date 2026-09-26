import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  /**
   * pdf-lib stamps the modification date into every save and the object streams are deflated,
   * so two builds of the same pages a second apart can differ by a byte. The byte budgets below
   * are derived from one build and applied to another; a pinned clock keeps them comparable.
   */
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
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
