/**
 * @vitest-environment node
 */
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/pdf'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetDocument, workerMessageHandler } = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  workerMessageHandler: {},
}))

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: mockGetDocument }))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs', () => ({
  WorkerMessageHandler: workerMessageHandler,
}))

import { openPdfDocument } from '@/lib/file-parsers/pdfjs-server'

describe('openPdfDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
