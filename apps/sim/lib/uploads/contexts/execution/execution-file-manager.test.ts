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

describe('uploadExecutionFile replacement compatibility', () => {
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
  })

  it('allows changed bytes and content type at the same execution-scoped key', async () => {
    const context = {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    }
    const key = 'execution/workspace-1/workflow-1/execution-1/result.txt'
    const existingMetadata = {
      id: 'file-1',
      key,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      folderId: null,
      context: 'execution',
      originalName: key,
      displayName: key,
      contentType: 'text/plain',
      size: 3,
      deletedAt: null,
    }

    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existingMetadata])
    dbChainMockFns.returning.mockResolvedValueOnce([existingMetadata])

    const first = await uploadExecutionFile(
      context,
      Buffer.from('old'),
      'result.txt',
      'text/plain',
      'user-1'
    )
    const second = await uploadExecutionFile(
      context,
      Buffer.from('{"new":true}'),
      'result.txt',
      'application/json',
      'user-1'
    )

    expect(first.key).toBe(key)
    expect(second).toMatchObject({
      key,
      size: 12,
      type: 'application/json',
    })
    expect(mockUploadToS3).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.insert).toHaveBeenCalledTimes(1)
  })
})
