/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUploadToS3, mockGetPresignedUrlWithConfig } = vi.hoisted(() => ({
  mockUploadToS3: vi.fn(),
  mockGetPresignedUrlWithConfig: vi.fn(),
}))

vi.mock('@/lib/uploads/config', () => ({
  USE_S3_STORAGE: true,
  USE_BLOB_STORAGE: false,
  USE_GCS_STORAGE: false,
  getStorageConfig: () => ({ bucket: 'bucket', region: 'us-east-1' }),
}))

vi.mock('@/lib/uploads/providers/s3/client', () => ({
  uploadToS3: mockUploadToS3,
  getPresignedUrlWithConfig: mockGetPresignedUrlWithConfig,
}))

import { uploadExecutionFile } from '@/lib/uploads/contexts/execution/execution-file-manager'

const context = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
}

describe('uploadExecutionFile key allocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockUploadToS3.mockImplementation(async (file: Buffer, key: string, contentType: string) => ({
      key,
      path: `/api/files/serve/${encodeURIComponent(key)}`,
      name: key,
      size: file.length,
      type: contentType,
    }))
    mockGetPresignedUrlWithConfig.mockResolvedValue('https://example.com/download')
    dbChainMockFns.limit.mockResolvedValue([])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'file-1' }])
  })

  it('gives same-named files in one execution distinct keys', async () => {
    const first = await uploadExecutionFile(
      context,
      Buffer.alloc(13575),
      'image.png',
      'image/png',
      'user-1'
    )
    const second = await uploadExecutionFile(
      context,
      Buffer.alloc(37226),
      'image.png',
      'image/png',
      'user-1'
    )

    expect(first.key).not.toBe(second.key)
    expect(dbChainMockFns.insert).toHaveBeenCalledTimes(2)
  })
})
