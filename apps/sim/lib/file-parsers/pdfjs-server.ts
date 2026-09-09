import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/types/src/pdf'

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

  return waitForLoadingTask(loadingTask, signal)
}
