import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/types/src/pdf'
import { FileParserError } from '@/lib/file-parsers/errors'

let pdfRuntime: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | undefined

/**
 * PDF.js constructs DOMMatrix during module evaluation, including text-only use.
 * Its optional runtime require is invisible to standalone tracing, so load the
 * real native primitives explicitly before importing either PDF.js module.
 */
function loadPdfRuntime() {
  pdfRuntime ??= (async () => {
    const { DOMMatrix, ImageData, Path2D } = await import('@napi-rs/canvas')
    for (const [name, value] of Object.entries({ DOMMatrix, ImageData, Path2D })) {
      if (!Reflect.get(globalThis, name)) {
        Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
      }
    }

    const [pdf] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ])
    return pdf
  })()
  return pdfRuntime
}

function waitForLoadingTask(
  loadingTask: PDFDocumentLoadingTask,
  signal?: AbortSignal
): Promise<PDFDocumentProxy> {
  if (!signal) return loadingTask.promise

  const destroy = () => {
    try {
      void loadingTask.destroy().catch(() => {})
    } catch {}
  }

  if (signal.aborted) {
    destroy()
    signal.throwIfAborted()
  }

  let aborted = false
  return new Promise<PDFDocumentProxy>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', handleAbort)
    const handleAbort = () => {
      aborted = true
      cleanup()
      destroy()
      reject(signal.reason)
    }

    signal.addEventListener('abort', handleAbort, { once: true })
    loadingTask.promise.then(
      (pdf) => {
        cleanup()
        if (aborted) {
          void pdf.destroy().catch(() => {})
          return
        }
        resolve(pdf)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      }
    )
  })
}

/** pdf.js exception classes that mean the bytes are not a readable PDF. */
const INVALID_PDF_ERROR_NAMES = new Set(['InvalidPDFException', 'FormatError'])

/**
 * pdf.js reports failures as its own exception classes whose `name` survives
 * the worker boundary. Untyped, they classify as transient and are retried
 * forever; this is the single choke point every pdf.js caller shares, so the
 * mapping to the parser code taxonomy lives here.
 */
function toTypedPdfError(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  if (error.name === 'PasswordException') {
    return new FileParserError('encrypted_file', 'This PDF is password-protected', error)
  }
  if (INVALID_PDF_ERROR_NAMES.has(error.name)) {
    return new FileParserError('invalid_format', `Invalid PDF: ${error.message}`, error)
  }
  return error
}

/** Open a PDF with the server-compatible pdf.js build and hardened defaults. */
export async function openPdfDocument(
  data: Uint8Array,
  signal?: AbortSignal
): Promise<PDFDocumentProxy> {
  signal?.throwIfAborted()
  const { getDocument } = await loadPdfRuntime()
  signal?.throwIfAborted()

  const loadingTask = getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  })

  try {
    return await waitForLoadingTask(loadingTask, signal)
  } catch (error) {
    throw toTypedPdfError(error)
  }
}
