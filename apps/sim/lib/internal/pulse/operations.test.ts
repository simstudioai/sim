/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveFileInputToUrl: vi.fn(),
  submitPulseParse: vi.fn(),
  validateProvenance: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  resolveFileInputToUrl: mocks.resolveFileInputToUrl,
}))
vi.mock('@/lib/internal/pulse/client', () => ({ submitPulseParse: mocks.submitPulseParse }))
vi.mock('@/lib/execution/model-input-provenance', () => ({
  validateOpaqueModelInputProvenance: mocks.validateProvenance,
}))

import { executePulseParse } from '@/lib/internal/pulse/operations'

describe('executePulseParse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateProvenance.mockReturnValue({ success: true })
    mocks.resolveFileInputToUrl.mockResolvedValue({ fileUrl: 'https://example.com/file.pdf' })
    mocks.submitPulseParse.mockResolvedValue({ job_id: 'job-1' })
  })

  it('preserves multipart parser options and forwards cancellation', async () => {
    const controller = new AbortController()
    await executePulseParse(
      {
        apiKey: 'key',
        filePath: 'https://example.com/file.pdf',
        pages: '1-2,5',
        extractFigure: true,
        chunking: 'semantic',
        chunkSize: 2000,
      },
      {
        headers: new Headers(),
        requestId: 'request-1',
        signal: controller.signal,
        userId: 'user-1',
      }
    )

    const [, formData, signal] = mocks.submitPulseParse.mock.calls[0] as [
      string,
      FormData,
      AbortSignal,
    ]
    expect(Object.fromEntries(formData.entries())).toEqual({
      file_url: 'https://example.com/file.pdf',
      pages: '1-2,5',
      extract_figure: 'true',
      chunking: 'semantic',
      chunk_size: '2000',
    })
    expect(signal).toBe(controller.signal)
  })
})
