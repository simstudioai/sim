/**
 * @vitest-environment node
 */
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/pdf'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetDocument, workerMessageHandler, canvasPrimitives } = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  workerMessageHandler: {},
  canvasPrimitives: {
    DOMMatrix: class DOMMatrix {},
    ImageData: class ImageData {},
    Path2D: class Path2D {},
  },
}))

vi.mock('@napi-rs/canvas', () => canvasPrimitives)
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => {
  for (const name of Object.keys(canvasPrimitives)) {
    if (typeof Reflect.get(globalThis, name) !== 'function') {
      throw new Error(`${name} must be installed before PDF.js evaluates`)
    }
  }
  return { getDocument: mockGetDocument }
})
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs', () => ({
  WorkerMessageHandler: workerMessageHandler,
}))

import { openPdfDocument } from '@/lib/file-parsers/pdfjs-server'

describe('openPdfDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes native primitives before concurrent cold opens and retains existing globals', async () => {
    class ExistingPath2D {}
    vi.stubGlobal('Path2D', ExistingPath2D)
    const pdf = { destroy: vi.fn().mockResolvedValue(undefined) }
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(pdf) })

    await Promise.all([openPdfDocument(new Uint8Array([1])), openPdfDocument(new Uint8Array([2]))])

    expect(globalThis.DOMMatrix).toBe(canvasPrimitives.DOMMatrix)
    expect(globalThis.ImageData).toBe(canvasPrimitives.ImageData)
    expect(globalThis.Path2D).toBe(ExistingPath2D)
    expect(mockGetDocument).toHaveBeenCalledTimes(2)
    expect(mockGetDocument).toHaveBeenCalledWith({
      data: new Uint8Array([1]),
      isEvalSupported: false,
      useSystemFonts: true,
    })
  })

  it('destroys a pending loading task immediately when parsing is cancelled', async () => {
    let resolveLoading: ((pdf: { destroy: () => Promise<void> }) => void) | undefined
    const lateDocumentDestroy = vi.fn().mockResolvedValue(undefined)
    const destroy = vi.fn().mockResolvedValue(undefined)
    const loadingTask = {
      destroy,
      promise: new Promise((resolve) => {
        resolveLoading = resolve
      }),
    } as PDFDocumentLoadingTask
    mockGetDocument.mockReturnValueOnce(loadingTask)
    const controller = new AbortController()

    const opening = openPdfDocument(new Uint8Array([1, 2, 3]), controller.signal)
    await vi.waitFor(() => expect(mockGetDocument).toHaveBeenCalledOnce())
    controller.abort()

    await expect(opening).rejects.toMatchObject({ name: 'AbortError' })
    expect(destroy).toHaveBeenCalledOnce()

    resolveLoading?.({ destroy: lateDocumentDestroy })
    await vi.waitFor(() => expect(lateDocumentDestroy).toHaveBeenCalledOnce())
  })
})
