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

/** Obvious non-secret so credential scanners do not flag these fixtures. */
const PLACEHOLDER_PASSWORD = 'not-a-real-password'

const PINNED_IP = '93.184.216.34'

const baseBody = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'demo',
  login: 'admin',
  password: PLACEHOLDER_PASSWORD,
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
    text: async () => body.text ?? JSON.stringify(body.json ?? {}),
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

  it('retrieves on the pinned IP in a single call (TOCTOU fix)', async () => {
    const fileBytes = Buffer.from('hello-attachment', 'utf-8')

    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
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
    /**
     * EWRetrieve authenticates from inline credentials, so there is no
     * login/logout pair — one call, on the pre-resolved IP.
     */
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toBe(PINNED_IP)

    // Original hostname is preserved in the URL (so TLS SNI works).
    expect(calls[0][0]).toContain('https://example.agiloft.com/ewws/EWRetrieve')
    expect(calls[0][0]).toContain('&filePosition=')
    expect(calls[0][2]).toMatchObject({ method: 'GET' })
    expect(calls[0][2].headers?.Authorization).toBeUndefined()
    // Attachment downloads are byte-capped rather than inheriting the global default.
    expect(calls[0][2].maxResponseBytes).toBe(25 * 1024 * 1024)

    // DNS only resolved once — no second lookup that could rebind.
    expect(inputValidationMockFns.mockValidateUrlWithDNS).toHaveBeenCalledTimes(1)
  })

  it('resolves the real type when Agiloft labels an attachment octet-stream', async () => {
    const fileBytes = Buffer.from('PKdocx-bytes', 'utf-8')

    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({
        arrayBuffer: fileBytes.buffer.slice(
          fileBytes.byteOffset,
          fileBytes.byteOffset + fileBytes.byteLength
        ) as ArrayBuffer,
        headers: new Headers({
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="Master Agreement.docx"',
        }),
      })
    )

    const response = await POST(createMockRequest('POST', baseBody))
    const data = (await response.json()) as { output: { file: { mimeType: string } } }

    /**
     * Agiloft labels most attachments octet-stream whatever they are. The
     * filename disambiguates what the leading bytes cannot: a ZIP header is
     * equally a .docx, .xlsx or a plain archive.
     */
    expect(data.output.file.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  })

  it('propagates upstream errors', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({ ok: false, status: 404, text: 'Record not found' })
    )

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(404)
    const data = (await response.json()) as { success: false; error: string }
    expect(data.error).toContain('Record not found')
  })

  it('rejects an EWREST error document returned in place of file bytes', async () => {
    const errorBody = Buffer.from(
      "EWREST_error='Search in table contracts returns no records for key 1';"
    )
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({
        arrayBuffer: errorBody.buffer.slice(
          errorBody.byteOffset,
          errorBody.byteOffset + errorBody.byteLength
        ) as ArrayBuffer,
        headers: new Headers({ 'content-type': 'text/html' }),
      })
    )

    const response = await POST(createMockRequest('POST', baseBody))
    expect(response.status).toBe(502)
    const data = (await response.json()) as { success: false; error: string }
    expect(data.error).toContain('no records for key')
  })
})
