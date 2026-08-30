/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { DocCompileUserError } from '@/lib/mothership/tools/server/files/doc-compile-error'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))

import { uploadDaytonaFile } from '@/lib/internal/daytona/operations'

const input = {
  apiKey: 'daytona-key',
  sandboxId: 'sandbox-1',
  destinationPath: '/tmp/',
  file: { key: 'workspace/file.txt', name: 'file.txt', size: 4 },
}

describe('uploadDaytonaFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertToolFileAccess.mockResolvedValue(null)
  })

  it.each([
    new PayloadSizeLimitError({
      label: 'Daytona upload',
      maxBytes: 100,
      observedBytes: 101,
    }),
    new DocCompileUserError('still compiling', { pending: true }),
  ])('preserves typed file errors from storage materialization', async (error) => {
    const controller = new AbortController()
    mocks.downloadServableFileFromStorage.mockRejectedValueOnce(error)

    await expect(
      uploadDaytonaFile(input, {
        userId: 'user-1',
        requestId: 'request-1',
        signal: controller.signal,
      })
    ).rejects.toBe(error)

    expect(mocks.downloadServableFileFromStorage).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'workspace/file.txt' }),
      'request-1',
      expect.anything(),
      expect.objectContaining({ maxBytes: 100 * 1024 * 1024, signal: controller.signal })
    )
  })
})
