import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/pdf'
import { FileParserError } from '@/lib/file-parsers/errors'
import { openPdfDocument } from '@/lib/file-parsers/pdfjs-server'
import type { FileParseOptions, FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { sanitizeTextForUTF8, truncationNotice } from '@/lib/file-parsers/utils'

const logger = createLogger('PdfParser')

/**
 * Ceiling on the page loop. The character budget and the deadline already stop
 * extraction on their own, so this exists purely so the loop bound never comes
 * straight from the attacker-controlled `numPages` field.
 */
const MAX_PDF_PAGES = 10_000

/** Ceiling on extracted characters — roughly 3,000 pages of dense text. */
export const MAX_PDF_TEXT_CHARS = 10_000_000

/** Complete extraction shares the ingestion pipeline's bounded text-output envelope. */
export const MAX_COMPLETE_PDF_TEXT_BYTES = 20 * 1024 * 1024

/** Bounds expansion on one page independently of a long document's output budget. */
export const MAX_COMPLETE_PDF_PAGE_CHARS = 250_000

/** Wall-clock ceiling for extracting text from a whole document. */
const PDF_EXTRACTION_TIMEOUT_MS = 60_000

const PDF_TRUNCATION_WARNING = 'PDF text extraction stopped at a parser limit and is incomplete'
const PDF_READ_DEADLINE_REACHED = Symbol('PDF_READ_DEADLINE_REACHED')

/** Stable metadata identifier retained for documents indexed before the parser swap. */
const PDF_PARSER_SOURCE = 'unpdf'

interface TextContentChunk {
  items?: Array<{ str?: unknown; hasEOL?: unknown }>
}

interface PageExtraction {
  text: string
  /** Characters consumed from the caller's budget. */
  used: number
  /** False when a budget stopped the read before the page was exhausted. */
  completed: boolean
  deadlineReached: boolean
}

interface BoundedExtraction {
  text: string
  /** Page count the document declares, however many pages were actually read. */
  totalPages: number
  /** Pages actually visited before a budget stopped extraction. */
  pagesRead: number
  /** True when a budget stopped extraction before the document was exhausted. */
  truncated: boolean
}

function waitForAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void
): Promise<T> {
  if (!signal) return operation

  try {
    signal.throwIfAborted()
  } catch (error) {
    onAbort?.()
    return Promise.reject(error)
  }

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', handleAbort)
    const handleAbort = () => {
      cleanup()
      onAbort?.()
      reject(signal.reason)
    }

    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    operation.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      }
    )
  })
}

function waitForDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  signal: AbortSignal | undefined,
  onDeadline: () => void,
  onAbort: () => void
): Promise<T | typeof PDF_READ_DEADLINE_REACHED> {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) {
    onDeadline()
    return Promise.resolve(PDF_READ_DEADLINE_REACHED)
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const deadlineReached = new Promise<typeof PDF_READ_DEADLINE_REACHED>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve(PDF_READ_DEADLINE_REACHED)
      onDeadline()
    }, remainingMs)
  })

  return waitForAbort(Promise.race([operation, deadlineReached]), signal, onAbort).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  })
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
  page: PDFPageProxy,
  budget: number,
  deadline: number,
  signal?: AbortSignal
): Promise<PageExtraction> {
  signal?.throwIfAborted()
  const reader = page
    .streamTextContent()
    .getReader() as ReadableStreamDefaultReader<TextContentChunk>

  const parts: string[] = []
  let remaining = budget
  let completed = false
  let dropped = false
  let deadlineReached = false
  let cancellation: Promise<void> | undefined

  const cancelReader = (reason: unknown): Promise<void> => {
    cancellation ??= reader.cancel(reason).catch(() => {})
    return cancellation
  }

  try {
    /**
     * Loops until content is actually dropped rather than until the budget hits
     * zero: text that ends exactly on the budget is complete, not truncated.
     */
    while (!dropped) {
      const result = await waitForDeadline(
        reader.read(),
        deadline,
        signal,
        () => void cancelReader(new Error('PDF text extraction deadline exceeded')),
        () => void cancelReader(signal?.reason)
      )
      if (result === PDF_READ_DEADLINE_REACHED) {
        deadlineReached = true
        break
      }

      const { value, done } = result
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

        if (piece.length > 0) parts.push(piece)
        remaining -= piece.length
      }
    }
  } finally {
    if (!completed) {
      const pendingCancellation = cancelReader(new Error('PDF text extraction budget exceeded'))
      if (!signal?.aborted && !deadlineReached) {
        await waitForAbort(pendingCancellation, signal)
      }
    }
  }

  return { text: parts.join(''), used: budget - remaining, completed, deadlineReached }
}

function completeExtractionLimit(message: string): FileParserError {
  return new FileParserError('complexity_limit', `${message} Split or simplify the PDF and retry.`)
}

async function extractTextWithinBudget(
  pdf: PDFDocumentProxy,
  options: FileParseOptions,
  deadline: number
): Promise<BoundedExtraction> {
  const { signal } = options
  const complete = options.pdfTextMode === 'complete'
  const totalPages = pdf.numPages
  const pageLimit = Math.min(totalPages, MAX_PDF_PAGES)
  const pageTexts: string[] = []

  let remainingChars = MAX_PDF_TEXT_CHARS
  let outputBytes = 0
  let pagesRead = 0
  let truncated = totalPages > pageLimit

  if (complete && truncated) {
    throw completeExtractionLimit(
      `PDF exceeds the safe limit of ${MAX_PDF_PAGES.toLocaleString()} pages.`
    )
  }

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
    signal?.throwIfAborted()
    const pagePromise = pdf.getPage(pageNumber)
    const cleanupLatePage = () => {
      void pagePromise.then((latePage) => latePage.cleanup()).catch(() => {})
    }
    const pageResult = await waitForDeadline(
      pagePromise,
      deadline,
      signal,
      cleanupLatePage,
      cleanupLatePage
    )
    if (pageResult === PDF_READ_DEADLINE_REACHED) {
      if (complete) throw completeExtractionLimit('PDF text extraction exceeded its time limit.')
      truncated = true
      break
    }

    const page = pageResult
    let extraction: PageExtraction
    try {
      extraction = await readPageWithinBudget(
        page,
        complete ? MAX_COMPLETE_PDF_PAGE_CHARS : remainingChars,
        deadline,
        signal
      )
    } finally {
      page.cleanup()
    }

    const { text, used, completed } = extraction

    if (!complete) remainingChars -= used

    /** A page stopped before yielding text must not count as read or add a separator. */
    if (completed || text.length > 0) {
      pagesRead++
      if (complete) {
        const normalized = sanitizeTextForUTF8(text.replace(/\s+/g, ' ')).trim()
        if (normalized.length > 0) {
          outputBytes += Buffer.byteLength(normalized, 'utf8') + (pageTexts.length > 0 ? 1 : 0)
          if (outputBytes > MAX_COMPLETE_PDF_TEXT_BYTES) {
            throw completeExtractionLimit(
              `PDF text exceeds the safe ${MAX_COMPLETE_PDF_TEXT_BYTES.toLocaleString()}-byte output limit.`
            )
          }
          pageTexts.push(normalized)
        }
      } else {
        pageTexts.push(text)
      }
    }

    if (!completed) {
      if (complete) {
        throw completeExtractionLimit(
          extraction.deadlineReached
            ? 'PDF text extraction exceeded its time limit.'
            : `PDF page ${pageNumber} exceeds the safe expansion limit of ${MAX_COMPLETE_PDF_PAGE_CHARS.toLocaleString()} characters per page.`
        )
      }
      truncated = true
      break
    }
  }

  return {
    text: complete ? pageTexts.join(' ') : pageTexts.join('\n').replace(/\s+/g, ' '),
    totalPages,
    pagesRead,
    truncated,
  }
}

export class PdfParser implements FileParser {
  async parseFile(filePath: string, options: FileParseOptions = {}): Promise<FileParseResult> {
    try {
      logger.info('Starting to parse file:', filePath)

      if (!filePath) {
        throw new Error('No file path provided')
      }

      logger.info('Reading file...')
      const dataBuffer = await readFile(filePath, { signal: options.signal })
      logger.info('File read successfully, size:', dataBuffer.length)

      return this.parseBuffer(dataBuffer, options)
    } catch (error) {
      logger.error('Error reading file:', error)
      throw error
    }
  }

  async parseBuffer(dataBuffer: Buffer, options: FileParseOptions = {}): Promise<FileParseResult> {
    const deadline = Date.now() + PDF_EXTRACTION_TIMEOUT_MS
    const complete = options.pdfTextMode === 'complete'
    const deadlineController = new AbortController()
    const timeoutId = complete
      ? setTimeout(
          () =>
            deadlineController.abort(
              completeExtractionLimit('PDF text extraction exceeded its time limit.')
            ),
          PDF_EXTRACTION_TIMEOUT_MS
        )
      : undefined
    const signal = complete
      ? options.signal
        ? AbortSignal.any([options.signal, deadlineController.signal])
        : deadlineController.signal
      : options.signal
    try {
      signal?.throwIfAborted()
      logger.info('Starting to parse buffer, size:', dataBuffer.length)

      const uint8Array = new Uint8Array(dataBuffer)
      const opening = openPdfDocument(uint8Array, signal)
      const pdf = complete ? await waitForAbort(opening, signal) : await opening

      try {
        const { text, totalPages, pagesRead, truncated } = await extractTextWithinBudget(
          pdf,
          { ...options, signal },
          complete ? deadline : Date.now() + PDF_EXTRACTION_TIMEOUT_MS
        )

        logger.info('PDF parsed successfully, pages:', totalPages, 'text length:', text.length)

        if (truncated) {
          logger.warn(PDF_TRUNCATION_WARNING, { totalPages, pagesRead, textLength: text.length })
        }

        const body = complete ? text : sanitizeTextForUTF8(text)

        /** The inline notice keeps truncated previews visible to content-only callers. */
        const notice =
          truncated && body.trim().length > 0
            ? truncationNotice(
                `PDF text truncated at parser limits, showing first ${pagesRead} of ${totalPages} pages`
              )
            : ''

        return {
          content: body + notice,
          metadata: {
            pageCount: totalPages,
            source: PDF_PARSER_SOURCE,
            truncated,
            warning: truncated ? PDF_TRUNCATION_WARNING : undefined,
          },
        }
      } finally {
        /** Releases document-level page, font, and image caches. */
        const destruction = pdf.destroy().catch(() => {})
        if (complete) await waitForAbort(destruction, signal)
        else await destruction
      }
    } catch (error) {
      logger.error('Error parsing buffer:', error)
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
