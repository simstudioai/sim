import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'

const logger = createLogger('PdfParser')

/** Highest page number visited, bounding documents that declare huge page counts. */
const MAX_PDF_PAGES = 10_000

/** Ceiling on extracted characters — roughly 3,000 pages of dense text. */
export const MAX_PDF_TEXT_CHARS = 10_000_000

/** Wall-clock ceiling for extracting text from a whole document. */
const PDF_EXTRACTION_TIMEOUT_MS = 60_000

const PDF_TRUNCATION_WARNING = 'PDF text extraction stopped at a parser limit and is incomplete'

type PdfDocumentProxy = Awaited<ReturnType<typeof import('unpdf')['getDocumentProxy']>>
type PdfPageProxy = Awaited<ReturnType<PdfDocumentProxy['getPage']>>

interface TextContentChunk {
  items?: Array<{ str?: unknown; hasEOL?: unknown }>
}

interface PageExtraction {
  text: string
  /** Characters consumed from the caller's budget. */
  used: number
  /** False when a budget stopped the read before the page was exhausted. */
  completed: boolean
}

interface BoundedExtraction {
  text: string
  /** Page count the document declares, however many pages were actually read. */
  totalPages: number
  /** True when a budget stopped extraction before the document was exhausted. */
  truncated: boolean
}

/**
 * Reads one page's text through pdf.js's streaming API, stopping once the
 * character budget or the deadline is spent.
 *
 * `extractText`/`getTextContent` buffer a page's entire text content before
 * resolving, so a page whose compressed content stream expands to hundreds of
 * megabytes reaches the V8 heap limit and aborts the process — a fatal error no
 * `try/catch` can intercept, taking every other in-flight request with it.
 * `streamTextContent` applies backpressure, so cancelling the reader stops the
 * evaluator rather than letting it run the expansion to completion.
 */
async function readPageWithinBudget(
  page: PdfPageProxy,
  budget: number,
  deadline: number
): Promise<PageExtraction> {
  const reader = page
    .streamTextContent()
    .getReader() as ReadableStreamDefaultReader<TextContentChunk>

  const parts: string[] = []
  let remaining = budget
  let completed = false
  let dropped = false

  try {
    /**
     * Loops until content is actually dropped rather than until the budget hits
     * zero: text that ends exactly on the budget is complete, not truncated.
     */
    while (!dropped && Date.now() <= deadline) {
      const { value, done } = await reader.read()
      if (done) {
        completed = true
        break
      }

      for (const item of value?.items ?? []) {
        if (typeof item?.str !== 'string') continue

        const piece = item.hasEOL === true ? `${item.str}\n` : item.str
        if (piece.length > remaining) {
          parts.push(piece.slice(0, remaining))
          remaining = 0
          dropped = true
          break
        }

        parts.push(piece)
        remaining -= piece.length
      }
    }
  } finally {
    if (!completed) {
      try {
        await reader.cancel(new Error('PDF text extraction budget exceeded'))
      } catch {
        // Cancelling a stream that already failed is not itself an error, and
        // throwing here would mask whatever ended the read loop.
      }
    }
  }

  return { text: parts.join(''), used: budget - remaining, completed }
}

async function extractTextWithinBudget(pdf: PdfDocumentProxy): Promise<BoundedExtraction> {
  const deadline = Date.now() + PDF_EXTRACTION_TIMEOUT_MS
  const totalPages = pdf.numPages
  const pageLimit = Math.min(totalPages, MAX_PDF_PAGES)
  const pageTexts: string[] = []

  let remainingChars = MAX_PDF_TEXT_CHARS
  let truncated = totalPages > pageLimit

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const { text, used, completed } = await readPageWithinBudget(page, remainingChars, deadline)

    remainingChars -= used
    pageTexts.push(text)
    page.cleanup()

    if (!completed) {
      truncated = true
      break
    }
  }

  return { text: pageTexts.join('\n').replace(/\s+/g, ' '), totalPages, truncated }
}

export class PdfParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      logger.info('Starting to parse file:', filePath)

      if (!filePath) {
        throw new Error('No file path provided')
      }

      logger.info('Reading file...')
      const dataBuffer = await readFile(filePath)
      logger.info('File read successfully, size:', dataBuffer.length)

      return this.parseBuffer(dataBuffer)
    } catch (error) {
      logger.error('Error reading file:', error)
      throw error
    }
  }

  async parseBuffer(dataBuffer: Buffer): Promise<FileParseResult> {
    try {
      logger.info('Starting to parse buffer, size:', dataBuffer.length)

      const { getDocumentProxy } = await import('unpdf')

      const uint8Array = new Uint8Array(dataBuffer)

      const pdf = await getDocumentProxy(uint8Array)

      try {
        const { text, totalPages, truncated } = await extractTextWithinBudget(pdf)

        logger.info('PDF parsed successfully, pages:', totalPages, 'text length:', text.length)

        if (truncated) {
          logger.warn(PDF_TRUNCATION_WARNING, { totalPages, textLength: text.length })
        }

        return {
          content: sanitizeTextForUTF8(text),
          metadata: {
            pageCount: totalPages,
            source: 'unpdf',
            truncated,
            warning: truncated ? PDF_TRUNCATION_WARNING : undefined,
          },
        }
      } finally {
        // Releases the document-level page, font, and image caches, which the
        // per-page cleanup() does not touch.
        await pdf.destroy().catch(() => {})
      }
    } catch (error) {
      logger.error('Error parsing buffer:', error)
      throw error
    }
  }
}
