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
  downloadServableFileFromStorage: mockDownloadFileFromStorage,
}))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mockAssertToolFileAccess,
}))

import { POST } from '@/app/api/tools/quickbooks/upload-attachment/route'

const mockFetch = vi.fn()
const baseBody = {
  accessToken: 'quickbooks-token',
  realmId: '123145',
  file: {
    key: 'uploads/receipt.pdf',
    name: 'receipt.pdf',
    size: 13,
    type: 'application/pdf',
  },
  entity: 'Bill',
  entityId: '17',
  note: 'Vendor receipt',
  includeOnSend: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
  hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })
  mockProcessFilesToUserFiles.mockReturnValue([baseBody.file])
  mockAssertToolFileAccess.mockResolvedValue(null)
  mockDownloadFileFromStorage.mockResolvedValue({
    buffer: Buffer.from('receipt-bytes'),
    contentType: 'application/pdf',
  })
  mockFetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        AttachableResponse: [{ Attachable: { Id: '100', FileName: 'receipt.pdf' } }],
      }),
      { headers: { 'content-type': 'application/json' }, status: 200 }
    )
  )
})

describe('POST /api/tools/quickbooks/upload-attachment', () => {
  it('rejects unauthenticated requests before resolving the file', async () => {
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(401)
    expect(mockProcessFilesToUserFiles).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects header-breaking access tokens at the API boundary', async () => {
    const response = await POST(
      createMockRequest('POST', {
        ...baseBody,
        accessToken: 'token\r\nX-Injected: true',
      })
    )

    expect(response.status).toBe(400)
    expect(mockProcessFilesToUserFiles).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('uploads an authorized file using QuickBooks multipart field names', async () => {
    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      output: {
        result: {
          AttachableResponse: [{ Attachable: { Id: '100', FileName: 'receipt.pdf' } }],
        },
      },
    })

    expect(mockAssertToolFileAccess).toHaveBeenCalledWith(
      'uploads/receipt.pdf',
      'user-1',
      expect.any(String),
      expect.anything()
    )
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://quickbooks.api.intuit.com/v3/company/123145/upload?minorversion=75')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer quickbooks-token',
      Accept: 'application/json',
    })

    const formData = init.body as FormData
    expect(formData.get('file_content_01')).toBeInstanceOf(Blob)
    const metadata = formData.get('file_metadata_01')
    expect(metadata).toBeInstanceOf(Blob)
    await expect((metadata as Blob).text()).resolves.toBe(
      JSON.stringify({
        AttachableRef: [
          {
            EntityRef: { type: 'Bill', value: '17' },
            IncludeOnSend: true,
          },
        ],
        FileName: 'receipt.pdf',
        ContentType: 'application/pdf',
        Note: 'Vendor receipt',
      })
    )
  })

  it('normalizes linked entity names before building attachment metadata', async () => {
    const response = await POST(
      createMockRequest('POST', {
        ...baseBody,
        entity: 'purchaseorder',
      })
    )
    expect(response.status).toBe(200)

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const metadata = (init.body as FormData).get('file_metadata_01')
    expect(metadata).toBeInstanceOf(Blob)
    await expect((metadata as Blob).text()).resolves.toContain(
      '"EntityRef":{"type":"PurchaseOrder","value":"17"}'
    )
  })

  it('rejects unsupported linked entity types before downloading the file', async () => {
    const response = await POST(
      createMockRequest('POST', {
        ...baseBody,
        entity: 'CompanyInfo',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'QuickBooks entity "CompanyInfo" cannot be linked to an attachment',
    })
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects file types outside the QuickBooks attachment whitelist', async () => {
    mockProcessFilesToUserFiles.mockReturnValueOnce([
      {
        ...baseBody.file,
        key: 'uploads/archive.zip',
        name: 'archive.zip',
        type: 'application/zip',
      },
    ])

    const response = await POST(createMockRequest('POST', baseBody))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'QuickBooks does not support .zip attachment files',
    })
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects resolved content types that do not match the file extension', async () => {
    mockDownloadFileFromStorage.mockResolvedValueOnce({
      buffer: Buffer.from('not-a-pdf'),
      contentType: 'text/plain',
    })

    const response = await POST(createMockRequest('POST', baseBody))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'QuickBooks does not support text/plain content for .pdf attachments',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects nested QuickBooks upload faults returned with HTTP 200', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          AttachableResponse: [
            {
              Fault: {
                Error: [{ Message: 'ValidationFault', Detail: 'Unsupported entity reference' }],
              },
            },
          ],
          time: '2026-07-29T23:00:00Z',
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 }
      )
    )

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'QuickBooks API error (200): Unsupported entity reference',
    })
  })

  it('rejects timestamp-only QuickBooks upload responses', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ time: '2026-07-29T23:00:00Z' }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    )

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'QuickBooks attachment upload returned no attachment',
    })
  })

  it('rejects files over the buffered 25 MB attachment limit', async () => {
    mockProcessFilesToUserFiles.mockReturnValueOnce([
      { ...baseBody.file, size: 25 * 1024 * 1024 + 1 },
    ])

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('25MB'),
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
