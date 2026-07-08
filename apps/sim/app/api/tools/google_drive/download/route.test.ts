/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { POST } from '@/app/api/tools/google_drive/download/route'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

const PINNED_IP = '93.184.216.34'

const baseBody = {
  accessToken: 'token-123',
  fileId: 'file-abc',
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function fileResponse(bytes: number, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(bytes),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })
  mockValidateUrlWithDNS.mockResolvedValue({
    isValid: true,
    resolvedIP: PINNED_IP,
    originalHostname: 'www.googleapis.com',
  })
})

describe('POST /api/tools/google_drive/download', () => {
  it('downloads a normal file under the size cap', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'file-abc',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          size: '1024',
          capabilities: { canReadRevisions: false },
        })
      )
      .mockResolvedValueOnce(fileResponse(1024))

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)
    const data = (await response.json()) as { success: boolean; output: { file: { size: number } } }
    expect(data.success).toBe(true)
    expect(data.output.file.size).toBe(1024)

    const downloadCall = mockSecureFetchWithPinnedIP.mock.calls[1]
    expect(downloadCall[2]).toMatchObject({ maxResponseBytes: MAX_FILE_SIZE })
  })

  it('rejects the download before fetching content when metadata size exceeds the cap', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      jsonResponse({
        id: 'file-abc',
        name: 'huge.bin',
        mimeType: 'application/octet-stream',
        size: String(MAX_FILE_SIZE + 1),
        capabilities: { canReadRevisions: false },
      })
    )

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(413)
    const data = (await response.json()) as { success: boolean; error: string }
    expect(data.success).toBe(false)
    expect(data.error).toContain('exceeds maximum size')

    // Content download must never be initiated once metadata size trips the check.
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)
  })

  it('surfaces a clean 413 when the streamed content exceeds the cap', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'file-abc',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          capabilities: { canReadRevisions: false },
        })
      )
      .mockRejectedValueOnce(
        new PayloadSizeLimitError({
          label: 'response body',
          maxBytes: MAX_FILE_SIZE,
          observedBytes: MAX_FILE_SIZE + 1,
        })
      )

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(413)
    const data = (await response.json()) as { success: boolean }
    expect(data.success).toBe(false)
  })

  it('proceeds to the streamed download when metadata size is malformed', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'file-abc',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          size: 'not-a-number',
          capabilities: { canReadRevisions: false },
        })
      )
      .mockResolvedValueOnce(fileResponse(1024))

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)
    const data = (await response.json()) as { success: boolean; output: { file: { size: number } } }
    expect(data.success).toBe(true)
    expect(data.output.file.size).toBe(1024)

    // The early size check should be skipped, but the streaming cap must still apply.
    const downloadCall = mockSecureFetchWithPinnedIP.mock.calls[1]
    expect(downloadCall[2]).toMatchObject({ maxResponseBytes: MAX_FILE_SIZE })
  })

  it('does not require a metadata size for Google Workspace exports', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'doc-1',
          name: 'My Doc',
          mimeType: 'application/vnd.google-apps.document',
          capabilities: { canReadRevisions: false },
        })
      )
      .mockResolvedValueOnce(fileResponse(2048))

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)

    const exportCall = mockSecureFetchWithPinnedIP.mock.calls[1]
    expect(exportCall[2]).toMatchObject({ maxResponseBytes: MAX_FILE_SIZE })
  })
})
