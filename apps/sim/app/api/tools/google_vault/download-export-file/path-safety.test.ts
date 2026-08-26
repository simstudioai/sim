/**
 * @vitest-environment node
 *
 * Guards the Google Vault export-file download route against a dot-segment
 * pop, WITHOUT weakening its `%2F` encoding.
 *
 * A GCS object name legitimately contains `/`, and the JSON API requires it
 * percent-encoded as `%2F` inside the single `/o/{object}` segment. So
 * `safeUrlPath` (which preserves `/` as a separator) would be the wrong tool
 * here and `encodeURIComponent` must stay. What `encodeURIComponent` does not
 * stop is a value that is exactly `.` or `..`: those characters are
 * unreserved, survive encoding, and the WHATWG parser removes the segment
 * afterwards — `/b/{bucket}/o/..` resolves to `/b/{bucket}/`, the object
 * *list* endpoint, with the caller's bearer token attached.
 *
 * Only the whole value is checked, not each `/`-separated component: because
 * the value becomes one `%2F`-encoded segment, an interior `..` never forms a
 * URL segment and an object literally named `a/../b` is legally addressable.
 *
 * `objectName` and `bucketName` are `visibility: 'user-only'` on
 * `google_vault_download_export_file`, so this is not LLM-reachable — lower
 * severity than the Drive `fileId` sites, fixed for the same reason.
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { POST } from '@/app/api/tools/google_vault/download-export-file/route'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

const PINNED_IP = '93.184.216.34'
const REJECTED = ['..', '.', '  ..  '] as const

function downloadResponse() {
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/zip' }),
    body: null,
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(4),
  }
}

function requestedUrl(): string {
  return String(mockValidateUrlWithDNS.mock.calls[0][0])
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
    originalHostname: 'storage.googleapis.com',
  })
})

describe('POST /api/tools/google_vault/download-export-file traversal safety', () => {
  it.each(REJECTED)(
    'rejects objectName %j with a clean 400 and no outbound request',
    async (objectName) => {
      mockSecureFetchWithPinnedIP.mockResolvedValueOnce(downloadResponse())

      const response = await POST(
        createMockRequest('POST', {
          accessToken: 'token-123',
          matterId: 'matter-1',
          bucketName: 'vault-bucket',
          objectName,
        })
      )

      expect(response.status).toBe(400)
      const data = (await response.json()) as { success: boolean; error: string }
      expect(data.success).toBe(false)
      expect(data.error).toMatch(/objectName/)
      expect(mockValidateUrlWithDNS).not.toHaveBeenCalled()
      expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    }
  )

  it.each(REJECTED)(
    'rejects bucketName %j with a clean 400 and no outbound request',
    async (bucketName) => {
      mockSecureFetchWithPinnedIP.mockResolvedValueOnce(downloadResponse())

      const response = await POST(
        createMockRequest('POST', {
          accessToken: 'token-123',
          matterId: 'matter-1',
          bucketName,
          objectName: 'exports/file.zip',
        })
      )

      expect(response.status).toBe(400)
      const data = (await response.json()) as { success: boolean; error: string }
      expect(data.success).toBe(false)
      expect(data.error).toMatch(/bucketName/)
      expect(mockValidateUrlWithDNS).not.toHaveBeenCalled()
      expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    }
  )

  it('keeps a nested object name as one %2F-encoded segment, byte-identical to today', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(downloadResponse())

    const response = await POST(
      createMockRequest('POST', {
        accessToken: 'token-123',
        matterId: 'matter-1',
        bucketName: 'vault-bucket',
        objectName: 'matter-1/exports/file name.zip',
      })
    )
    expect(response.status).toBe(200)

    expect(requestedUrl()).toBe(
      'https://storage.googleapis.com/storage/v1/b/vault-bucket/o/matter-1%2Fexports%2Ffile%20name.zip?alt=media'
    )
    const segments = new URL(requestedUrl()).pathname.split('/').filter(Boolean)
    expect(segments).toEqual([
      'storage',
      'v1',
      'b',
      'vault-bucket',
      'o',
      'matter-1%2Fexports%2Ffile%20name.zip',
    ])
  })

  it('preserves an interior ".." component, which never forms a URL segment', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(downloadResponse())

    const response = await POST(
      createMockRequest('POST', {
        accessToken: 'token-123',
        matterId: 'matter-1',
        bucketName: 'vault-bucket',
        objectName: 'a/../b',
      })
    )
    expect(response.status).toBe(200)

    const segments = new URL(requestedUrl()).pathname.split('/').filter(Boolean)
    expect(segments).toEqual(['storage', 'v1', 'b', 'vault-bucket', 'o', 'a%2F..%2Fb'])
  })
})
