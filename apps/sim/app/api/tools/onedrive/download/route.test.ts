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
import { POST } from '@/app/api/tools/onedrive/download/route'

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

function fileResponse(bytes: number) {
  return {
    ok: true,
    status: 200,
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
    originalHostname: 'graph.microsoft.com',
  })
})

describe('POST /api/tools/onedrive/download', () => {
  it('downloads a normal file under the size cap', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(
        jsonResponse({ id: 'file-abc', name: 'report.pdf', file: { mimeType: 'application/pdf' } })
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

  it('surfaces a clean 413 when the streamed content exceeds the cap', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'file-abc',
          name: 'huge.bin',
          file: { mimeType: 'application/octet-stream' },
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
})
