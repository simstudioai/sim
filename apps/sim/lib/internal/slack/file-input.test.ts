import { createLogger } from '@sim/logger'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  download: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.download,
}))

import type { SlackOperationError } from '@/lib/internal/slack/errors'
import { forEachSlackAttachmentFile } from '@/lib/internal/slack/file-input'

const logger = createLogger('SlackFileInputTest')
const FILES = [
  { id: 'file-1', key: 'workspace/file-1', name: 'one.txt', size: 3, type: 'text/plain' },
  { id: 'file-2', key: 'execution/file-2', name: 'two.txt', size: 2, type: 'text/plain' },
]

describe('resolveSlackAttachmentFiles', () => {
  beforeEach(() => {
    mocks.assertAccess.mockResolvedValue(null)
    mocks.download
      .mockResolvedValueOnce({ buffer: Buffer.from('one'), contentType: 'text/plain' })
      .mockResolvedValueOnce({ buffer: Buffer.from('22'), contentType: 'text/plain' })
  })

  it('authorizes every supported storage reference and applies one aggregate byte budget', async () => {
    const controller = new AbortController()
    const contents: string[] = []
    await forEachSlackAttachmentFile(
      FILES,
      {
        logger,
        requestId: 'request-1',
        signal: controller.signal,
        userId: 'user-1',
      },
      async (file) => {
        contents.push(file.buffer.toString())
      }
    )

    expect(contents).toEqual(['one', '22'])
    expect(mocks.assertAccess).toHaveBeenNthCalledWith(
      1,
      'workspace/file-1',
      'user-1',
      'request-1',
      logger
    )
    expect(mocks.assertAccess).toHaveBeenNthCalledWith(
      2,
      'execution/file-2',
      'user-1',
      'request-1',
      logger
    )
    expect(mocks.download.mock.calls[0]?.[3]).toEqual({
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      signal: controller.signal,
    })
    expect(mocks.download.mock.calls[1]?.[3]).toEqual({
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES - 3,
      signal: controller.signal,
    })
  })

  it('conceals denied files as not found and never reads their bytes', async () => {
    mocks.assertAccess.mockResolvedValueOnce(new Response(null, { status: 404 }))

    await expect(
      forEachSlackAttachmentFile(
        FILES,
        {
          logger,
          requestId: 'request-1',
          userId: 'user-1',
        },
        async () => {}
      )
    ).rejects.toMatchObject<Partial<SlackOperationError>>({ status: 404 })
    expect(mocks.download).not.toHaveBeenCalled()
  })
})
