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

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { resolveVantaUploadFile } from '@/lib/internal/vanta/file-input'
import { VANTA_MAX_TRANSFER_BYTES } from '@/lib/internal/vanta/input'

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockProcessFilesToUserFiles } = fileUtilsMockFns

const baseInput = {
  clientId: 'client',
  clientSecret: 'secret',
  documentId: 'document-1',
}
const file = { key: 'workspace/file.txt', name: 'file.txt', size: 4 }

describe('resolveVantaUploadFile', () => {
  beforeEach(() => {
    mockProcessFilesToUserFiles.mockReturnValue([{ ...file, type: 'text/plain' }])
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('test'),
      contentType: 'text/plain',
    })
  })

  it('fails closed on denied stored-file access', async () => {
    mockAssertToolFileAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )

    await expect(
      resolveVantaUploadFile({ ...baseInput, file }, { requestId: 'request-1', userId: 'user-1' })
    ).rejects.toMatchObject({
      status: 404,
      body: { success: false, error: 'File not found' },
    })
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
  })

  it('preserves exact size errors for declared and streamed oversized files', async () => {
    mockProcessFilesToUserFiles.mockReturnValueOnce([
      { ...file, size: VANTA_MAX_TRANSFER_BYTES + 1, type: 'text/plain' },
    ])
    await expect(
      resolveVantaUploadFile({ ...baseInput, file }, { requestId: 'request-1', userId: 'user-1' })
    ).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'File size (100.00MB) exceeds upload limit of 100MB' },
    })

    mockDownloadServableFileFromStorage.mockRejectedValueOnce(
      new PayloadSizeLimitError({
        label: 'file',
        maxBytes: VANTA_MAX_TRANSFER_BYTES,
        observedBytes: VANTA_MAX_TRANSFER_BYTES + 1024 * 1024,
      })
    )
    await expect(
      resolveVantaUploadFile({ ...baseInput, file }, { requestId: 'request-1', userId: 'user-1' })
    ).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'File size (101.00MB) exceeds upload limit of 100MB' },
    })
  })
})
