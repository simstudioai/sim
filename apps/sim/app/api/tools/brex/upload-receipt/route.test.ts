/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockProcessFilesToUserFiles, mockDownloadFileFromStorage, mockAssertToolFileAccess } =
  vi.hoisted(() => ({
    mockProcessFilesToUserFiles: vi.fn(),
    mockDownloadFileFromStorage: vi.fn(),
    mockAssertToolFileAccess: vi.fn(),
  }))

vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mockProcessFilesToUserFiles,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mockDownloadFileFromStorage,
}))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mockAssertToolFileAccess,
}))

import { POST } from '@/app/api/tools/brex/upload-receipt/route'

const mockFetch = vi.fn()

const baseBody = {
  apiKey: 'bxt_test_token',
  expenseId: 'expense_123',
  file: { key: 'uploads/receipt.pdf', name: 'receipt.pdf', size: 5, type: 'application/pdf' },
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
  hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })
  mockProcessFilesToUserFiles.mockReturnValue([
    { key: 'uploads/receipt.pdf', name: 'receipt.pdf', size: 5, type: 'application/pdf' },
  ])
  mockAssertToolFileAccess.mockResolvedValue(null)
  mockDownloadFileFromStorage.mockResolvedValue(Buffer.from('receipt-bytes'))
})

describe('POST /api/tools/brex/upload-receipt', () => {
  it('rejects unauthenticated requests', async () => {
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'unauthorized',
    })

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('creates a receipt upload for an expense and PUTs the file to the pre-signed URL', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ id: 'receipt_1', uri: 'https://s3.example.com/presigned' })
      )
      .mockResolvedValueOnce(jsonResponse({}))

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      success: true,
      output: { receiptId: 'receipt_1', receiptName: 'receipt.pdf', expenseId: 'expense_123' },
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const [createUrl, createInit] = mockFetch.mock.calls[0]
    expect(createUrl).toBe('https://api.brex.com/v1/expenses/card/expense_123/receipt_upload')
    expect(createInit.method).toBe('POST')
    expect(createInit.headers.Authorization).toBe('Bearer bxt_test_token')
    expect(JSON.parse(createInit.body)).toEqual({ receipt_name: 'receipt.pdf' })

    const [uploadUrl, uploadInit] = mockFetch.mock.calls[1]
    expect(uploadUrl).toBe('https://s3.example.com/presigned')
    expect(uploadInit.method).toBe('PUT')
  })

  it('rejects a whitespace-only expense ID instead of falling back to receipt match', async () => {
    const response = await POST(createMockRequest('POST', { ...baseBody, expenseId: '   ' }))
    expect(response.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('trims a padded expense ID before building the upload URL', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ id: 'receipt_5', uri: 'https://s3.example.com/presigned' })
      )
      .mockResolvedValueOnce(jsonResponse({}))

    const response = await POST(
      createMockRequest('POST', { ...baseBody, expenseId: '  expense_123  ' })
    )
    expect(response.status).toBe(200)
    const [createUrl] = mockFetch.mock.calls[0]
    expect(createUrl).toBe('https://api.brex.com/v1/expenses/card/expense_123/receipt_upload')
    const data = await response.json()
    expect(data.output.expenseId).toBe('expense_123')
  })

  it('rejects a whitespace-only receipt name', async () => {
    const response = await POST(createMockRequest('POST', { ...baseBody, receiptName: '   ' }))
    expect(response.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('uses receipt match when no expense ID is provided', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ id: 'receipt_2', uri: 'https://s3.example.com/presigned' })
      )
      .mockResolvedValueOnce(jsonResponse({}))

    const response = await POST(
      createMockRequest('POST', { apiKey: 'bxt_test_token', file: baseBody.file })
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.output).toEqual({
      receiptId: 'receipt_2',
      receiptName: 'receipt.pdf',
      expenseId: null,
    })

    const [createUrl] = mockFetch.mock.calls[0]
    expect(createUrl).toBe('https://api.brex.com/v1/expenses/card/receipt_match')
  })

  it('honors a receipt name override', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ id: 'receipt_3', uri: 'https://s3.example.com/presigned' })
      )
      .mockResolvedValueOnce(jsonResponse({}))

    const response = await POST(
      createMockRequest('POST', { ...baseBody, receiptName: 'march-dinner.pdf' })
    )
    expect(response.status).toBe(200)
    const [, createInit] = mockFetch.mock.calls[0]
    expect(JSON.parse(createInit.body)).toEqual({ receipt_name: 'march-dinner.pdf' })
  })

  it('propagates Brex API errors', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'Expense not found' }, 404))

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.success).toBe(false)
    expect(data.error).toContain('Expense not found')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects files over the 50 MB limit', async () => {
    mockDownloadFileFromStorage.mockResolvedValueOnce(Buffer.alloc(50 * 1024 * 1024 + 1))

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('50 MB')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fails when the pre-signed upload fails', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({ id: 'receipt_4', uri: 'https://s3.example.com/presigned' })
      )
      .mockResolvedValueOnce(jsonResponse({}, 403))

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(502)
    const data = await response.json()
    expect(data.success).toBe(false)
  })

  it('denies access to files the caller cannot read', async () => {
    const deniedResponse = new Response(
      JSON.stringify({ success: false, error: 'File not found' }),
      {
        status: 404,
      }
    )
    mockAssertToolFileAccess.mockResolvedValueOnce(deniedResponse)

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(404)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
