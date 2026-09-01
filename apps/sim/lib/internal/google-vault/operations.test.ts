/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  secureFetchWithPinnedIP: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

import { downloadGoogleVaultExportFile } from '@/lib/internal/google-vault/operations'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

describe('downloadGoogleVaultExportFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mocks.secureFetchWithPinnedIP.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': "attachment; filename*=UTF-8''vault%20export.zip",
        },
      })
    )
  })

  it('pins and bounds the GCS download while preserving file output', async () => {
    const controller = new AbortController()
    const result = await downloadGoogleVaultExportFile(
      {
        accessToken: 'token',
        matterId: 'matter-1',
        bucketName: 'bucket-1',
        objectName: 'exports/result.zip',
      },
      { signal: controller.signal }
    )

    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledWith(
      expect.stringContaining('/storage/v1/b/bucket-1/o/exports%2Fresult.zip?alt=media'),
      '203.0.113.1',
      {
        profile: 'configuredEndpoint',
        method: 'GET',
        headers: { Authorization: 'Bearer token' },
        maxResponseBytes: MAX_BUFFERED_TRANSFER_BYTES,
        signal: controller.signal,
      }
    )
    expect(result.output.file).toEqual({
      name: 'vault export.zip',
      mimeType: 'application/zip',
      data: 'AQID',
      size: 3,
    })
  })
})
