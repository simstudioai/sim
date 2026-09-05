/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetch, mockValidateUrl } = vi.hoisted(() => ({
  mockSecureFetch: vi.fn(),
  mockValidateUrl: vi.fn(),
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mockSecureFetch,
  validateUrlWithDNS: mockValidateUrl,
}))

import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'

const auth = {
  oauthCredential: 'service-account-id',
  instanceUrl: 'https://epm.example.com/gateway',
  accessToken: Buffer.from('operator:credential').toString('base64'),
}
const client = createOracleEpmClient(auth)
const context = { client }
beforeEach(() => {
  vi.clearAllMocks()
  mockValidateUrl.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
  mockSecureFetch.mockImplementation(async () => Response.json({ status: 0 }))
})

import { Readable } from 'node:stream'
import { afterEach } from 'vitest'
import {
  downloadRepositoryFile,
  uploadRepositoryFile,
  uploadSnapshot,
  verifiedChunks,
} from '@/lib/internal/oracle-epm-platform/files.server'
import {
  DOWNLOAD_FILE_LIMIT,
  REPOSITORY_FILE_LIMIT,
  SNAPSHOT_CHUNK_LIMIT,
  SNAPSHOT_FILE_LIMIT,
} from '@/lib/internal/oracle-epm-platform/routes'
import type { UserFile } from '@/executor/types'

const storage = vi.hoisted(() => ({
  verifyFileAccess: vi.fn(),
  downloadFileStream: vi.fn(),
  createMultipartUpload: vi.fn(),
  write: vi.fn(),
  complete: vi.fn(),
  abort: vi.fn(),
  deleteFile: vi.fn(),
  generatePresignedDownloadUrl: vi.fn(),
  generateFileId: vi.fn(),
  generateUniqueExecutionFileKey: vi.fn(),
}))
vi.mock('@/app/api/files/authorization', () => ({ verifyFileAccess: storage.verifyFileAccess }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFileStream: storage.downloadFileStream,
  createMultipartUpload: storage.createMultipartUpload,
  deleteFile: storage.deleteFile,
  generatePresignedDownloadUrl: storage.generatePresignedDownloadUrl,
}))
vi.mock('@/lib/uploads/contexts/execution/utils', () => ({
  generateFileId: storage.generateFileId,
  generateUniqueExecutionFileKey: storage.generateUniqueExecutionFileKey,
}))

const file: UserFile = {
  id: 'source',
  name: 'snapshot.zip',
  size: 3,
  type: 'application/zip',
  url: '',
  key: 'workspace/source.zip',
  context: 'workspace',
}
const fileContext = {
  client,
  execution: {
    userId: 'user-1',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    workflowId: '00000000-0000-4000-8000-000000000002',
    executionId: '00000000-0000-4000-8000-000000000003',
  },
}
let storedBytes = 0
beforeEach(() => {
  storedBytes = 0
  storage.verifyFileAccess.mockResolvedValue(true)
  storage.downloadFileStream.mockImplementation(async () => Readable.from([Buffer.from('abc')]))
  storage.createMultipartUpload.mockResolvedValue({
    write: storage.write,
    complete: storage.complete,
    abort: storage.abort,
  })
  storage.write.mockImplementation(async (bytes: Buffer) => {
    storedBytes += bytes.length
  })
  storage.complete.mockImplementation(async () => ({
    key: 'execution/result.zip',
    size: storedBytes,
  }))
  storage.abort.mockResolvedValue(undefined)
  storage.deleteFile.mockResolvedValue(undefined)
  storage.generatePresignedDownloadUrl.mockResolvedValue('https://storage.example/result')
  storage.generateFileId.mockReturnValue('result')
  storage.generateUniqueExecutionFileKey.mockReturnValue('execution/result.zip')
})
afterEach(() => vi.useRealTimers())

function snapshotInput(size = 3) {
  return { ...auth, file: { ...file, size }, snapshotName: 'New Snapshot.zip' }
}
function downloadResponse(total: number, headers: Record<string, string> = {}) {
  let remaining = total
  const block = new Uint8Array(1024 * 1024)
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!remaining) return controller.close()
        const count = Math.min(remaining, block.length)
        controller.enqueue(block.subarray(0, count))
        remaining -= count
      },
    }),
    { headers: { 'content-type': 'application/zip', ...headers } }
  )
}
function setDownload(
  input: {
    type?: 'LCM' | 'EXTERNAL'
    listedSize?: string | null
    response?: () => Response
    cleanupFails?: boolean
    pending?: boolean
  } = {}
) {
  mockSecureFetch.mockImplementation(
    async (url: string, _ip: string, options: { method: string }) => {
      const path = new URL(url).pathname
      if (path.endsWith('/files/list'))
        return Response.json({
          status: 0,
          items: [
            {
              name: 'Artifact Snapshot',
              type: input.type ?? 'LCM',
              size: input.listedSize ?? null,
              lastmodifiedtime: null,
            },
          ],
        })
      if (options.method === 'DELETE') return Response.json({ status: input.cleanupFails ? 1 : 0 })
      if (options.method === 'POST' && input.pending)
        return Response.json({
          status: -1,
          links: [
            {
              rel: 'Job Status',
              action: 'GET',
              href: 'https://epm.example.com/gateway/interop/rest/v2/status/download/21',
            },
          ],
        })
      if (options.method === 'POST' || path.includes('/status/download/'))
        return Response.json({
          status: 0,
          links: [
            {
              rel: 'Download link',
              action: 'GET',
              href: 'https://epm.example.com/gateway/interop/rest/v2/files/download/21',
            },
          ],
        })
      return input.response?.() ?? downloadResponse(3)
    }
  )
}
const downloadInput = { ...auth, fileName: 'Artifact Snapshot' }

describe('Oracle EPM source files and chunked uploads', () => {
  it('re-chunks across source boundaries with a final partial chunk and exact byte count', async () => {
    async function* source() {
      yield Buffer.from('ab')
      yield Buffer.from('cdef')
      yield Buffer.from('g')
    }
    const chunks: string[] = []
    for await (const chunk of verifiedChunks(source(), 7, 3)) chunks.push(chunk.toString())
    expect(chunks).toEqual(['abc', 'def', 'g'])
  })

  it.each([2, 4])('rejects actual bytes that differ from declared size %s', async (size) => {
    async function* source() {
      yield Buffer.from('abc')
    }
    await expect(async () => {
      for await (const _chunk of verifiedChunks(source(), size, 2)) {
        /* consume */
      }
    }).rejects.toThrow(/declared file size/)
  })

  it('authorizes the source before reading bytes or starting a provider upload', async () => {
    storage.verifyFileAccess.mockResolvedValue(false)
    await expect(uploadSnapshot(snapshotInput(), fileContext)).rejects.toThrow('not found')
    expect(storage.downloadFileStream).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['repository', REPOSITORY_FILE_LIMIT + 1],
    ['snapshot', SNAPSHOT_FILE_LIMIT + 1],
  ])('rejects over-limit %s source metadata before authorization or bytes', async (kind, size) => {
    const result =
      kind === 'repository'
        ? uploadRepositoryFile(
            { ...auth, file: { ...file, size: Number(size) }, fileName: 'data.zip' },
            fileContext
          )
        : uploadSnapshot(snapshotInput(Number(size)), fileContext)
    await expect(result).rejects.toThrow(/100 MiB|5 GiB/)
    expect(storage.verifyFileAccess).not.toHaveBeenCalled()
    expect(storage.downloadFileStream).not.toHaveBeenCalled()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('accepts 5 GiB source metadata without buffering or reading it before initialization', async () => {
    mockSecureFetch.mockImplementation(async () => {
      expect(storage.verifyFileAccess).toHaveBeenCalled()
      expect(storage.downloadFileStream).not.toHaveBeenCalled()
      return Response.json({ status: 9 })
    })
    await expect(uploadSnapshot(snapshotInput(SNAPSHOT_FILE_LIMIT), fileContext)).rejects.toThrow(
      'status 9'
    )
    expect(mockSecureFetch.mock.calls.map(([, , options]) => options.method)).toEqual(['POST'])
  })

  it('uploads a repository path as one encoded parameter, with verified binary bytes', async () => {
    const result = await uploadRepositoryFile(
      { ...auth, file, fileName: 'folder/report final.csv', directory: 'inbox' },
      fileContext
    )
    expect(result).toMatchObject({
      status: 0,
      fileName: 'folder/report final.csv',
      bytesUploaded: 3,
      completed: true,
    })
    expect(mockSecureFetch.mock.calls[0][0]).toBe(
      'https://epm.example.com/gateway/interop/rest/11.1.2.3.600/applicationsnapshots/folder%2Freport%20final.csv/contents?extDirPath=inbox'
    )
    expect(mockSecureFetch.mock.calls[0][2]).toMatchObject({
      method: 'POST',
      body: Buffer.from('abc'),
    })
  })

  it('rejects repository size mismatch before sending a mutation', async () => {
    await expect(
      uploadRepositoryFile(
        { ...auth, file: { ...file, size: 4 }, fileName: 'data.csv' },
        fileContext
      )
    ).rejects.toThrow('declared file size')
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('uses inclusive contiguous ranges, one-based chunk numbers, and empty init/finalize control bodies', async () => {
    const size = SNAPSHOT_CHUNK_LIMIT + 3
    storage.downloadFileStream.mockImplementation(async () =>
      Readable.from([Buffer.alloc(SNAPSHOT_CHUNK_LIMIT), Buffer.from('end')])
    )
    mockSecureFetch.mockImplementation(async (url: string) => {
      const q = JSON.parse(new URL(url).searchParams.get('q') ?? '{}')
      return Response.json(
        q.isLast
          ? {
              status: -1,
              links: [
                {
                  rel: 'Job Status',
                  action: 'GET',
                  href: 'https://epm.example.com/gateway/interop/rest/v1/services/jobs/51',
                },
              ],
            }
          : { status: 0 }
      )
    })
    const result = await uploadSnapshot(snapshotInput(size), fileContext)
    expect(result).toMatchObject({
      bytesUploaded: size,
      status: -1,
      jobKind: 'snapshot_upload',
      jobId: '51',
      completed: false,
    })
    const sent = mockSecureFetch.mock.calls.map(([url, , options]) => ({
      q: JSON.parse(new URL(url).searchParams.get('q') ?? '{}'),
      length: options.body.length,
      method: options.method,
    }))
    expect(sent).toEqual([
      {
        q: { isFirst: true, chunkSize: 14, fileSize: String(size), isLast: false },
        length: 0,
        method: 'POST',
      },
      {
        q: {
          startRange: '0',
          endRange: String(SNAPSHOT_CHUNK_LIMIT - 1),
          isFirst: false,
          isLast: false,
          fileSize: String(size),
          chunkSize: SNAPSHOT_CHUNK_LIMIT,
          chunkNo: 1,
        },
        length: SNAPSHOT_CHUNK_LIMIT,
        method: 'POST',
      },
      {
        q: {
          startRange: String(SNAPSHOT_CHUNK_LIMIT),
          endRange: String(size - 1),
          isFirst: false,
          isLast: false,
          fileSize: String(size),
          chunkSize: 3,
          chunkNo: 2,
        },
        length: 3,
        method: 'POST',
      },
      {
        q: { isFirst: false, chunkSize: 14, fileSize: String(size), isLast: true },
        length: 0,
        method: 'POST',
      },
    ])
  })

  it('does not read the next chunk before the preceding upload completes', async () => {
    const events: string[] = []
    storage.downloadFileStream.mockImplementation(async () =>
      Readable.from(
        (async function* () {
          events.push('read first')
          yield Buffer.alloc(SNAPSHOT_CHUNK_LIMIT)
          events.push('read last')
          yield Buffer.from('x')
        })(),
        { highWaterMark: 1 }
      )
    )
    mockSecureFetch.mockImplementation(async (url: string) => {
      const q = JSON.parse(new URL(url).searchParams.get('q') ?? '{}')
      if (q.chunkNo) events.push(`sent ${q.chunkNo}`)
      return Response.json({ status: 0 })
    })
    await uploadSnapshot(snapshotInput(SNAPSHOT_CHUNK_LIMIT + 1), fileContext)
    // The storage stream may prefetch one chunk; provider requests still complete in sequence.
    expect(events.filter((event) => event.startsWith('sent'))).toEqual(['sent 1', 'sent 2'])
  })

  it.each(['conflict', 'network'])(
    'never deletes a pre-existing snapshot after an initialization %s',
    async (failure) => {
      mockSecureFetch.mockImplementation(async () => {
        if (failure === 'network') throw new Error('ambiguous init')
        return Response.json({ status: 9 })
      })
      await expect(uploadSnapshot(snapshotInput(), fileContext)).rejects.toThrow()
      expect(mockSecureFetch.mock.calls.map(([, , options]) => options.method)).toEqual(['POST'])
      expect(storage.downloadFileStream).not.toHaveBeenCalled()
    }
  )

  it('cleans up only the initialized upload after a source-size mismatch', async () => {
    await expect(uploadSnapshot(snapshotInput(4), fileContext)).rejects.toThrow(
      'declared file size'
    )
    expect(
      mockSecureFetch.mock.calls.map(([url, , options]) => [new URL(url).pathname, options.method])
    ).toEqual([
      ['/gateway/interop/rest/v1/applicationsnapshots/New%20Snapshot.zip/contents', 'POST'],
      ['/gateway/interop/rest/v3/files/delete', 'POST'],
    ])
    expect(mockSecureFetch.mock.calls[1][2].body).toBe('{"fileName":"New Snapshot.zip"}')
  })

  it('retains a snapshot when finalization may already have started', async () => {
    mockSecureFetch.mockImplementation(async (url: string) => {
      if (JSON.parse(new URL(url).searchParams.get('q') ?? '{}').isLast)
        throw new Error('uncertain finalize')
      return Response.json({ status: 0 })
    })
    await expect(uploadSnapshot(snapshotInput(), fileContext)).rejects.toThrow()
    expect(
      mockSecureFetch.mock.calls.every(([url]) => !String(url).includes('/files/delete'))
    ).toBe(true)
  })

  it('cancels an interrupted source and uses a separate bounded signal for owned cleanup', async () => {
    const controller = new AbortController()
    storage.downloadFileStream.mockImplementation(async () =>
      Readable.from(
        (async function* () {
          yield Buffer.from('a')
          controller.abort(new DOMException('Cancelled', 'AbortError'))
        })()
      )
    )
    await expect(
      uploadSnapshot(snapshotInput(), { ...fileContext, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    const cleanup = mockSecureFetch.mock.calls.find(([url]) =>
      String(url).endsWith('/files/delete')
    )
    expect(cleanup?.[2].signal.aborted).toBe(false)
  })
})

describe('Oracle EPM v2 streamed downloads', () => {
  it('initiates, checks status, downloads bytes, and deletes only the owned temporary snapshot download', async () => {
    setDownload({ pending: true })
    expect(await downloadRepositoryFile(downloadInput, fileContext)).toMatchObject({
      status: 0,
      cleanupComplete: true,
      file: {
        name: 'Artifact-Snapshot.zip',
        size: 3,
        context: 'execution',
        key: 'execution/result.zip',
      },
    })
    expect(
      mockSecureFetch.mock.calls.map(([url, , options]) => [new URL(url).pathname, options.method])
    ).toEqual([
      ['/gateway/interop/rest/v2/files/list', 'GET'],
      ['/gateway/interop/rest/v2/files/download', 'POST'],
      ['/gateway/interop/rest/v2/status/download/21', 'GET'],
      ['/gateway/interop/rest/v2/files/download/21', 'GET'],
      ['/gateway/interop/rest/v2/files/download/21', 'DELETE'],
    ])
  })

  it('does not delete an ordinary external repository file after download', async () => {
    setDownload({ type: 'EXTERNAL' })
    await downloadRepositoryFile(downloadInput, fileContext)
    expect(mockSecureFetch.mock.calls.some(([, , options]) => options.method === 'DELETE')).toBe(
      false
    )
  })

  it('rejects an oversized listed file before initiating download', async () => {
    setDownload({ listedSize: String(DOWNLOAD_FILE_LIMIT + 1) })
    await expect(downloadRepositoryFile(downloadInput, fileContext)).rejects.toThrow('100 MiB')
    expect(mockSecureFetch.mock.calls.map(([, , options]) => options.method)).toEqual(['GET'])
    expect(storage.createMultipartUpload).not.toHaveBeenCalled()
  })

  it('accepts exactly 100 MiB with no declared content length', async () => {
    setDownload({ response: () => downloadResponse(DOWNLOAD_FILE_LIMIT) })
    expect(await downloadRepositoryFile(downloadInput, fileContext)).toMatchObject({
      file: { size: DOWNLOAD_FILE_LIMIT },
      cleanupComplete: true,
    })
    expect(storedBytes).toBe(DOWNLOAD_FILE_LIMIT)
  })

  it.each([undefined, '1'])(
    'enforces actual bytes with missing or understated content length %s',
    async (length) => {
      setDownload({
        response: () =>
          downloadResponse(DOWNLOAD_FILE_LIMIT + 1, length ? { 'content-length': length } : {}),
      })
      await expect(downloadRepositoryFile(downloadInput, fileContext)).rejects.toThrow('100 MiB')
      expect(storage.abort).toHaveBeenCalled()
      expect(storage.complete).not.toHaveBeenCalled()
      expect(mockSecureFetch.mock.calls.some(([, , options]) => options.method === 'DELETE')).toBe(
        true
      )
    }
  )

  it('rejects oversized declared content length and still cleans the owned download', async () => {
    setDownload({
      response: () => downloadResponse(3, { 'content-length': String(DOWNLOAD_FILE_LIMIT + 1) }),
    })
    await expect(downloadRepositoryFile(downloadInput, fileContext)).rejects.toThrow('100 MiB')
    expect(storage.createMultipartUpload).not.toHaveBeenCalled()
    expect(mockSecureFetch.mock.calls.some(([, , options]) => options.method === 'DELETE')).toBe(
      true
    )
  })

  it('rejects JSON error responses instead of storing them as files', async () => {
    setDownload({ response: () => Response.json({ status: 1, details: 'provider error' }) })
    await expect(downloadRepositoryFile(downloadInput, fileContext)).rejects.toThrow('JSON error')
    expect(storage.createMultipartUpload).not.toHaveBeenCalled()
    expect(mockSecureFetch.mock.calls.some(([, , options]) => options.method === 'DELETE')).toBe(
      true
    )
  })

  it('preserves a completed file but clearly reports temporary cleanup failure', async () => {
    setDownload({ cleanupFails: true })
    expect(await downloadRepositoryFile(downloadInput, fileContext)).toMatchObject({
      status: 0,
      cleanupComplete: false,
      message: expect.stringContaining('cleanup failed'),
      file: { size: 3 },
    })
  })

  it('aborts partial local storage and cleans the owned remote download on cancellation', async () => {
    const controller = new AbortController()
    setDownload()
    storage.write.mockImplementation(async () =>
      controller.abort(new DOMException('Cancelled', 'AbortError'))
    )
    await expect(
      downloadRepositoryFile(downloadInput, { ...fileContext, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(storage.abort).toHaveBeenCalled()
    expect(storage.complete).not.toHaveBeenCalled()
    expect(mockSecureFetch.mock.calls.some(([, , options]) => options.method === 'DELETE')).toBe(
      true
    )
  })
})
