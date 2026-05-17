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

const { mockProcessFilesToUserFiles, mockDownloadFileFromStorage, mockAssertToolFileAccess } =
  vi.hoisted(() => ({
    mockProcessFilesToUserFiles: vi.fn(),
    mockDownloadFileFromStorage: vi.fn(),
    mockAssertToolFileAccess: vi.fn(),
  }))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mockProcessFilesToUserFiles,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mockDownloadFileFromStorage,
}))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mockAssertToolFileAccess,
}))

import { POST } from '@/app/api/tools/agiloft/attach/route'

const PINNED_IP = '93.184.216.34'

const baseBody = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'demo',
  login: 'admin',
  password: 'secret',
  table: 'contracts',
  recordId: '42',
  fieldName: 'attachments',
  file: { key: 's3://bucket/file.txt', name: 'file.txt', size: 5, type: 'text/plain' },
  fileName: 'file.txt',
}

function mockSecureFetchResponse(body: {
  ok?: boolean
  status?: number
  json?: unknown
  text?: string
}) {
  return {
    ok: body.ok ?? true,
    status: body.status ?? 200,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => body.text ?? '',
    json: async () => body.json ?? {},
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })
  inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
    isValid: true,
    resolvedIP: PINNED_IP,
    originalHostname: 'example.agiloft.com',
  })
  mockProcessFilesToUserFiles.mockReturnValue([
    { key: 's3://bucket/file.txt', name: 'file.txt', size: 5, type: 'text/plain' },
  ])
  mockAssertToolFileAccess.mockResolvedValue(null)
  mockDownloadFileFromStorage.mockResolvedValue(Buffer.from('hello'))
})

describe('POST /api/tools/agiloft/attach', () => {
  it('rejects unauthenticated requests', async () => {
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'unauthorized',
    })

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(401)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('blocks SSRF when the instance URL fails DNS validation', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValueOnce({
      isValid: false,
      error: 'instanceUrl resolves to a blocked IP address',
    })

    const response = await POST(
      createMockRequest('POST', { ...baseBody, instanceUrl: 'https://attacker.example.com' })
    )

    expect(response.status).toBe(400)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('pins the resolved IP for login, attach, and logout (TOCTOU fix)', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(mockSecureFetchResponse({ json: { access_token: 'tok-att' } }))
      .mockResolvedValueOnce(mockSecureFetchResponse({ text: '1' }))
      .mockResolvedValueOnce(mockSecureFetchResponse({}))

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)
    const data = (await response.json()) as {
      success: true
      output: { totalAttachments: number; fileName: string }
    }
    expect(data.output.totalAttachments).toBe(1)
    expect(data.output.fileName).toBe('file.txt')

    const calls = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls
    expect(calls).toHaveLength(3)
    for (const call of calls) {
      expect(call[1]).toBe(PINNED_IP)
    }

    expect(calls[0][0]).toContain('https://example.agiloft.com/ewws/EWLogin')
    expect(calls[1][0]).toContain('https://example.agiloft.com/ewws/EWAttach')
    expect(calls[1][2]).toMatchObject({
      method: 'PUT',
      headers: {
        Authorization: 'Bearer tok-att',
        'Content-Type': 'application/octet-stream',
      },
    })
    expect(calls[2][0]).toContain('https://example.agiloft.com/ewws/EWLogout')

    // DNS only resolved once.
    expect(inputValidationMockFns.mockValidateUrlWithDNS).toHaveBeenCalledTimes(1)
  })
})
