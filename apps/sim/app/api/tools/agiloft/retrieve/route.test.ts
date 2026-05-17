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

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { POST } from '@/app/api/tools/agiloft/retrieve/route'

const PINNED_IP = '93.184.216.34'

const baseBody = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'demo',
  login: 'admin',
  password: 'secret',
  table: 'contracts',
  recordId: '42',
  fieldName: 'attachments',
  position: '0',
}

function mockSecureFetchResponse(body: {
  ok?: boolean
  status?: number
  json?: unknown
  text?: string
  arrayBuffer?: ArrayBuffer
  headers?: Headers
}) {
  return {
    ok: body.ok ?? true,
    status: body.status ?? 200,
    statusText: '',
    headers: body.headers ?? new Headers(),
    body: null,
    text: async () => body.text ?? '',
    json: async () => body.json ?? {},
    arrayBuffer: async () => body.arrayBuffer ?? new ArrayBuffer(0),
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
})

describe('POST /api/tools/agiloft/retrieve', () => {
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
    const data = (await response.json()) as { success: false; error: string }
    expect(data.success).toBe(false)
    expect(data.error).toContain('blocked IP')
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('pins the resolved IP for login, retrieve, and logout (TOCTOU fix)', async () => {
    const fileBytes = Buffer.from('hello-attachment', 'utf-8')

    inputValidationMockFns.mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(mockSecureFetchResponse({ json: { access_token: 'tok-xyz' } }))
      .mockResolvedValueOnce(
        mockSecureFetchResponse({
          arrayBuffer: fileBytes.buffer.slice(
            fileBytes.byteOffset,
            fileBytes.byteOffset + fileBytes.byteLength
          ) as ArrayBuffer,
          headers: new Headers({
            'content-type': 'text/plain',
            'content-disposition': 'attachment; filename="report.txt"',
          }),
        })
      )
      .mockResolvedValueOnce(mockSecureFetchResponse({}))

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(200)
    const data = (await response.json()) as {
      success: true
      output: { file: { name: string; mimeType: string; data: string; size: number } }
    }

    expect(data.output.file.name).toBe('report.txt')
    expect(data.output.file.mimeType).toBe('text/plain')
    expect(data.output.file.size).toBe(fileBytes.length)
    expect(Buffer.from(data.output.file.data, 'base64').toString('utf-8')).toBe('hello-attachment')

    const calls = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls
    expect(calls).toHaveLength(3)

    // All three outbound calls must use the pre-resolved IP.
    for (const call of calls) {
      expect(call[1]).toBe(PINNED_IP)
    }

    // Original hostname is preserved in the URL (so TLS SNI works).
    expect(calls[0][0]).toContain('https://example.agiloft.com/ewws/EWLogin')
    expect(calls[1][0]).toContain('https://example.agiloft.com/ewws/EWRetrieve')
    expect(calls[1][2]).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer tok-xyz' },
    })
    expect(calls[2][0]).toContain('https://example.agiloft.com/ewws/EWLogout')

    // DNS only resolved once — no second lookup that could rebind.
    expect(inputValidationMockFns.mockValidateUrlWithDNS).toHaveBeenCalledTimes(1)
  })

  it('propagates upstream errors and still calls logout', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(mockSecureFetchResponse({ json: { access_token: 'tok-err' } }))
      .mockResolvedValueOnce(
        mockSecureFetchResponse({ ok: false, status: 404, text: 'Record not found' })
      )
      .mockResolvedValueOnce(mockSecureFetchResponse({}))

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(404)
    const data = (await response.json()) as { success: false; error: string }
    expect(data.error).toContain('Record not found')

    // Logout still runs.
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(3)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[2][0]).toContain(
      '/ewws/EWLogout'
    )
  })
})
