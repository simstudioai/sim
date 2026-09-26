import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockProcessFilesToUserFiles } = fileUtilsMockFns
const { mockDownloadServableFilesWithinBudget } = fileUtilsServerMockFns

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
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockProcessFilesToUserFiles.mockReturnValue([STORED_FILE])
    mockDownloadServableFilesWithinBudget.mockResolvedValue([
      { buffer: Buffer.from('test'), contentType: 'text/plain' },
    ])
  })

  it('fails closed before file download and provider work when access is denied', async () => {
    mockAssertToolFileAccess.mockResolvedValue(
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
    expect(mockDownloadServableFilesWithinBudget).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
