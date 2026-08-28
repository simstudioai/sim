/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveFileInputToUrl: vi.fn(),
  submitReductoParse: vi.fn(),
  validateProvenance: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  resolveFileInputToUrl: mocks.resolveFileInputToUrl,
}))
vi.mock('@/lib/internal/reducto/client', () => ({
  submitReductoParse: mocks.submitReductoParse,
}))
vi.mock('@/lib/execution/model-input-provenance', () => ({
  validateOpaqueModelInputProvenance: mocks.validateProvenance,
}))

import { executeReductoParse } from '@/lib/internal/reducto/operations'

describe('executeReductoParse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateProvenance.mockReturnValue({ success: true })
    mocks.resolveFileInputToUrl.mockResolvedValue({ fileUrl: 'https://example.com/file.pdf' })
    mocks.submitReductoParse.mockResolvedValue({ job_id: 'job-1' })
  })

  it('submits one bounded page range and forwards cancellation', async () => {
    const controller = new AbortController()
    await expect(
      executeReductoParse(
        { apiKey: 'key', filePath: 'https://example.com/file.pdf', pages: [9, 2, 4] },
        {
          headers: new Headers(),
          requestId: 'request-1',
          signal: controller.signal,
          userId: 'user-1',
        }
      )
    ).resolves.toEqual({ success: true, output: { job_id: 'job-1' } })

    expect(mocks.submitReductoParse).toHaveBeenCalledWith(
      'key',
      {
        input: 'https://example.com/file.pdf',
        settings: { page_range: { start: 2, end: 9 } },
      },
      controller.signal
    )
  })
})
