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

import { buildDocxFromContent } from '@/lib/microsoft-word/document.server'
import { POST } from '@/app/api/tools/microsoft_word/append/route'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

const PINNED_IP = '93.184.216.34'

const baseBody = {
  accessToken: 'token-123',
  documentId: 'doc-abc',
  content: 'Appended paragraph',
}

/** A Graph `driveItem` metadata response carrying a content tag. */
function itemResponse(cTag: string) {
  const body = {
    id: 'doc-abc',
    name: 'notes.docx',
    cTag,
    file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  }
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

/** A Graph content response carrying a real `.docx` package. */
async function docxResponse() {
  const buffer = await buildDocxFromContent('Existing paragraph')
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  }
}

/** The `createUploadSession` response carrying the preauthenticated upload URL. */
function uploadSessionResponse(uploadUrl = 'https://sn3302.up.1drv.com/up/session-abc') {
  const body = { uploadUrl, expirationDateTime: '2026-01-01T00:00:00Z' }
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function preconditionFailedResponse() {
  return {
    ok: false,
    status: 412,
    statusText: 'Precondition Failed',
    headers: new Headers(),
    body: null,
    text: async () => '',
    json: async () => ({}),
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
  mockValidateUrlWithDNS.mockResolvedValue({
    isValid: true,
    resolvedIP: PINNED_IP,
    originalHostname: 'graph.microsoft.com',
  })
})

describe('POST /api/tools/microsoft_word/append', () => {
  it('writes through a conditional upload session carrying the content tag', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(itemResponse('tag-1'))
      .mockResolvedValueOnce(await docxResponse())
      .mockResolvedValueOnce(uploadSessionResponse())
      .mockResolvedValueOnce(itemResponse('tag-2'))

    const response = await POST(createMockRequest('POST', baseBody))

    expect(response.status).toBe(200)
    const data = (await response.json()) as {
      success: boolean
      output: { updatedContent: boolean }
    }
    expect(data.success).toBe(true)
    expect(data.output.updatedContent).toBe(true)

    // The precondition rides on the session creation, which Graph documents as
    // returning 412 on a mismatch.
    const sessionCall = mockSecureFetchWithPinnedIP.mock.calls.find((call) =>
      String(call[0]).endsWith('/createUploadSession')
    )
    expect(sessionCall?.[2]).toMatchObject({ method: 'POST' })
    expect(sessionCall?.[2].headers).toMatchObject({ 'if-match': 'tag-1' })

    // Bytes go to the preauthenticated URL, and must not carry the bearer token.
    const uploadCall = mockSecureFetchWithPinnedIP.mock.calls.at(-1)
    expect(uploadCall?.[0]).toBe('https://sn3302.up.1drv.com/up/session-abc')
    expect(uploadCall?.[2]).toMatchObject({ method: 'PUT' })
    expect(uploadCall?.[2].headers.Authorization).toBeUndefined()
  })

  it('refuses to overwrite when the service rejects the precondition', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(itemResponse('tag-1'))
      .mockResolvedValueOnce(await docxResponse())
      .mockResolvedValueOnce(preconditionFailedResponse())

    const response = await POST(createMockRequest('POST', baseBody))

    expect(response.status).toBe(409)
    const data = (await response.json()) as { success: boolean; error: string }
    expect(data.success).toBe(false)
    expect(data.error).toMatch(/no other change was overwritten/)

    // The session was refused, so no bytes were ever sent.
    expect(mockSecureFetchWithPinnedIP.mock.calls.some((call) => call[2]?.method === 'PUT')).toBe(
      false
    )
  })

  it('maps a malformed document ID to a client error, not a server error', async () => {
    const response = await POST(createMockRequest('POST', { ...baseBody, documentId: 'bad/../id' }))

    expect(response.status).toBe(400)
    const data = (await response.json()) as { success: boolean; error: string }
    expect(data.success).toBe(false)
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('refuses to write Word bytes over a drive item that is not a .docx', async () => {
    const pdf = {
      id: 'doc-abc',
      name: 'invoice.pdf',
      cTag: 'tag-1',
      file: { mimeType: 'application/pdf' },
    }
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: '',
      headers: new Headers(),
      body: null,
      text: async () => JSON.stringify(pdf),
      json: async () => pdf,
      arrayBuffer: async () => new ArrayBuffer(0),
    })

    const response = await POST(createMockRequest('POST', baseBody))

    expect(response.status).toBe(400)
    const data = (await response.json()) as { error: string }
    expect(data.error).toMatch(/not a Word document/)
    expect(mockSecureFetchWithPinnedIP.mock.calls.some((call) => call[2]?.method === 'PUT')).toBe(
      false
    )
  })

  it('reports a no-op without writing when the content adds no paragraph', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(itemResponse('tag-1'))
      .mockResolvedValueOnce(await docxResponse())

    const response = await POST(createMockRequest('POST', { ...baseBody, content: '   \n  \n' }))

    expect(response.status).toBe(200)
    const data = (await response.json()) as { output: { updatedContent: boolean } }
    expect(data.output.updatedContent).toBe(false)
    expect(mockSecureFetchWithPinnedIP.mock.calls.some((call) => call[2]?.method === 'PUT')).toBe(
      false
    )
  })

  it('refuses to write when Graph reports no version to compare against', async () => {
    const untagged = {
      id: 'doc-abc',
      name: 'notes.docx',
      file: {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    }
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: '',
      headers: new Headers(),
      body: null,
      text: async () => JSON.stringify(untagged),
      json: async () => untagged,
      arrayBuffer: async () => new ArrayBuffer(0),
    })

    const response = await POST(createMockRequest('POST', baseBody))

    expect(response.status).toBe(409)
    const data = (await response.json()) as { error: string }
    expect(data.error).toMatch(/did not report a version/)
    expect(mockSecureFetchWithPinnedIP.mock.calls.some((call) => call[2]?.method === 'PUT')).toBe(
      false
    )
  })

  it('surfaces a conflict raised when the bytes commit', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(itemResponse('tag-1'))
      .mockResolvedValueOnce(await docxResponse())
      .mockResolvedValueOnce(uploadSessionResponse())
      .mockResolvedValueOnce(preconditionFailedResponse())

    const response = await POST(createMockRequest('POST', baseBody))

    expect(response.status).toBe(409)
    const data = (await response.json()) as { error: string }
    expect(data.error).toMatch(/no other change was overwritten/)
  })
})
