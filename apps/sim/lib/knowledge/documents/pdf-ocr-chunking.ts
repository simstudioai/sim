import { PDFDocument } from 'pdf-lib'
import { PermanentDocumentProcessingError } from '@/lib/knowledge/documents/document-processing-error'
import type { OcrRequestPolicy } from '@/lib/knowledge/documents/ocr-request-policy'

export interface PdfOcrChunk {
  buffer: Buffer
  startPage: number
  endPage: number
}

async function buildPdfChunk(
  sourcePdf: PDFDocument,
  startPage: number,
  endPage: number
): Promise<PdfOcrChunk> {
  const outputPdf = await PDFDocument.create()
  const pageIndices = Array.from(
    { length: endPage - startPage + 1 },
    (_, index) => startPage + index
  )
  const copiedPages = await outputPdf.copyPages(sourcePdf, pageIndices)
  for (const page of copiedPages) outputPdf.addPage(page)

  return {
    buffer: Buffer.from(await outputPdf.save()),
    startPage,
    endPage,
  }
}

/**
 * Builds the largest contiguous chunk that satisfies both the request's page
 * and serialized-byte ceilings. Every candidate is measured after serialization
 * because source PDF size is not a safe proxy for an extracted range's size.
 */
export async function buildLargestFittingPdfChunk(
  sourcePdf: PDFDocument,
  startPage: number,
  totalPages: number,
  policy: OcrRequestPolicy
): Promise<PdfOcrChunk> {
  let lowEndPage = startPage
  let highEndPage = Math.min(startPage + policy.maxPages - 1, totalPages - 1)
  const desired = await buildPdfChunk(sourcePdf, startPage, highEndPage)
  if (desired.buffer.length <= policy.maxBytes) return desired
  highEndPage--
  let bestChunk: PdfOcrChunk | null = null

  while (lowEndPage <= highEndPage) {
    const candidateEndPage = Math.floor((lowEndPage + highEndPage) / 2)
    const candidate = await buildPdfChunk(sourcePdf, startPage, candidateEndPage)

    if (candidate.buffer.length <= policy.maxBytes) {
      bestChunk = candidate
      lowEndPage = candidateEndPage + 1
    } else {
      highEndPage = candidateEndPage - 1
    }
  }

  if (bestChunk) return bestChunk

  throw new PermanentDocumentProcessingError(
    'document_complexity_limit',
    `Page ${startPage + 1} cannot fit within the OCR provider's ${policy.maxBytes.toLocaleString()}-byte request limit. Split or optimize the PDF and retry.`
  )
}
