/** @vitest-environment node */
import { Readable } from 'node:stream'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { inputValidationMock } from '@sim/testing/mocks/input-validation.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import {
  uploadsExecutionMock,
  uploadsExecutionMockFns,
} from '@sim/testing/mocks/uploads-execution.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_WORKSPACE_FILE_SIZE,
  MAX_WORKSPACE_FORMDATA_FILE_SIZE,
} from '@/lib/uploads/shared/types'

const mocks = vi.hoisted(() => ({
  abort: vi.fn(),
  complete: vi.fn(),
  write: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/uploads/contexts/execution/utils', () => uploadsExecutionMock)

import {
  type OracleEpmSourceFile,
  openOracleEpmSourceFile,
  storeOracleEpmDownload,
} from '@/lib/internal/oracle-epm'

const context = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  workflowId: '00000000-0000-4000-8000-000000000002',
  executionId: '00000000-0000-4000-8000-000000000003',
}

describe('Oracle EPM file primitives', () => {
  beforeEach(() => {
    filesAuthorizationMockFns.mockVerifyFileAccess.mockResolvedValue(true)
    storageServiceMockFns.mockDownloadFileStream.mockResolvedValue(
      Readable.from([Buffer.from('abc')])
    )
    storageServiceMockFns.mockCreateMultipartUpload.mockResolvedValue({
      write: mocks.write,
      complete: mocks.complete,
      abort: mocks.abort,
    })
    mocks.write.mockResolvedValue(undefined)
    mocks.complete.mockResolvedValue({ key: 'execution/key/report.csv', size: 3 })
    mocks.abort.mockResolvedValue(undefined)
    storageServiceMockFns.mockDeleteFile.mockResolvedValue(undefined)
    uploadsExecutionMockFns.mockGenerateUniqueExecutionFileKey.mockReturnValue(
      'execution/key/report.csv'
    )
    uploadsExecutionMockFns.mockGenerateFileId.mockReturnValue('file-1')
    storageServiceMockFns.mockGeneratePresignedDownloadUrl.mockResolvedValue(
      'https://storage.example/signed'
    )
  })

  it('authorizes before opening and counts source bytes while streaming', async () => {
    const source: OracleEpmSourceFile = await openOracleEpmSourceFile({
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
    expect(filesAuthorizationMockFns.mockVerifyFileAccess.mock.invocationCallOrder[0]).toBeLessThan(
      storageServiceMockFns.mockDownloadFileStream.mock.invocationCallOrder[0]
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
    expect(filesAuthorizationMockFns.mockVerifyFileAccess).not.toHaveBeenCalled()

    filesAuthorizationMockFns.mockVerifyFileAccess.mockResolvedValue(false)
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
    expect(storageServiceMockFns.mockDownloadFileStream).not.toHaveBeenCalled()
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
    expect(storageServiceMockFns.mockCreateMultipartUpload).not.toHaveBeenCalled()
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
    expect(uploadsExecutionMockFns.mockGenerateUniqueExecutionFileKey).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockCreateMultipartUpload).not.toHaveBeenCalled()
  })

  it('destroys an over-limit source stream during in-flight counting', async () => {
    const stream = Readable.from([Buffer.from('abcd')])
    const destroy = vi.spyOn(stream, 'destroy')
    storageServiceMockFns.mockDownloadFileStream.mockResolvedValue(stream)
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

  it('destroys a source canceled while its storage stream is opening', async () => {
    let finishOpen: ((stream: Readable) => void) | undefined
    storageServiceMockFns.mockDownloadFileStream.mockReturnValue(
      new Promise((resolve) => {
        finishOpen = resolve
      })
    )
    const controller = new AbortController()
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
      signal: controller.signal,
    })
    const pending = (async () => {
      for await (const _chunk of source.chunks) {
        // Consume the guarded stream.
      }
    })()
    await flushMicrotasks()
    expect(storageServiceMockFns.mockDownloadFileStream).toHaveBeenCalled()
    controller.abort(new DOMException('user', 'AbortError'))
    const stream = Readable.from([])
    const destroy = vi.spyOn(stream, 'destroy')
    finishOpen?.(stream)

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(destroy).toHaveBeenCalled()
  })

  it('rejects a source canceled as an empty storage stream reaches EOF', async () => {
    const controller = new AbortController()
    const stream = new Readable({
      read() {
        this.push(null)
        controller.abort(new DOMException('user', 'AbortError'))
      },
    })
    storageServiceMockFns.mockDownloadFileStream.mockResolvedValue(stream)
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
      signal: controller.signal,
    })

    await expect(async () => {
      for await (const _chunk of source.chunks) {
        // Consume the guarded stream.
      }
    }).rejects.toMatchObject({ name: 'AbortError' })
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
    expect(storageServiceMockFns.mockCreateMultipartUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'execution',
        completionPolicy: 'create-only',
      })
    )
    expect(mocks.write).toHaveBeenCalledWith(Buffer.from([1, 2, 3]))
    expect(storageServiceMockFns.mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
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
    storageServiceMockFns.mockGeneratePresignedDownloadUrl.mockRejectedValue(
      new Error('presign failed')
    )
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
    await expect(
      storeOracleEpmDownload({ body, fileName: 'x', context, maxBytes: 3 })
    ).rejects.toThrow('presign failed')
    expect(storageServiceMockFns.mockDeleteFile).toHaveBeenCalledWith({
      key: 'execution/key/report.csv',
      context: 'execution',
    })
  })

  it('serializes cancellation cleanup after multipart completion settles', async () => {
    let finishCompletion: ((value: { key: string; size: number }) => void) | undefined
    mocks.complete.mockReturnValue(
      new Promise((resolve) => {
        finishCompletion = resolve
      })
    )
    const controller = new AbortController()
    const pending = storeOracleEpmDownload({
      body: new ReadableStream({
        start(streamController) {
          streamController.close()
        },
      }),
      fileName: 'report.csv',
      context,
      maxBytes: 3,
      signal: controller.signal,
    })
    await flushMicrotasks(3)
    expect(mocks.complete).toHaveBeenCalled()

    controller.abort(new DOMException('user', 'AbortError'))
    expect(mocks.abort).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockDeleteFile).not.toHaveBeenCalled()
    finishCompletion?.({ key: 'execution/key/report.csv', size: 0 })

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.abort).not.toHaveBeenCalled()
    expect(storageServiceMockFns.mockDeleteFile).toHaveBeenCalledTimes(1)
    expect(storageServiceMockFns.mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('deletes completed storage when cancellation overlaps presigning', async () => {
    mocks.complete.mockResolvedValue({ key: 'execution/key/report.csv', size: 0 })
    let finishPresign: ((value: string) => void) | undefined
    storageServiceMockFns.mockGeneratePresignedDownloadUrl.mockReturnValue(
      new Promise((resolve) => {
        finishPresign = resolve
      })
    )
    const controller = new AbortController()
    const pending = storeOracleEpmDownload({
      body: new ReadableStream({
        start(streamController) {
          streamController.close()
        },
      }),
      fileName: 'report.csv',
      context,
      maxBytes: 3,
      signal: controller.signal,
    })
    await flushMicrotasks(3)
    expect(storageServiceMockFns.mockGeneratePresignedDownloadUrl).toHaveBeenCalled()

    controller.abort(new DOMException('user', 'AbortError'))
    expect(storageServiceMockFns.mockDeleteFile).not.toHaveBeenCalled()
    finishPresign?.('https://storage.example/signed')

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(storageServiceMockFns.mockDeleteFile).toHaveBeenCalledTimes(1)
  })
})
