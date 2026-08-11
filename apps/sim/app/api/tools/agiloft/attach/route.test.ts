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

/** Obvious non-secret so credential scanners do not flag these fixtures. */
const PLACEHOLDER_PASSWORD = 'not-a-real-password'

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
  downloadServableFileFromStorage: mockDownloadFileFromStorage,
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
  password: PLACEHOLDER_PASSWORD,
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
    text: async () => body.text ?? JSON.stringify(body.json ?? {}),
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
  mockDownloadFileFromStorage.mockResolvedValue({
    buffer: Buffer.from('hello'),
    contentType: 'application/octet-stream',
  })
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

  it('attaches with inline credentials on the pinned IP, with no login round trip', async () => {
    /** Documented response: EWREST_<fieldName>.length='1'; */
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({ text: "EWREST_attachments.length='1';" })
    )

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)
    const data = (await response.json()) as {
      success: true
      output: { totalAttachments: number; fileName: string }
    }
    expect(data.output.totalAttachments).toBe(1)
    expect(data.output.fileName).toBe('file.txt')

    const calls = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toBe(PINNED_IP)

    expect(calls[0][0]).toContain('https://example.agiloft.com/ewws/EWAttach')
    expect(calls[0][0]).toContain('&$login=admin')
    expect(calls[0][2]).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
    })
    // A bearer token on this surface is rejected; it must not be sent.
    expect(calls[0][2].headers.Authorization).toBeUndefined()

    // DNS only resolved once.
    expect(inputValidationMockFns.mockValidateUrlWithDNS).toHaveBeenCalledTimes(1)
  })
})
