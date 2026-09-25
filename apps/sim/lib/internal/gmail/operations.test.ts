import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileMocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFilesWithinBudget: vi.fn(),
  processFilesToUserFiles: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: fileMocks.assertToolFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: fileMocks.processFilesToUserFiles,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFilesWithinBudget: fileMocks.downloadServableFilesWithinBudget,
}))

import { GmailOperationError } from '@/lib/internal/gmail/errors'
import { executeGmailSend } from '@/lib/internal/gmail/mail'

const MAIL = {
  accessToken: 'access-token',
  to: 'recipient@example.com',
  body: 'Hello',
}
const STORED_FILE = {
  id: 'file-1',
  key: 'workspace/file.txt',
  name: 'file.txt',
  size: 4,
  type: 'text/plain',
}

describe('Gmail operations', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    fileMocks.assertToolFileAccess.mockResolvedValue(null)
    fileMocks.processFilesToUserFiles.mockReturnValue([STORED_FILE])
    fileMocks.downloadServableFilesWithinBudget.mockResolvedValue([
      { buffer: Buffer.from('test'), contentType: 'text/plain' },
    ])
  })

  it('fails closed before file download and provider work when access is denied', async () => {
    fileMocks.assertToolFileAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      executeGmailSend(
        { ...MAIL, attachments: [STORED_FILE] },
        { requestId: 'request-1', userId: 'user-1' }
      )
    ).rejects.toEqual(
      new GmailOperationError('File not found', 404, {
        success: false,
        error: 'File not found',
      })
    )
    expect(fileMocks.downloadServableFilesWithinBudget).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
