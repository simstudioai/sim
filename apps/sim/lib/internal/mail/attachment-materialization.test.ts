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

import { materializeAuthorizedMailAttachments } from '@/lib/internal/mail/attachment-materialization'

const file = { key: 'workspace/ws-1/a.txt', name: 'a.txt', size: 3, type: 'text/plain' }
const context = { requestId: 'request-1', userId: 'user-1', signal: new AbortController().signal }

describe('mail attachment materialization', () => {
  beforeEach(() => {
    mockProcessFilesToUserFiles.mockReturnValue([file])
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFilesWithinBudget.mockResolvedValue([
      { buffer: Buffer.from('abc'), contentType: 'text/plain' },
    ])
  })

  it('rejects declared-size overruns before authorization when requested', async () => {
    await expect(
      materializeAuthorizedMailAttachments([file], context, {
        label: 'Total attachment size',
        maxTotalBytes: 2,
        preflightDeclaredSize: true,
      })
    ).rejects.toMatchObject({ kind: 'size', observedBytes: 3 })
    expect(mockAssertToolFileAccess).not.toHaveBeenCalled()
  })
})
