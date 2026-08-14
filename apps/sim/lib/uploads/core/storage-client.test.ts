/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetFileMetadataByKey, mockHeadS3Object } = vi.hoisted(() => ({
  mockGetFileMetadataByKey: vi.fn(),
  mockHeadS3Object: vi.fn(),
}))

vi.mock('@/lib/uploads/config', () => ({
  USE_S3_STORAGE: true,
  USE_BLOB_STORAGE: false,
  USE_GCS_STORAGE: false,
  S3_CONFIG: { bucket: 'bucket', region: 'region' },
}))

vi.mock('@/lib/uploads/providers/s3/client', () => ({
  headS3Object: mockHeadS3Object,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataByKey: mockGetFileMetadataByKey,
}))

import { getFileMetadata } from '@/lib/uploads/core/storage-client'

describe('getFileMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFileMetadataByKey.mockResolvedValue(null)
  })

  it('reports an absent object as no metadata rather than throwing', async () => {
    /** The provider client owns not-found and reports absence as `null`. */
    mockHeadS3Object.mockResolvedValue(null)

    await expect(getFileMetadata('workspace/ws/superseded-key.md')).resolves.toEqual({})
  })

  it('still propagates a genuine storage failure', async () => {
    mockHeadS3Object.mockRejectedValue(
      Object.assign(new Error('AccessDenied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      })
    )

    await expect(getFileMetadata('workspace/ws/key.md')).rejects.toThrow('AccessDenied')
  })

  it('returns provider metadata when the object exists', async () => {
    mockHeadS3Object.mockResolvedValue({ size: 12, metadata: { workspaceid: 'ws-1' } })

    await expect(getFileMetadata('workspace/ws/key.md')).resolves.toEqual({ workspaceid: 'ws-1' })
  })

  it('treats an object carrying no metadata as no metadata', async () => {
    mockHeadS3Object.mockResolvedValue({ size: 12 })

    await expect(getFileMetadata('workspace/ws/key.md')).resolves.toEqual({})
  })

  it('prefers the database record when one exists', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({
      userId: 'user-1',
      workspaceId: 'ws-1',
      originalName: 'doc.md',
      uploadedAt: new Date('2026-01-01T00:00:00Z'),
      context: 'workspace',
    })

    const metadata = await getFileMetadata('workspace/ws/key.md')

    expect(metadata.workspaceId).toBe('ws-1')
    expect(mockHeadS3Object).not.toHaveBeenCalled()
  })
})
