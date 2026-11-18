import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveFileInputToUrl, mockSubmitReductoParse } = vi.hoisted(() => ({
  mockResolveFileInputToUrl: vi.fn(),
  mockSubmitReductoParse: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file.server', () => ({
  resolveFileInputToUrl: mockResolveFileInputToUrl,
}))
vi.mock('@/lib/internal/reducto/client', () => ({
  submitReductoParse: mockSubmitReductoParse,
}))

import { executeReductoParse } from '@/lib/internal/reducto/operations'

const context = { headers: new Headers(), requestId: 'req-1', userId: 'user-1' }

describe('executeReductoParse', () => {
  beforeEach(() => {
    mockResolveFileInputToUrl.mockResolvedValue({ fileUrl: 'https://files.example.com/doc.pdf' })
    mockSubmitReductoParse.mockResolvedValue({ job_id: 'job-1' })
  })

  it('parses only the requested pages, not every page between them', async () => {
    await executeReductoParse(
      { apiKey: 'key', filePath: 'https://files.example.com/doc.pdf', pages: [2, 9] },
      context
    )

    expect(mockSubmitReductoParse).toHaveBeenCalledWith(
      'key',
      expect.objectContaining({ settings: { page_range: [2, 9] } }),
      undefined
    )
  })
})
