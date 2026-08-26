/**
 * @vitest-environment node
 *
 * Guards the internal Google Drive export route against path traversal.
 *
 * This route already wrapped `fileId` in `encodeURIComponent`, which is not a
 * fix: `.` and `..` are unreserved characters, so they survive encoding, and
 * the WHATWG parser then removes them as dot segments *after* percent-decoding
 * (`/drive/v3/files/%2e%2e/export` resolves to `/drive/v3/export`). Only value
 * rejection closes it.
 *
 * Assertions resolve through `new URL(...)` and check the resolved pathname's
 * segment count and fixed segments, never a `startsWith` prefix.
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { POST } from '@/app/api/tools/google_drive/export/route'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

const PINNED_IP = '93.184.216.34'
const DOC_MIME = 'application/vnd.google-apps.document'
const EXPORT_MIME = 'text/plain'

const REJECTED = ['..', '.', '  ..  ', 'a/b', '..\\..'] as const
const NEUTRALIZED = ['%2e%2e', 'x?alt=media'] as const

function metadataResponse(fileId: string) {
  const body = { id: fileId, name: 'notes', mimeType: DOC_MIME }
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

function exportResponse() {
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers({ 'content-length': '4' }),
    body: null,
    text: async () => 'text',
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(4),
  }
}

function requestedUrls(): string[] {
  return mockValidateUrlWithDNS.mock.calls.map((call) => String(call[0]))
}

function bodyFor(fileId: string) {
  return { accessToken: 'token-123', fileId, mimeType: EXPORT_MIME }
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

describe('POST /api/tools/google_drive/export traversal safety', () => {
  it.each(REJECTED)('rejects fileId %j with a clean 400 and no outbound request', async (fileId) => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(metadataResponse('doc-1'))
      .mockResolvedValueOnce(exportResponse())

    const response = await POST(createMockRequest('POST', bodyFor(fileId)))

    expect(response.status).toBe(400)
    const data = (await response.json()) as { success: boolean; error: string }
    expect(data.success).toBe(false)
    expect(data.error).toMatch(/fileId/)
    expect(mockValidateUrlWithDNS).not.toHaveBeenCalled()
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it.each(NEUTRALIZED)('keeps fileId %j inside a single path segment', async (fileId) => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(metadataResponse('doc-1'))
      .mockResolvedValueOnce(exportResponse())

    const response = await POST(createMockRequest('POST', bodyFor(fileId)))
    expect(response.status).toBe(200)

    const metadataSegments = new URL(requestedUrls()[0]).pathname.split('/').filter(Boolean)
    expect(metadataSegments).toHaveLength(4)
    expect(metadataSegments.slice(0, 3)).toEqual(['drive', 'v3', 'files'])
    expect(decodeURIComponent(metadataSegments[3])).toBe(fileId)

    const exportSegments = new URL(requestedUrls()[1]).pathname.split('/').filter(Boolean)
    expect(exportSegments).toHaveLength(5)
    expect(exportSegments.slice(0, 3)).toEqual(['drive', 'v3', 'files'])
    expect(decodeURIComponent(exportSegments[3])).toBe(fileId)
    expect(exportSegments[4]).toBe('export')
  })

  it('leaves a legitimate file id byte-identical to the pre-guard URL', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(metadataResponse('1a2B3c4D-5e6F_7g8H9i0J'))
      .mockResolvedValueOnce(exportResponse())

    const response = await POST(createMockRequest('POST', bodyFor('1a2B3c4D-5e6F_7g8H9i0J')))
    expect(response.status).toBe(200)

    const urls = requestedUrls()
    expect(urls[0]).toContain('/drive/v3/files/1a2B3c4D-5e6F_7g8H9i0J?fields=')
    expect(urls[1]).toBe(
      'https://www.googleapis.com/drive/v3/files/1a2B3c4D-5e6F_7g8H9i0J/export?mimeType=text%2Fplain'
    )
  })

  it('preserves a dot inside a longer id', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(metadataResponse('a..b'))
      .mockResolvedValueOnce(exportResponse())

    const response = await POST(createMockRequest('POST', bodyFor('a..b')))
    expect(response.status).toBe(200)

    const exportSegments = new URL(requestedUrls()[1]).pathname.split('/').filter(Boolean)
    expect(exportSegments).toEqual(['drive', 'v3', 'files', 'a..b', 'export'])
  })
})
