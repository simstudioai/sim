/** @vitest-environment node */
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  download: vi.fn(),
  create: vi.fn(),
  write: vi.fn(),
  complete: vi.fn(),
  abort: vi.fn(),
  remove: vi.fn(),
  sign: vi.fn(),
  key: vi.fn(),
  id: vi.fn(),
}))
vi.mock('@/app/api/files/authorization', () => ({ verifyFileAccess: mocks.access }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: mocks.download,
  createMultipartUpload: mocks.create,
  deleteFile: mocks.remove,
  generatePresignedDownloadUrl: mocks.sign,
}))
vi.mock('@/lib/uploads/contexts/execution/utils', () => ({
  generateFileId: mocks.id,
  generateUniqueExecutionFileKey: mocks.key,
}))

import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import {
  buildEdmMultipart,
  storeEdmFile,
} from '@/lib/internal/oracle-epm-enterprise-data-management/files'
import type { EdmOperationContext } from '@/lib/internal/oracle-epm-enterprise-data-management/types'

const id = '11111111-1111-4111-8111-111111111111'
const source = {
  id: 'file-1',
  name: 'changes.csv',
  url: '',
  size: 3,
  type: 'text/csv',
  key: 'workspace/test/changes.csv',
  context: 'workspace',
}
const context: EdmOperationContext = {
  client: createOracleEpmClient({ instanceUrl: 'https://edm.example.com', accessToken: 'dTpw' }),
  instanceUrl: 'https://edm.example.com',
  execution: { workflowId: id, workspaceId: id, executionId: id, userId: 'authorized-user' },
}

describe('EDM authorized file transfers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.access.mockResolvedValue(true)
    mocks.download.mockImplementation(async () => Readable.from([Buffer.from('abc')]))
    mocks.create.mockResolvedValue({
      write: mocks.write,
      complete: mocks.complete,
      abort: mocks.abort,
    })
    mocks.complete.mockResolvedValue({ key: 'execution/result.csv', size: 3 })
    mocks.key.mockReturnValue('execution/result.csv')
    mocks.id.mockReturnValue('result-file')
    mocks.sign.mockResolvedValue('https://storage.example.com/signed')
  })
  it('authorizes the canonical file before opening storage and encodes both multipart fields', async () => {
    const result = await buildEdmMultipart(source, 'account changes.csv', context)
    expect(mocks.access).toHaveBeenCalledWith(
      source.key,
      'authorized-user',
      undefined,
      'workspace',
      false
    )
    expect(mocks.access.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.download.mock.invocationCallOrder[0]
    )
    const request = new Request('https://edm.example.com', {
      method: 'POST',
      headers: { 'Content-Type': result.contentType },
      body: result.body as BodyInit,
    })
    const form = await request.formData()
    expect(form.get('fileName')).toBe('account changes.csv')
    const file = form.get('file')
    expect(file).toBeInstanceOf(File)
    expect(await (file as File).text()).toBe('abc')
    expect((file as File).type).toBe('text/csv')
    expect(result.body.byteLength).toBeLessThan(100 * 1024 * 1024)
  })
  it('rejects unauthorized files without reading storage', async () => {
    mocks.access.mockResolvedValue(false)
    await expect(buildEdmMultipart(source, undefined, context)).rejects.toThrow()
    expect(mocks.download).not.toHaveBeenCalled()
  })
  it('does not accept a caller file URL as upload authority', async () => {
    await expect(
      buildEdmMultipart(
        { ...source, key: undefined, url: 'https://other.example.com/secret' },
        undefined,
        context
      )
    ).rejects.toThrow()
    expect(mocks.download).not.toHaveBeenCalled()
  })
  it('rejects multiple input files instead of silently selecting the first', async () => {
    await expect(
      buildEdmMultipart([source, { ...source, id: 'file-2' }], undefined, context)
    ).rejects.toThrow()
    expect(mocks.access).not.toHaveBeenCalled()
  })
  it('rejects a declared source larger than 95 MiB before authorization or storage reads', async () => {
    await expect(
      buildEdmMultipart({ ...source, size: 95 * 1024 * 1024 + 1 }, undefined, context)
    ).rejects.toThrow()
    expect(mocks.access).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
  })
  it('counts observed bytes when the source metadata underreports its size', async () => {
    const chunk = Buffer.alloc(6 * 1024 * 1024)
    mocks.download.mockResolvedValue(
      Readable.from(
        (async function* () {
          for (let i = 0; i < 16; i++) yield chunk
        })()
      )
    )
    await expect(buildEdmMultipart(source, undefined, context)).rejects.toThrow()
  })
  it('sanitizes provider content types before constructing MIME headers', async () => {
    const result = await buildEdmMultipart(
      { ...source, type: 'text/csv\r\nX-Injected: yes' },
      undefined,
      context
    )
    expect(Buffer.from(result.body).toString()).toContain('Content-Type: application/octet-stream')
    expect(Buffer.from(result.body).toString()).not.toContain('X-Injected')
  })
  it('stores downloads under trusted execution context as a canonical UserFile', async () => {
    const result = await storeEdmFile(
      {
        status: 200,
        body: new Response('abc').body!,
        contentType: 'text/csv',
        contentLength: 3,
      },
      'account.csv',
      context
    )
    expect(mocks.key).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: id, workflowId: id, executionId: id }),
      'account.csv'
    )
    expect(result).toMatchObject({
      id: 'result-file',
      name: 'account.csv',
      size: 3,
      type: 'text/csv',
      key: 'execution/result.csv',
      context: 'execution',
    })
    expect(mocks.write).toHaveBeenCalled()
    expect(mocks.complete).toHaveBeenCalledTimes(1)
  })
  it('does not create a stored file without a trusted execution context', async () => {
    await expect(
      storeEdmFile(
        { status: 200, body: new Response('abc').body!, contentType: 'text/csv', contentLength: 3 },
        'account.csv',
        { ...context, execution: { workflowId: id, userId: 'authorized-user' } }
      )
    ).rejects.toThrow('trusted')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('rejects an oversized advertised download before creating storage', async () => {
    await expect(
      storeEdmFile(
        {
          status: 200,
          body: new Response('abc').body!,
          contentType: 'text/csv',
          contentLength: 95 * 1024 * 1024 + 1,
        },
        'account.csv',
        context
      )
    ).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
