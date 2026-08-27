/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveFileInputToUrl: vi.fn(),
  submitExtendParse: vi.fn(),
  validateProvenance: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  resolveFileInputToUrl: mocks.resolveFileInputToUrl,
}))
vi.mock('@/lib/internal/extend/client', () => ({ submitExtendParse: mocks.submitExtendParse }))
vi.mock('@/lib/execution/model-input-provenance', () => ({
  validateOpaqueModelInputProvenance: mocks.validateProvenance,
}))

import { executeExtendParse } from '@/lib/internal/extend/operations'

describe('executeExtendParse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateProvenance.mockReturnValue({ success: true })
    mocks.resolveFileInputToUrl.mockResolvedValue({ fileUrl: 'https://example.com/file.pdf' })
    mocks.submitExtendParse.mockResolvedValue({ id: 'parse-1', page_count: 3 })
  })

  it('preserves provider configuration and response projection', async () => {
    const controller = new AbortController()
    await expect(
      executeExtendParse(
        {
          apiKey: 'key',
          filePath: 'https://example.com/file.pdf',
          outputFormat: 'markdown',
          chunking: 'section',
          engine: 'parse_light',
        },
        {
          headers: new Headers(),
          requestId: 'request-1',
          signal: controller.signal,
          userId: 'user-1',
        }
      )
    ).resolves.toEqual({
      success: true,
      output: {
        id: 'parse-1',
        status: 'PROCESSED',
        chunks: [],
        blocks: [],
        pageCount: 3,
        creditsUsed: null,
      },
    })

    expect(mocks.submitExtendParse).toHaveBeenCalledWith(
      'key',
      {
        file: { fileUrl: 'https://example.com/file.pdf' },
        config: {
          target: 'markdown',
          chunkingStrategy: { type: 'section' },
          engine: 'parse_light',
        },
      },
      controller.signal
    )
  })
})
