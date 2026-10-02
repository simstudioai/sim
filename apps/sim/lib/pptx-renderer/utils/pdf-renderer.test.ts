/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderPdfToImage, WORKER_SRC } from '@/lib/pptx-renderer/utils/pdf-renderer'

const PAGE_URL = 'https://example.com/preview'
const LIBRARY_URL = 'https://example.com/_next/static/media/pdf.min.mjs'
const WORKER_URL = 'https://example.com/_next/static/media/pdf.worker.min.mjs'

/**
 * Reproduce the root-relative asset strings a production bundler emits for the
 * two pdfjs assets, so the absolute-URL resolution is exercised rather than
 * assumed. Only `toString()` is stubbed; the module resolves the final value
 * through `href`.
 */
function stubBundlerAssetUrls() {
  vi.spyOn(URL.prototype, 'toString').mockImplementation(function (this: URL) {
    return `/_next/static/media/${this.pathname.split('/').pop()}`
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('renderPdfToImage', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { href: PAGE_URL } })
    stubBundlerAssetUrls()
  })

  it('skips rendering when isolated canvas rendering is unavailable', async () => {
    vi.stubGlobal('Worker', class {})
    vi.stubGlobal('OffscreenCanvas', undefined)

    expect(await renderPdfToImage(new Uint8Array([1]), 10, 10)).toBeNull()
  })

  it('skips rendering when workers are unavailable', async () => {
    vi.stubGlobal('OffscreenCanvas', class {})
    vi.stubGlobal('Worker', undefined)

    expect(await renderPdfToImage(new Uint8Array([1]), 10, 10)).toBeNull()
  })

  it('supplies absolute library and worker assets and preserves result/error behavior', async () => {
    vi.useFakeTimers()
    const postMessage = vi.fn()
    const worker = { postMessage, onmessage: null as ((event: MessageEvent) => void) | null }
    vi.stubGlobal('OffscreenCanvas', class {})
    vi.stubGlobal(
      'Worker',
      vi.fn(function Worker() {
        return worker
      })
    )
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rendered-pdf')
    const input = new Uint8Array([1, 2, 3])

    const result = renderPdfToImage(input, 20, 10)
    const [message, transfer] = postMessage.mock.calls[0]
    expect(message).toMatchObject({
      width: 20,
      height: 10,
      pdfjsUrl: LIBRARY_URL,
      pdfjsWorkerUrl: WORKER_URL,
    })
    expect(message.pdfData).toEqual(input)
    expect(message.pdfData).not.toBe(input)
    expect(transfer).toEqual([message.pdfData.buffer])
    worker.onmessage?.({ data: { id: message.id, blob: new Blob(['png']) } } as MessageEvent)
    expect(await result).toBe('blob:rendered-pdf')

    const failed = renderPdfToImage(input, 20, 10)
    worker.onmessage?.({
      data: { id: postMessage.mock.calls[1][0].id, error: 'Invalid PDF' },
    } as MessageEvent)
    expect(await failed).toBeNull()
  })
})

interface WorkerScope {
  onmessage: ((event: { data: Record<string, unknown> }) => Promise<void>) | null
  postMessage: (message: Record<string, unknown>) => void
}

interface WorkerHarness {
  imported: string[]
  posted: Array<Record<string, unknown>>
  globalWorkerOptions: Record<string, unknown>
  destroy: ReturnType<typeof vi.fn>
  send: (data: Record<string, unknown>) => Promise<void>
}

/**
 * Execute {@link WORKER_SRC} in-process against a stand-in pdfjs.
 *
 * Node refuses dynamic `import()` inside `new Function` ("A dynamic import
 * callback was not specified") and the `node:vm` hook needs
 * `--experimental-vm-modules`, so the two import sites are redirected to an
 * injected loader. The substitution count is asserted, so a source change that
 * drops either import fails here rather than silently testing nothing.
 */
function runWorkerSource(
  overrides: { pages?: number; getDocument?: () => { promise: Promise<unknown> } } = {}
): WorkerHarness {
  const imported: string[] = []
  const posted: Array<Record<string, unknown>> = []
  const globalWorkerOptions: Record<string, unknown> = {}
  const destroy = vi.fn()

  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 50 * scale }),
    render: () => ({ promise: Promise.resolve() }),
  }
  const doc = { numPages: overrides.pages ?? 1, getPage: async () => page, destroy }
  const library = {
    GlobalWorkerOptions: globalWorkerOptions,
    getDocument: overrides.getDocument ?? (() => ({ promise: Promise.resolve(doc) })),
  }

  const load = async (url: string) => {
    imported.push(url)
    return url.includes('pdf.worker') ? {} : library
  }

  class FakeOffscreenCanvas {
    constructor(
      public width: number,
      public height: number
    ) {}
    getContext() {
      return {}
    }
    async convertToBlob() {
      return new Blob(['png'])
    }
  }

  expect(WORKER_SRC.split('await import(').length - 1).toBe(2)
  const source = WORKER_SRC.replaceAll('await import(', 'await __load(')

  const scope: WorkerScope = {
    onmessage: null,
    postMessage: (message) => posted.push(message),
  }
  new Function('self', '__load', 'OffscreenCanvas', source)(scope, load, FakeOffscreenCanvas)

  return {
    imported,
    posted,
    globalWorkerOptions,
    destroy,
    send: async (data) => {
      await scope.onmessage?.({ data })
    },
  }
}

describe('WORKER_SRC', () => {
  it('imports the worker module before the library and renders a blob', async () => {
    const harness = runWorkerSource()

    await harness.send({
      id: 7,
      pdfData: new Uint8Array([1]),
      width: 20,
      height: 10,
      pdfjsUrl: LIBRARY_URL,
      pdfjsWorkerUrl: WORKER_URL,
    })

    expect(harness.imported).toEqual([WORKER_URL, LIBRARY_URL])
    expect(harness.posted).toHaveLength(1)
    expect(harness.posted[0].id).toBe(7)
    expect(harness.posted[0].blob).toBeInstanceOf(Blob)
    expect(harness.destroy).toHaveBeenCalledOnce()
  })

  /**
   * The original defect: pdfjs reads `workerSrc` through a getter that throws
   * when falsy, outside its own try/catch, so assigning it here broke every
   * render. The worker must leave pdfjs configuration untouched.
   */
  it('never writes to GlobalWorkerOptions', async () => {
    const harness = runWorkerSource()

    await harness.send({
      id: 1,
      pdfData: new Uint8Array([1]),
      width: 20,
      height: 10,
      pdfjsUrl: LIBRARY_URL,
      pdfjsWorkerUrl: WORKER_URL,
    })

    expect(harness.globalWorkerOptions).toEqual({})
    expect('workerSrc' in harness.globalWorkerOptions).toBe(false)
  })

  it('reports an error instead of a blob when the document has no pages', async () => {
    const harness = runWorkerSource({ pages: 0 })

    await harness.send({
      id: 2,
      pdfData: new Uint8Array([1]),
      width: 20,
      height: 10,
      pdfjsUrl: LIBRARY_URL,
      pdfjsWorkerUrl: WORKER_URL,
    })

    expect(harness.posted).toEqual([{ id: 2, error: 'no pages' }])
    expect(harness.destroy).toHaveBeenCalledOnce()
  })

  it('reports an error when pdfjs rejects', async () => {
    const harness = runWorkerSource({
      getDocument: () => ({ promise: Promise.reject(new Error('Invalid PDF')) }),
    })

    await harness.send({
      id: 3,
      pdfData: new Uint8Array([1]),
      width: 20,
      height: 10,
      pdfjsUrl: LIBRARY_URL,
      pdfjsWorkerUrl: WORKER_URL,
    })

    expect(harness.posted).toHaveLength(1)
    expect(harness.posted[0].id).toBe(3)
    expect(harness.posted[0].error).toContain('Invalid PDF')
  })
})
