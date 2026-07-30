/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownloadFile } = vi.hoisted(() => ({
  mockDownloadFile: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
  hasCloudStorage: vi.fn(() => true),
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: vi.fn(),
}))

import { createLogger } from '@sim/logger'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'

describe('downloadFileFromStorage context derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDownloadFile.mockResolvedValue(Buffer.from('bytes'))
  })

  it('downloads with the key-derived context, ignoring a caller-supplied public context', async () => {
    const userFile: UserFile = {
      id: 'f1',
      name: 'report.pdf',
      url: '',
      size: 5,
      type: 'application/pdf',
      key: 'workspace/ws-1/1700000000000-abc1234-report.pdf',
      context: 'og-images',
    }

    await downloadFileFromStorage(userFile, 'req-1', createLogger('test'))

    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: userFile.key, context: 'workspace' })
    )
  })
})
