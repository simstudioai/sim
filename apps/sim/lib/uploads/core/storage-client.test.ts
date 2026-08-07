/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetFileMetadataByKey, mockSend, mockHeadObjectCommand } = vi.hoisted(() => ({
  mockGetFileMetadataByKey: vi.fn(),
  mockSend: vi.fn(),
  mockHeadObjectCommand: vi.fn().mockImplementation(class {}),
}))

vi.mock('@aws-sdk/client-s3', () => ({
  HeadObjectCommand: mockHeadObjectCommand,
}))

vi.mock('@/lib/uploads/config', () => ({
  USE_S3_STORAGE: true,
  USE_BLOB_STORAGE: false,
  USE_GCS_STORAGE: false,
  S3_CONFIG: { bucket: 'bucket', region: 'region' },
}))

vi.mock('@/lib/uploads/providers/s3/client', () => ({
  getS3Client: () => ({ send: mockSend }),
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataByKey: mockGetFileMetadataByKey,
}))

import { getFileMetadata } from '@/lib/uploads/core/storage-client'

/** The exact error the AWS SDK raises from HeadObject for an absent object. */
const notFound = Object.assign(new Error('NotFound'), {
  name: 'NotFound',
  $fault: 'client',
  $metadata: { httpStatusCode: 404 },
})

describe('getFileMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFileMetadataByKey.mockResolvedValue(null)
  })

  it('reports an absent object as no metadata rather than throwing', async () => {
    mockSend.mockRejectedValue(notFound)

    await expect(getFileMetadata('workspace/ws/superseded-key.md')).resolves.toEqual({})
  })

  it('still propagates a genuine storage failure', async () => {
    const denied = Object.assign(new Error('AccessDenied'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    })
    mockSend.mockRejectedValue(denied)

    await expect(getFileMetadata('workspace/ws/key.md')).rejects.toThrow('AccessDenied')
  })

  it('returns provider metadata when the object exists', async () => {
    mockSend.mockResolvedValue({ Metadata: { workspaceid: 'ws-1' } })

    await expect(getFileMetadata('workspace/ws/key.md')).resolves.toEqual({ workspaceid: 'ws-1' })
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
    expect(mockSend).not.toHaveBeenCalled()
  })
})
