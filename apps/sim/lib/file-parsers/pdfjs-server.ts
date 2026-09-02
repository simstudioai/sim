import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/types/src/pdf'

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
  const [{ getDocument }, { WorkerMessageHandler }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ])
  signal?.throwIfAborted()

  Object.assign(globalThis, {
    pdfjsWorker: { WorkerMessageHandler },
  })

  const loadingTask = getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  })

  return waitForLoadingTask(loadingTask, signal)
}
