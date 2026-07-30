/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { POST } from '@/app/api/tools/slack/download/route'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

const PINNED_IP = '93.184.216.34'

const baseBody = {
  accessToken: 'token-123',
  fileId: 'file-abc',
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

const originalFetch = global.fetch

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
    originalHostname: 'files.slack.com',
  })
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      file: {
        name: 'report.pdf',
        mimetype: 'application/pdf',
        url_private: 'https://files.slack.com/files-pri/T000-F000/report.pdf',
      },
    }),
  }) as unknown as typeof fetch
})

afterEach(() => {
  global.fetch = originalFetch
})

describe('POST /api/tools/slack/download', () => {
  it('downloads a normal file under the size cap', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(fileResponse(1024))

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)
    const data = (await response.json()) as { success: boolean; output: { file: { size: number } } }
    expect(data.success).toBe(true)
    expect(data.output.file.size).toBe(1024)

    const downloadCall = mockSecureFetchWithPinnedIP.mock.calls[0]
    expect(downloadCall[2]).toMatchObject({ maxResponseBytes: MAX_FILE_SIZE })
  })

  it('surfaces a clean 413 when the streamed content exceeds the cap', async () => {
    mockSecureFetchWithPinnedIP.mockRejectedValueOnce(
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
