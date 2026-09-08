import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/pdf'
import { openPdfDocument } from '@/lib/file-parsers/pdfjs-server'

const PDF_COUNT_TIMEOUT_MS = 15_000

/** Counts PDF pages without extracting text or trusting client-supplied file metadata. */
export async function countMistralPdfPages(
  buffer: Buffer,
  signal?: AbortSignal
): Promise<number | undefined> {
  signal?.throwIfAborted()
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) return undefined

  const controller = new AbortController()
  const countSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const timeout = setTimeout(
    () => controller.abort(new DOMException('PDF page count timed out', 'TimeoutError')),
    PDF_COUNT_TIMEOUT_MS
  )
  let removeAbortListener = () => {}
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(countSignal.reason)
    countSignal.addEventListener('abort', onAbort, { once: true })
    removeAbortListener = () => countSignal.removeEventListener('abort', onAbort)
  })
  const opening = openPdfDocument(new Uint8Array(buffer), countSignal)
  let openedPdf: PDFDocumentProxy | undefined
  /** Late opening and stalled cleanup cannot retain the caller or prevent cancellation. */
  void opening
    .then((pdf) => {
      if (countSignal.aborted) return pdf.destroy().catch(() => {})
    })
    .catch(() => {})
  try {
    const pdf = await Promise.race([opening, aborted])
    openedPdf = pdf
    countSignal.throwIfAborted()
    return Number.isSafeInteger(pdf.numPages) && pdf.numPages > 0 ? pdf.numPages : undefined
  } catch {
    signal?.throwIfAborted()
    return undefined
  } finally {
    clearTimeout(timeout)
    removeAbortListener()
    void openedPdf?.destroy().catch(() => {})
  }
}
