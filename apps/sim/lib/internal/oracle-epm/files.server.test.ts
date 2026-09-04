/** @vitest-environment node */
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_WORKSPACE_FILE_SIZE,
  MAX_WORKSPACE_FORMDATA_FILE_SIZE,
} from '@/lib/uploads/shared/types'

const mocks = vi.hoisted(() => ({
  abort: vi.fn(),
  complete: vi.fn(),
  createMultipartUpload: vi.fn(),
  deleteFile: vi.fn(),
  downloadFileStream: vi.fn(),
  generateFileId: vi.fn(),
  generatePresignedDownloadUrl: vi.fn(),
  generateUniqueExecutionFileKey: vi.fn(),
  verifyFileAccess: vi.fn(),
  write: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({ verifyFileAccess: mocks.verifyFileAccess }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  createMultipartUpload: mocks.createMultipartUpload,
  deleteFile: mocks.deleteFile,
  downloadFileStream: mocks.downloadFileStream,
  generatePresignedDownloadUrl: mocks.generatePresignedDownloadUrl,
}))
vi.mock('@/lib/uploads/contexts/execution/utils', () => ({
  generateFileId: mocks.generateFileId,
  generateUniqueExecutionFileKey: mocks.generateUniqueExecutionFileKey,
}))

import {
  openOracleEpmSourceFile,
  storeOracleEpmDownload,
} from '@/lib/internal/oracle-epm/files.server'

const context = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  workflowId: '00000000-0000-4000-8000-000000000002',
  executionId: '00000000-0000-4000-8000-000000000003',
}

describe('Oracle EPM file primitives', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.verifyFileAccess.mockResolvedValue(true)
    mocks.downloadFileStream.mockResolvedValue(Readable.from([Buffer.from('abc')]))
    mocks.createMultipartUpload.mockResolvedValue({
      write: mocks.write,
      complete: mocks.complete,
      abort: mocks.abort,
    })
    mocks.write.mockResolvedValue(undefined)
    mocks.complete.mockResolvedValue({ key: 'execution/key/report.csv', size: 3 })
    mocks.abort.mockResolvedValue(undefined)
    mocks.deleteFile.mockResolvedValue(undefined)
    mocks.generateUniqueExecutionFileKey.mockReturnValue('execution/key/report.csv')
    mocks.generateFileId.mockReturnValue('file-1')
    mocks.generatePresignedDownloadUrl.mockResolvedValue('https://storage.example/signed')
  })

  it('authorizes before opening and counts source bytes while streaming', async () => {
    const source = await openOracleEpmSourceFile({
      file: {
        id: 'f',
        name: 'report final.csv',
        url: '',
        size: 3,
        type: 'text/csv',
        key: 'workspace/key',
        context: 'workspace',
      },
      userId: 'user-1',
      maxBytes: 3,
    })
    const chunks: Buffer[] = []
    for await (const chunk of source.chunks) chunks.push(chunk)
    expect(mocks.verifyFileAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.downloadFileStream.mock.invocationCallOrder[0]
    )
    expect(Buffer.concat(chunks).toString()).toBe('abc')
    expect(source.fileName).toBe('report-final.csv')
  })

  it('rejects denied and over-limit source files before reading storage', async () => {
    await expect(
      openOracleEpmSourceFile({
        file: {
          id: 'f',
          name: 'x',
          url: '',
          size: 4,
          type: '',
          key: 'workspace/key',
          context: 'workspace',
        },
        userId: 'user-1',
        maxBytes: 3,
      })
    ).rejects.toThrow('maximum size')
    expect(mocks.verifyFileAccess).not.toHaveBeenCalled()

    mocks.verifyFileAccess.mockResolvedValue(false)
    await expect(
      openOracleEpmSourceFile({
        file: {
          id: 'f',
          name: 'x',
          url: '',
          size: 1,
          type: '',
          key: 'workspace/key',
          context: 'workspace',
        },
        userId: 'user-1',
        maxBytes: 3,
      })
    ).rejects.toThrow('not found')
    expect(mocks.downloadFileStream).not.toHaveBeenCalled()
  })

  it('clamps caller limits to existing workspace and execution-attachment limits', async () => {
    const source = await openOracleEpmSourceFile({
      file: {
        id: 'f',
        name: 'x',
        url: '',
        size: 0,
        type: '',
        key: 'workspace/key',
        context: 'workspace',
      },
      userId: 'user-1',
      maxBytes: MAX_WORKSPACE_FILE_SIZE + 1,
    })
    expect(source.maxBytes).toBe(MAX_WORKSPACE_FILE_SIZE)

    await expect(
      storeOracleEpmDownload({
        body: new ReadableStream(),
        fileName: 'x',
        context,
        maxBytes: MAX_WORKSPACE_FORMDATA_FILE_SIZE + 10,
        contentLength: MAX_WORKSPACE_FORMDATA_FILE_SIZE + 1,
      })
    ).rejects.toThrow('maximum size')
    expect(mocks.createMultipartUpload).not.toHaveBeenCalled()
  })

  it('rejects an untrusted execution storage context before creating a key', async () => {
    await expect(
      storeOracleEpmDownload({
        body: new ReadableStream(),
        fileName: 'x',
        context: { ...context, executionId: '../other' },
        maxBytes: 3,
      })
    ).rejects.toThrow('context is invalid')
    expect(mocks.generateUniqueExecutionFileKey).not.toHaveBeenCalled()
    expect(mocks.createMultipartUpload).not.toHaveBeenCalled()
  })

  it('destroys an over-limit source stream during in-flight counting', async () => {
    const stream = Readable.from([Buffer.from('abcd')])
    const destroy = vi.spyOn(stream, 'destroy')
    mocks.downloadFileStream.mockResolvedValue(stream)
    const source = await openOracleEpmSourceFile({
      file: {
        id: 'f',
        name: 'x',
        url: '',
        size: 0,
        type: '',
        key: 'workspace/key',
        context: 'workspace',
      },
      userId: 'user-1',
      maxBytes: 3,
    })
    await expect(async () => {
      for await (const _chunk of source.chunks) {
        // Consume the guarded stream.
      }
    }).rejects.toThrow('maximum size')
    expect(destroy).toHaveBeenCalled()
  })

  it('streams a bounded provider response into execution storage and returns UserFile', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
    })
    await expect(
      storeOracleEpmDownload({
        body,
        fileName: '../report?.csv',
        contentType: 'text/csv',
        context,
        maxBytes: MAX_WORKSPACE_FORMDATA_FILE_SIZE + 1,
      })
    ).resolves.toEqual({
      id: 'file-1',
      name: '.._report_.csv',
      url: 'https://storage.example/signed',
      size: 3,
      type: 'text/csv',
      key: 'execution/key/report.csv',
      context: 'execution',
    })
    expect(mocks.createMultipartUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'execution',
        completionPolicy: 'create-only',
      })
    )
    expect(mocks.write).toHaveBeenCalledWith(Buffer.from([1, 2, 3]))
    expect(mocks.generatePresignedDownloadUrl).toHaveBeenCalledWith(
      'execution/key/report.csv',
      'execution',
      300
    )
  })

  it('aborts partial storage on stream or size failure', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]))
        controller.close()
      },
    })
    await expect(
      storeOracleEpmDownload({ body, fileName: 'x', context, maxBytes: 3 })
    ).rejects.toThrow('maximum size')
    expect(mocks.abort).toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('removes a completed object if link generation fails', async () => {
    mocks.complete.mockResolvedValue({ key: 'execution/key/report.csv', size: 0 })
    mocks.generatePresignedDownloadUrl.mockRejectedValue(new Error('presign failed'))
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
    await expect(
      storeOracleEpmDownload({ body, fileName: 'x', context, maxBytes: 3 })
    ).rejects.toThrow('presign failed')
    expect(mocks.deleteFile).toHaveBeenCalledWith({
      key: 'execution/key/report.csv',
      context: 'execution',
    })
  })
})
