import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertFileAccess,
  mockDownloadFile,
  mockFetchToken,
  mockInvokeApi,
  mockInvokeMultipart,
  mockProcessFiles,
} = vi.hoisted(() => ({
  mockAssertFileAccess: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockFetchToken: vi.fn(),
  mockInvokeApi: vi.fn(),
  mockInvokeMultipart: vi.fn(),
  mockProcessFiles: vi.fn(),
}))

vi.mock('@/lib/internal/sap-concur/client', () => ({
  assertSafeExternalUrl: (url: string) => new URL(url),
  extractSapConcurError: (body: unknown, status: number) =>
    typeof body === 'object' && body !== null && 'message' in body
      ? String(body.message)
      : `Concur request failed with HTTP ${status}`,
  fetchSapConcurAccessToken: mockFetchToken,
  invokeSapConcur: mockInvokeApi,
  invokeSapConcurMultipart: mockInvokeMultipart,
}))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mockProcessFiles,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mockDownloadFile,
}))

vi.mock('@/lib/uploads/utils/servable-file-response', () => ({
  docNotReadyResponse: () => null,
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mockAssertFileAccess,
}))

import {
  executeSapConcurUploadOperation,
  SapConcurOperationError,
} from '@/lib/internal/sap-concur/operations'
import { sapConcurUploadInputSchema } from '@/lib/internal/sap-concur/schema'

const context = {
  requestId: 'request-1',
  userId: 'user-1',
}

beforeEach(() => {
  mockFetchToken.mockResolvedValue({
    accessToken: 'access-token',
    geolocation: 'https://us.api.concursolutions.com',
  })
  mockInvokeApi.mockResolvedValue({ status: 200, body: { id: 'budget-1' }, headers: {} })
  mockInvokeMultipart.mockResolvedValue({
    status: 201,
    body: { id: 'receipt-1' },
    headers: { location: 'https://us.api.concursolutions.com/receipts/receipt-1' },
  })
  mockProcessFiles.mockReturnValue([
    {
      key: 'workspace-file-key',
      name: 'receipt.pdf',
      size: 1024,
      type: 'application/pdf',
    },
  ])
  mockAssertFileAccess.mockResolvedValue(null)
  mockDownloadFile.mockResolvedValue({
    buffer: Buffer.from('receipt'),
    contentType: 'application/pdf',
  })
})

describe('executeSapConcurUploadOperation', () => {
  function uploadInput(size = 1024) {
    return sapConcurUploadInputSchema.parse({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      operation: 'upload_receipt_image',
      userId: 'concur-user-1',
      receipt: {
        key: 'workspace-file-key',
        name: 'receipt.pdf',
        size,
        type: 'application/pdf',
      },
    })
  }

  it('authorizes the protected file before storage or provider access', async () => {
    mockAssertFileAccess.mockResolvedValueOnce(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )

    const error = await executeSapConcurUploadOperation(uploadInput(), context).catch(
      (caught) => caught
    )

    expect(error).toBeInstanceOf(SapConcurOperationError)
    expect(error).toMatchObject({
      status: 404,
      body: { success: false, error: 'File not found' },
    })
    expect(mockDownloadFile).not.toHaveBeenCalled()
    expect(mockFetchToken).not.toHaveBeenCalled()
  })

  it('rejects declared receipt sizes above 25MB before materializing the file', async () => {
    mockProcessFiles.mockReturnValueOnce([
      {
        key: 'workspace-file-key',
        name: 'receipt.pdf',
        size: 25 * 1024 * 1024 + 1,
        type: 'application/pdf',
      },
    ])

    const error = await executeSapConcurUploadOperation(uploadInput(), context).catch(
      (caught) => caught
    )

    expect(error).toBeInstanceOf(SapConcurOperationError)
    expect(error.body.error).toContain('exceeds Concur upload limit of 25MB')
    expect(mockDownloadFile).not.toHaveBeenCalled()
  })
})
