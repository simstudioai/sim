/**
 * @vitest-environment node
 *
 * Guards the internal Google Drive download route against path traversal.
 *
 * This route was invisible to the tools-side traversal sweep, which probed
 * each tool's `request.url`. The route has none: the `google_drive_download`
 * tool posts to it and the route builds the googleapis URL itself, bare —
 * `https://www.googleapis.com/drive/v3/files/${fileId}` — from a body field
 * the contract validates only as a non-empty string, and which the tool
 * declares `visibility: 'user-or-llm'`.
 *
 * Every assertion resolves the built URL through `new URL(...)`, the same
 * normalization `fetch` performs, and checks the resolved pathname's segment
 * count and fixed segments rather than a `startsWith` prefix — which
 * `/drive/v3/files/..` would still satisfy before normalization.
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { POST } from '@/app/api/tools/google_drive/download/route'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

const PINNED_IP = '93.184.216.34'

/** Values no encoding neutralizes; the route must reject them outright. */
const REJECTED = ['..', '.', '  ..  ', 'a/b', '..\\..'] as const

/** Values that must not throw but must stay inside one path segment. */
const NEUTRALIZED = ['%2e%2e', 'x?alt=media'] as const

function jsonResponse(body: unknown) {
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

function fileResponse() {
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(8),
  }
}

function metadataFor(fileId: string) {
  return {
    id: fileId,
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: '8',
    capabilities: { canReadRevisions: false },
  }
}

function requestedUrls(): string[] {
  return mockValidateUrlWithDNS.mock.calls.map((call) => String(call[0]))
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

describe('POST /api/tools/google_drive/download traversal safety', () => {
  it.each(REJECTED)(
    'rejects fileId %j with a clean 400 and no outbound request',
    async (fileId) => {
      const response = await POST(createMockRequest('POST', { accessToken: 'token-123', fileId }))

      expect(response.status).toBe(400)
      const data = (await response.json()) as { success: boolean; error: string }
      expect(data.success).toBe(false)
      expect(data.error).toMatch(/fileId/)
      expect(mockValidateUrlWithDNS).not.toHaveBeenCalled()
      expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    }
  )

  it.each(NEUTRALIZED)('keeps fileId %j inside a single path segment', async (fileId) => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse(metadataFor('file-abc')))
      .mockResolvedValueOnce(fileResponse())

    const response = await POST(createMockRequest('POST', { accessToken: 'token-123', fileId }))
    expect(response.status).toBe(200)

    const metadataUrl = new URL(requestedUrls()[0])
    const segments = metadataUrl.pathname.split('/').filter(Boolean)
    expect(segments).toHaveLength(4)
    expect(segments.slice(0, 3)).toEqual(['drive', 'v3', 'files'])
    expect(decodeURIComponent(segments[3])).toBe(fileId)
    expect(metadataUrl.searchParams.get('supportsAllDrives')).toBe('true')
  })

  it('leaves a legitimate file id byte-identical to the pre-guard URL', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(jsonResponse(metadataFor('1a2B3c4D-5e6F_7g8H9i0J')))
      .mockResolvedValueOnce(fileResponse())

    const response = await POST(
      createMockRequest('POST', { accessToken: 'token-123', fileId: '1a2B3c4D-5e6F_7g8H9i0J' })
    )
    expect(response.status).toBe(200)

    const urls = requestedUrls()
    expect(urls[0]).toContain('/drive/v3/files/1a2B3c4D-5e6F_7g8H9i0J?fields=')
    expect(new URL(urls[1]).pathname).toBe('/drive/v3/files/1a2B3c4D-5e6F_7g8H9i0J')
  })

  it('preserves a dot inside a longer id and keeps the revisions path intact', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(
        jsonResponse({ ...metadataFor('a..b'), capabilities: { canReadRevisions: true } })
      )
      .mockResolvedValueOnce(fileResponse())
      .mockResolvedValueOnce(jsonResponse({ revisions: [] }))

    const response = await POST(
      createMockRequest('POST', {
        accessToken: 'token-123',
        fileId: 'a..b',
        includeRevisions: true,
      })
    )
    expect(response.status).toBe(200)

    const revisionsUrl = new URL(requestedUrls()[2])
    const segments = revisionsUrl.pathname.split('/').filter(Boolean)
    expect(segments).toEqual(['drive', 'v3', 'files', 'a..b', 'revisions'])
  })
})
