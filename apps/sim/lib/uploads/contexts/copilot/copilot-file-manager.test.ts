/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUploadFile } = vi.hoisted(() => ({ mockUploadFile: vi.fn() }))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  uploadFile: mockUploadFile,
  downloadFile: vi.fn(),
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.example' }))

import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot/copilot-file-manager'
import type { UploadFileOptions } from '@/lib/uploads/shared/types'

describe('Copilot output key allocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUploadFile.mockImplementation(async (options: UploadFileOptions) => ({
      key: options.customKey,
      path: `/api/files/serve/${encodeURIComponent(options.customKey!)}`,
      name: options.customKey,
      type: options.contentType,
      size: options.file.length,
    }))
  })

  it('gives concurrent same-named files unique owned keys and preserves their display names', async () => {
    const upload = (userId: string) =>
      uploadCopilotFile({
        buffer: Buffer.from(userId),
        fileName: 'report.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        userId,
      })
    const [first, second] = await Promise.all([upload('user-1'), upload('user-2')])

    expect(first.key).not.toBe(second.key)
    expect(first.key).toMatch(/^copilot\/[0-9a-f-]+\/report\.xlsx$/)
    for (const stored of [first, second]) {
      expect(stored.name).toBe('report.xlsx')
      expect(stored.context).toBe('copilot')
      expect(stored.url).toBe(
        `https://sim.example/api/files/serve/${encodeURIComponent(stored.key)}`
      )
    }
    for (const [options] of mockUploadFile.mock.calls) {
      expect(options.preserveKey).toBe(true)
      expect(options.cleanupOnMetadataFailure).toBe(true)
      expect(options.fileName).toBe('report.xlsx')
      expect(options.metadata.originalName).toBe('report.xlsx')
      expect(options.context).toBe('copilot')
    }
    expect(mockUploadFile.mock.calls[0][0].metadata.userId).toBe('user-1')
    expect(mockUploadFile.mock.calls[1][0].metadata.userId).toBe('user-2')
  })
})
