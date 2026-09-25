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

const mocks = vi.hoisted(() => ({
  clientConstructed: vi.fn(),
  createTarget: vi.fn(),
  uploadReceipt: vi.fn(),
}))

vi.mock('@/lib/internal/brex/client', () => {
  class BrexReceiptError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  }
  class BrexReceiptClient {
    constructor(apiKey: string, signal?: AbortSignal) {
      mocks.clientConstructed(apiKey, signal)
    }

    createUploadTarget = mocks.createTarget
    uploadReceipt = mocks.uploadReceipt
  }
  return { BrexReceiptClient, BrexReceiptError }
})

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

const { mockProcessFilesToUserFiles } = fileUtilsMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockAssertToolFileAccess } = filesAuthorizationMockFns

import { executeBrexMatchReceipt } from '@/lib/internal/brex/operations'

const rawFile = { key: 'uploads/receipt.pdf', name: 'receipt.pdf', size: 5 }
const userFile = { ...rawFile, type: 'application/pdf' }

describe('Brex receipt operations', () => {
  beforeEach(() => {
    mockProcessFilesToUserFiles.mockReturnValue([userFile])
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('receipt-bytes'),
      contentType: 'application/pdf',
    })
    mocks.createTarget.mockResolvedValue({ id: 'receipt-1', uri: 'https://upload.example/file' })
    mocks.uploadReceipt.mockResolvedValue(undefined)
  })

  it('does not load receipt bytes when file authorization fails', async () => {
    mockAssertToolFileAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )
    const response = await executeBrexMatchReceipt(
      { apiKey: 'token', file: rawFile },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(404)
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.createTarget).not.toHaveBeenCalled()
  })
})
