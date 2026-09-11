/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUploadToS3, mockGetPresignedUrlWithConfig, mockDeleteFromS3 } = vi.hoisted(() => ({
  mockUploadToS3: vi.fn(),
  mockGetPresignedUrlWithConfig: vi.fn(),
  mockDeleteFromS3: vi.fn(),
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
  deleteFromS3: mockDeleteFromS3,
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
    mockDeleteFromS3.mockResolvedValue(undefined)
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

  it('commits tracked provenance with the canonical file before returning its URL', async () => {
    const contentUpdatedAt = new Date('2026-01-01T00:00:00Z')
    dbChainMockFns.returning.mockImplementation(async () => {
      const values = dbChainMockFns.values.mock.calls.at(-1)?.[0]
      return [{ ...values, id: values?.id ?? values?.fileId, contentUpdatedAt }]
    })
    const file = await uploadExecutionFile(
      context,
      Buffer.from('archive'),
      'report.zip',
      'application/zip',
      'user-1',
      { status: 'exact', entries: [] }
    )

    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: file.id, key: file.key, context: 'execution' })
    )
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ fileId: file.id, contentUpdatedAt, status: 'exact', entries: [] })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ secretProvenanceVersion: 1 })
    expect(dbChainMockFns.set.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetPresignedUrlWithConfig.mock.invocationCallOrder[0]
    )
    expect(file).not.toHaveProperty('secretProvenance')
  })

  it('removes uploaded bytes when their provenance cannot be committed', async () => {
    const failure = new Error('Provenance commit failed')
    dbChainMockFns.returning
      .mockResolvedValueOnce([
        {
          id: 'recorded-file',
          contentUpdatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ])
      .mockRejectedValueOnce(failure)

    await expect(
      uploadExecutionFile(
        context,
        Buffer.from('archive'),
        'report.zip',
        'application/zip',
        'user-1',
        { status: 'unknown' }
      )
    ).rejects.toThrow('Provenance commit failed')

    expect(mockDeleteFromS3).toHaveBeenCalledWith(
      mockUploadToS3.mock.calls[0][1],
      expect.any(Object),
      undefined
    )
    expect(mockGetPresignedUrlWithConfig).not.toHaveBeenCalled()
  })

  it('rejects tracked uploads without an owner before writing bytes', async () => {
    await expect(
      uploadExecutionFile(
        context,
        Buffer.from('archive'),
        'report.zip',
        'application/zip',
        undefined,
        {
          status: 'exact',
          entries: [],
        }
      )
    ).rejects.toThrow('requires an owner and workspace')
    expect(mockUploadToS3).not.toHaveBeenCalled()
  })

  it('cleans both committed metadata and bytes when its download URL cannot be issued', async () => {
    const contentUpdatedAt = new Date('2026-01-01T00:00:00Z')
    dbChainMockFns.returning.mockImplementation(async () => {
      const values = dbChainMockFns.values.mock.calls.at(-1)?.[0]
      return [{ ...values, id: values?.id ?? values?.fileId, contentUpdatedAt }]
    })
    mockGetPresignedUrlWithConfig.mockRejectedValueOnce(new Error('Signing failed'))

    await expect(
      uploadExecutionFile(
        context,
        Buffer.from('archive'),
        'report.zip',
        'application/zip',
        'user-1',
        { status: 'unknown' }
      )
    ).rejects.toThrow('Signing failed')
    expect(mockDeleteFromS3).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ deletedAt: expect.any(Date) })
  })

  it('removes the uploaded object and metadata when creating its download URL fails', async () => {
    mockGetPresignedUrlWithConfig.mockRejectedValueOnce(new Error('Presigning failed'))

    await expect(
      uploadExecutionFile(context, Buffer.from('file'), 'file.txt', 'text/plain', 'user-1')
    ).rejects.toThrow('Presigning failed')

    expect(mockDeleteFromS3.mock.calls[0]?.[0]).toBe(mockUploadToS3.mock.calls[0]?.[1])
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
  })

  it('removes its unique object when metadata insertion fails before uploadFile returns', async () => {
    dbChainMockFns.returning.mockRejectedValueOnce(new Error('Metadata persistence failed'))

    await expect(
      uploadExecutionFile(context, Buffer.from('file'), 'file.txt', 'text/plain', 'user-1')
    ).rejects.toThrow('Metadata persistence failed')

    expect(mockDeleteFromS3.mock.calls[0]?.[0]).toBe(mockUploadToS3.mock.calls[0]?.[1])
    expect(mockDeleteFromS3).toHaveBeenCalledOnce()
    expect(mockGetPresignedUrlWithConfig).not.toHaveBeenCalled()
  })

  it('keeps the original upload error if cleanup also fails', async () => {
    mockGetPresignedUrlWithConfig.mockRejectedValueOnce(new Error('Presigning failed'))
    mockDeleteFromS3.mockRejectedValueOnce(new Error('Deletion failed'))

    await expect(
      uploadExecutionFile(context, Buffer.from('file'), 'file.txt', 'text/plain', 'user-1')
    ).rejects.toThrow('Presigning failed')

    expect(mockDeleteFromS3).toHaveBeenCalledTimes(1)
  })
})
