/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { MAX_MULTIPART_OVERHEAD_BYTES } from '@/lib/core/utils/stream-limits'

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
  executeSapConcurApiOperation,
  executeSapConcurUploadOperation,
  SapConcurOperationError,
} from '@/lib/internal/sap-concur/operations'
import {
  sapConcurApiInputSchema,
  sapConcurUploadInputSchema,
} from '@/lib/internal/sap-concur/schema'

const context = {
  requestId: 'request-1',
  userId: 'user-1',
}

beforeEach(() => {
  vi.clearAllMocks()
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

describe('executeSapConcurApiOperation', () => {
  it('threads the AbortSignal through token acquisition and the provider request', async () => {
    const controller = new AbortController()
    const input = sapConcurApiInputSchema.parse({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      path: '/budget/v4/budgets/budget-1',
      method: 'GET',
    })

    const result = await executeSapConcurApiOperation(input, {
      ...context,
      signal: controller.signal,
    })

    expect(mockFetchToken).toHaveBeenCalledWith(input, 'request-1', controller.signal)
    expect(mockInvokeApi).toHaveBeenCalledWith(
      input,
      'access-token',
      'https://us.api.concursolutions.com',
      controller.signal
    )
    expect(result.body).toEqual({
      success: true,
      output: { status: 200, data: { id: 'budget-1' } },
    })
  })

  it('preserves provider failures and response headers', async () => {
    const input = sapConcurApiInputSchema.parse({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      path: '/budget/v4/budgets/budget-1',
    })
    mockInvokeApi.mockResolvedValueOnce({
      status: 429,
      body: { message: 'Slow down' },
      headers: { 'retry-after': '30' },
    })

    const error = await executeSapConcurApiOperation(input, context).catch((caught) => caught)

    expect(error).toBeInstanceOf(SapConcurOperationError)
    expect(error).toMatchObject({
      status: 429,
      body: { success: false, error: 'Slow down', status: 429 },
      headers: { 'retry-after': '30' },
    })
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

  it('threads cancellation through the bounded file download and multipart request', async () => {
    const controller = new AbortController()
    const input = uploadInput()

    const result = await executeSapConcurUploadOperation(input, {
      ...context,
      signal: controller.signal,
    })

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'workspace-file-key' }),
      'request-1',
      expect.anything(),
      { maxBytes: 25 * 1024 * 1024, signal: controller.signal }
    )
    expect(mockFetchToken).toHaveBeenCalledWith(input, 'request-1', controller.signal)
    expect(mockInvokeMultipart).toHaveBeenCalledWith(
      'https://us.api.concursolutions.com/receipts/v4/users/concur-user-1/image-only-receipts',
      'access-token',
      expect.any(FormData),
      25 * 1024 * 1024 + DEFAULT_MAX_JSON_BODY_BYTES + MAX_MULTIPART_OVERHEAD_BYTES,
      controller.signal
    )
    expect(result.headers).toEqual({
      location: 'https://us.api.concursolutions.com/receipts/receipt-1',
    })
  })

  it('rejects an abort before protected file resolution', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Cancelled', 'AbortError'))

    await expect(
      executeSapConcurUploadOperation(uploadInput(), {
        ...context,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockAssertFileAccess).not.toHaveBeenCalled()
  })
})
