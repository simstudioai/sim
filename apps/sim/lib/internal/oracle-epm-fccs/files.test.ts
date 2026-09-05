/** @vitest-environment node */
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserFile } from '@/executor/types'

const storage = vi.hoisted(() => ({
  authorize: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  write: vi.fn(),
  complete: vi.fn(),
  abort: vi.fn(),
  remove: vi.fn(),
  url: vi.fn(),
}))
vi.mock('@/app/api/files/authorization', () => ({ verifyFileAccess: storage.authorize }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: storage.read,
  createMultipartUpload: storage.create,
  deleteFile: storage.remove,
  generatePresignedDownloadUrl: storage.url,
}))
vi.mock('@/lib/uploads/contexts/execution/utils', () => ({
  generateFileId: () => 'file-1',
  generateUniqueExecutionFileKey: () => 'execution/report.csv',
}))

import type { FccsContext } from '@/lib/internal/oracle-epm-fccs/context'
import { FCCS_FILE_LIMIT, fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import {
  deleteFccsFile,
  downloadFccsFile,
  listFccsFiles,
  submitFccsConsolidationRulesets,
  uploadFccsFile,
} from '@/lib/internal/oracle-epm-fccs/files'

const execution = {
  userId: 'trusted-user',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  workflowId: '00000000-0000-4000-8000-000000000002',
  executionId: '00000000-0000-4000-8000-000000000003',
}
const source: UserFile = {
  id: 'source',
  name: 'original.csv',
  url: '',
  key: 'workspace/source.csv',
  context: 'workspace',
  size: 3,
  type: 'text/csv',
}
function context(request: ReturnType<typeof vi.fn>, signal?: AbortSignal): FccsContext {
  return { client: { request } as never, execution, signal }
}
function listing(size: string | null = '3', type = 'EXTERNAL') {
  return {
    status: 200,
    data: {
      status: 0,
      details: null,
      items: [{ name: 'inbox/report %20.csv', type, size, lastmodifiedtime: null }],
    },
  }
}
function stream(chunks: Uint8Array[], extra: object = {}) {
  return {
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(c) {
        for (const chunk of chunks) c.enqueue(chunk)
        c.close()
      },
    }),
    contentType: 'text/csv',
    ...extra,
  }
}
describe('FCCS file workflow through real foundation file primitives', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    storage.authorize.mockResolvedValue(true)
    storage.read.mockImplementation(async () => Readable.from([Buffer.from('abc')]))
    storage.create.mockResolvedValue({
      write: storage.write,
      complete: storage.complete,
      abort: storage.abort,
    })
    storage.write.mockResolvedValue(undefined)
    storage.complete.mockResolvedValue({ key: 'execution/report.csv', size: 3 })
    storage.abort.mockResolvedValue(undefined)
    storage.remove.mockResolvedValue(undefined)
    storage.url.mockResolvedValue('https://storage.example/signed')
  })
  it('authorizes uploads before bytes, preserves destination names, and submits binary once', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: { status: 0, details: null } })
    const result = await uploadFccsFile(context(request), source, 'report %20.csv', 'inbox')
    expect(storage.authorize).toHaveBeenCalledWith(
      'workspace/source.csv',
      'trusted-user',
      undefined,
      'workspace',
      false
    )
    expect(storage.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      storage.read.mock.invocationCallOrder[0]
    )
    expect(request).toHaveBeenCalledWith(
      fccsEndpoints.uploadFile,
      expect.objectContaining({
        pathParams: { fileName: 'report %20.csv' },
        query: { extDirPath: 'inbox' },
        stream: new Uint8Array([97, 98, 99]),
      })
    )
    expect(result).toEqual({ status: 0, details: null, fileName: 'inbox/report %20.csv' })
  })
  it('does not read or upload another user’s file', async () => {
    storage.authorize.mockResolvedValue(false)
    const request = vi.fn()
    await expect(uploadFccsFile(context(request), source, 'report.csv')).rejects.toThrow(
      'not found'
    )
    expect(storage.read).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })
  it('rejects known oversized upload and oversized actual bytes before provider submission', async () => {
    const request = vi.fn()
    await expect(
      uploadFccsFile(context(request), { ...source, size: FCCS_FILE_LIMIT + 1 }, 'report.csv')
    ).rejects.toThrow('maximum size')
    expect(storage.read).not.toHaveBeenCalled()
    const chunk = Buffer.alloc(1024 * 1024)
    storage.read.mockResolvedValue(Readable.from([...Array(100).fill(chunk), Buffer.from('x')]))
    await expect(
      uploadFccsFile(context(request), { ...source, size: 0 }, 'report.csv')
    ).rejects.toThrow('maximum size')
    expect(request).not.toHaveBeenCalled()
  })
  it('accepts the exact 100 MiB upload boundary', async () => {
    const chunk = Buffer.alloc(1024 * 1024)
    storage.read.mockResolvedValue(Readable.from(Array(100).fill(chunk)))
    const request = vi.fn().mockImplementation(async (_endpoint, input) => {
      expect(input.stream.byteLength).toBe(FCCS_FILE_LIMIT)
      expect(input.stream.buffer.byteLength).toBe(FCCS_FILE_LIMIT)
      return { status: 200, data: { status: 0, details: null } }
    })
    await expect(
      uploadFccsFile(context(request), { ...source, size: FCCS_FILE_LIMIT }, 'report.csv')
    ).resolves.toMatchObject({ status: 0 })
  })
  it.each([0, 2, 8])('uploads actual multi-chunk bytes when metadata size is %s', async (size) => {
    storage.read.mockResolvedValue(Readable.from([Buffer.from('ab'), Buffer.from('cd')]))
    const request = vi.fn().mockImplementation(async (_endpoint, input) => {
      expect([...input.stream]).toEqual([97, 98, 99, 100])
      return { status: 200, data: { status: 0 } }
    })
    await expect(
      uploadFccsFile(context(request), { ...source, size }, 'report.csv')
    ).resolves.toMatchObject({ status: 0 })
  })
  it.each(['download', 'delete'] as const)(
    'allows manual %s beyond the picker inventory count without admitting LCM snapshots',
    async (action) => {
      const inventory = listing()
      inventory.data.items.unshift(
        ...Array.from({ length: 10_000 }, (_, index) => ({
          name: `snapshot-${index}`,
          type: 'LCM',
          size: null,
          lastmodifiedtime: null,
        }))
      )
      const request = vi
        .fn()
        .mockResolvedValueOnce(inventory)
        .mockResolvedValueOnce(
          action === 'download'
            ? stream([new Uint8Array([1, 2, 3])])
            : { status: 200, data: { status: 0 } }
        )
      const operation = action === 'download' ? downloadFccsFile : deleteFccsFile
      await expect(operation(context(request), 'inbox/report %20.csv')).resolves.toMatchObject({
        fileName: 'inbox/report %20.csv',
      })
      expect(request).toHaveBeenCalledTimes(2)
      request.mockReset().mockResolvedValue(inventory)
      await expect(operation(context(request), 'snapshot-9999')).rejects.toThrow(
        'LCM snapshots are not supported'
      )
      expect(request).toHaveBeenCalledTimes(1)
      await expect(listFccsFiles(context(request))).rejects.toThrow('malformed response')
    }
  )
  it.each([
    ['folder/report.csv', undefined],
    ['report.csv', 'inbox/../outbox'],
    ['report.csv', 'other'],
  ])('rejects invalid upload destination %s %s', async (fileName, directory) => {
    await expect(uploadFccsFile(context(vi.fn()), source, fileName!, directory)).rejects.toThrow(
      'FCCS upload'
    )
    expect(storage.authorize).not.toHaveBeenCalled()
  })
  it('does not claim an asynchronous LCM extraction is a completed file upload', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: { status: -1, details: null } })
    await expect(uploadFccsFile(context(request), source, 'snapshot.zip')).rejects.toThrow(
      'did not complete'
    )
  })
  it.each([undefined, 1, 3])(
    'stores actual binary bytes with content length %s',
    async (contentLength) => {
      const request = vi
        .fn()
        .mockResolvedValueOnce(listing(null))
        .mockResolvedValueOnce(stream([new Uint8Array([0, 255, 4])], { contentLength }))
      const result = await downloadFccsFile(context(request), 'inbox/report %20.csv')
      expect(result).toMatchObject({
        fileName: 'inbox/report %20.csv',
        file: {
          id: 'file-1',
          size: 3,
          context: 'execution',
          url: 'https://storage.example/signed',
        },
      })
      expect(storage.write).toHaveBeenCalledWith(Buffer.from([0, 255, 4]))
      expect(storage.url).toHaveBeenCalledWith('execution/report.csv', 'execution', 300)
      expect(storage.abort).not.toHaveBeenCalled()
    }
  )
  it('rejects known oversized exports without downloading, preserving completion uncertainty', async () => {
    const request = vi.fn().mockResolvedValue(listing(String(FCCS_FILE_LIMIT + 1)))
    await expect(downloadFccsFile(context(request), 'inbox/report %20.csv')).rejects.toThrow(
      'export may have completed'
    )
    expect(request).toHaveBeenCalledTimes(1)
    expect(storage.create).not.toHaveBeenCalled()
  })
  it('rejects a misleading oversized response header before creating partial storage', async () => {
    const response = stream([], { contentLength: FCCS_FILE_LIMIT + 1 })
    const cancel = vi.spyOn(response.body, 'cancel')
    const request = vi.fn().mockResolvedValueOnce(listing(null)).mockResolvedValueOnce(response)
    await expect(downloadFccsFile(context(request), 'inbox/report %20.csv')).rejects.toThrow(
      'maximum size'
    )
    expect(storage.create).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()
  })
  it('counts actual bytes despite a small header, aborting partial storage on overflow', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    const request = vi
      .fn()
      .mockResolvedValueOnce(listing('1'))
      .mockResolvedValueOnce(
        stream([...Array(100).fill(chunk), new Uint8Array([1])], { contentLength: 1 })
      )
    await expect(downloadFccsFile(context(request), 'inbox/report %20.csv')).rejects.toThrow(
      'maximum size'
    )
    expect(storage.write).toHaveBeenCalledTimes(100)
    expect(storage.abort).toHaveBeenCalledTimes(1)
    expect(storage.complete).not.toHaveBeenCalled()
  })
  it.each(['application/json', 'Application/JSON; charset=utf-8', 'application/problem+json'])(
    'does not store Oracle JSON errors as files (%s)',
    async (contentType) => {
      const response = stream([new TextEncoder().encode('{"details":"secret"}')], { contentType })
      const cancel = vi.spyOn(response.body, 'cancel')
      const request = vi.fn().mockResolvedValueOnce(listing()).mockResolvedValueOnce(response)
      await expect(downloadFccsFile(context(request), 'inbox/report %20.csv')).rejects.toThrow(
        'JSON error'
      )
      expect(cancel).toHaveBeenCalled()
      expect(storage.create).not.toHaveBeenCalled()
    }
  )
  it('cancels partial download storage and cleans up a completed file if signing fails', async () => {
    const controller = new AbortController()
    storage.write.mockImplementation(async () =>
      controller.abort(new DOMException('stopped', 'AbortError'))
    )
    const request = vi
      .fn()
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(stream([new Uint8Array([1, 2, 3])]))
    await expect(
      downloadFccsFile(context(request, controller.signal), 'inbox/report %20.csv')
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(storage.abort).toHaveBeenCalledTimes(1)
    storage.write.mockResolvedValue(undefined)
    storage.url.mockRejectedValue(new Error('signing failed'))
    request
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce(stream([new Uint8Array([1, 2, 3])]))
    await expect(downloadFccsFile(context(request), 'inbox/report %20.csv')).rejects.toThrow(
      'signing failed'
    )
    expect(storage.remove).toHaveBeenCalledWith({
      key: 'execution/report.csv',
      context: 'execution',
    })
  })
  it('rejects upload cancellation without a provider submission', async () => {
    const controller = new AbortController()
    storage.read.mockImplementation(async () => {
      controller.abort(new DOMException('stopped', 'AbortError'))
      return Readable.from([Buffer.from('abc')])
    })
    const request = vi.fn()
    await expect(
      uploadFccsFile(context(request, controller.signal), source, 'report.csv')
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).not.toHaveBeenCalled()
  })
  it('deletes only external files while preserving raw repository path syntax', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(listing())
      .mockResolvedValueOnce({ data: { status: 0, details: null }, status: 200 })
    await deleteFccsFile(context(request), 'inbox\\report %20.csv')
    expect(request.mock.calls[1][1].json).toEqual({ fileName: 'inbox\\report %20.csv' })
    request.mockReset().mockResolvedValue(listing(null, 'LCM'))
    await expect(deleteFccsFile(context(request), 'inbox/report %20.csv')).rejects.toThrow(
      'LCM snapshots'
    )
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('requires exactly the documented ruleset text acknowledgment without fabricating status/job ID', async () => {
    const message = 'Job is submitted. See the job console for more information.'
    const request = vi.fn().mockResolvedValue(stream([new TextEncoder().encode(message)]))
    expect(
      await submitFccsConsolidationRulesets(context(request), 'export', 'Close', {
        rules: ['Tenant rules'],
      })
    ).toEqual({ submitted: true, message })
    request.mockResolvedValue(stream([new TextEncoder().encode('{"status":0,"jobId":42}')]))
    await expect(
      submitFccsConsolidationRulesets(context(request), 'import', 'Close', {
        file: 'inbox/rules.xml',
      })
    ).rejects.toThrow('documented')
  })
})
