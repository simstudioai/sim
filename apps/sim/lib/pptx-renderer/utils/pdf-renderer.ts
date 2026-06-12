/**
 * PDF-to-image renderer for embedded EMF PDFs.
 *
 * pdfjs-dist v5 has process-level shared state (PagesMapper.#pagesNumber,
 * GlobalWorkerOptions.workerSrc, PDFWorker.#isWorkerDisabled) that a library
 * must never touch on the main thread — doing so clobbers the host app's pdfjs
 * configuration.
 *
 * Solution: render EMF PDFs exclusively inside a dedicated Web Worker. The
 * worker loads its OWN pdfjs instance via dynamic import, so all static state
 * is fully isolated from the main thread.
 *
 * If Worker + OffscreenCanvas are unavailable (extremely rare in 2025+
 * browsers), rendering is skipped and the caller gets null — no main-thread
 * fallback, no global state pollution.
 */

// ---------------------------------------------------------------------------
// Resolved pdfjs URL — computed once from main thread's module resolution
// ---------------------------------------------------------------------------

let _pdfjsUrl: string | null = null

function getPdfjsUrl(): string | null {
  if (_pdfjsUrl !== null) return _pdfjsUrl
  try {
    // Resolve via the bundler/dev server so the URL is usable from a Worker
    _pdfjsUrl = new URL('pdfjs-dist/build/pdf.min.mjs', import.meta.url).toString()
  } catch {
    _pdfjsUrl = ''
  }
  return _pdfjsUrl || null
}

// ---------------------------------------------------------------------------
// Worker-based renderer (fully isolated from main thread pdfjs)
// ---------------------------------------------------------------------------

/**
 * Inline source for the PDF render worker.
 * Receives: { id, pdfData, width, height, pdfjsUrl }
 * Posts back: { id, blob } or { id, error }
 *
 * The worker loads its OWN pdfjs instance via dynamic import, so its static
 * PagesMapper state is completely independent of the main thread.
 * pdfjs's own internal worker is disabled (workerPort = null, workerSrc = '')
 * so pdfjs runs single-threaded inside this worker — acceptable for tiny
 * 1-page EMF PDFs.
 */
const WORKER_SRC = /* js */ `
let pdfjsLib = null;

self.onmessage = async (e) => {
  const { id, pdfData, width, height, pdfjsUrl } = e.data;
  try {
    if (!pdfjsLib) {
      pdfjsLib = await import(pdfjsUrl);
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    }

    const doc = await pdfjsLib.getDocument({ data: pdfData }).promise;
    try {
      if (doc.numPages < 1) {
        self.postMessage({ id, error: 'no pages' });
        return;
      }
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const scale = Math.max(width / vp.width, height / vp.height);
      const svp = page.getViewport({ scale });

      const canvas = new OffscreenCanvas(Math.ceil(svp.width), Math.ceil(svp.height));
      const ctx = canvas.getContext('2d', { alpha: true });
      await page.render({ canvasContext: ctx, viewport: svp, background: 'rgba(0,0,0,0)' }).promise;

      const blob = await canvas.convertToBlob({ type: 'image/png' });
      self.postMessage({ id, blob });
    } finally {
      doc.destroy();
    }
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
`

let _worker: Worker | null = null
let _workerFailed = false
let _msgId = 0
const _pending = new Map<
  number,
  { resolve: (b: Blob | null) => void; reject: (e: Error) => void }
>()

function getWorker(_pdfjsUrl: string): Worker | null {
  if (_workerFailed) return null
  if (_worker) return _worker

  try {
    const blob = new Blob([WORKER_SRC], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)
    _worker = new Worker(url, { type: 'module' })

    _worker.onmessage = (e: MessageEvent) => {
      const { id, blob, error } = e.data
      const entry = _pending.get(id)
      if (!entry) return
      _pending.delete(id)
      if (error) {
        entry.resolve(null) // Treat worker-side errors as "no result"
      } else {
        entry.resolve(blob ?? null)
      }
    }

    _worker.onerror = () => {
      // Worker failed to initialize (e.g. module import blocked by CSP)
      _workerFailed = true
      _worker = null
      for (const [, entry] of _pending) {
        entry.resolve(null)
      }
      _pending.clear()
    }

    return _worker
  } catch {
    _workerFailed = true
    return null
  }
}

function renderInWorker(
  pdfData: Uint8Array,
  width: number,
  height: number,
  pdfjsUrl: string
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const worker = getWorker(pdfjsUrl)
    if (!worker) {
      resolve(null)
      return
    }

    const id = ++_msgId
    _pending.set(id, {
      resolve,
      reject: () => resolve(null),
    })

    // Transfer the buffer to avoid copying
    const copy = pdfData.slice() // copy so caller retains original
    worker.postMessage({ id, pdfData: copy, width, height, pdfjsUrl }, [copy.buffer])

    // Timeout: if worker doesn't respond in 15s, give up
    setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id)
        resolve(null)
      }
    }, 15000)
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render page 1 of a PDF to a blob URL image.
 *
 * Uses a dedicated Web Worker with its own pdfjs instance, fully isolated
 * from the main thread. Never touches GlobalWorkerOptions or any other
 * pdfjs global state on the main thread.
 *
 * @returns blob URL string, or null if rendering fails or Worker is unavailable
 */
export async function renderPdfToImage(
  pdfData: Uint8Array,
  width: number,
  height: number
): Promise<string | null> {
  const pdfjsUrl = getPdfjsUrl()

  if (!pdfjsUrl || typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') {
    return null
  }

  try {
    const blob = await renderInWorker(pdfData, width, height, pdfjsUrl)
    if (blob) return URL.createObjectURL(blob)
  } catch {
    // Worker failed — no fallback, return null
  }

  return null
}
