/**
 * @vitest-environment node
 */
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { testUploadDirectory, mockS3Presign, mockS3PartUrls } = vi.hoisted(() => ({
  testUploadDirectory: `/tmp/sim-upload-session-provider-${process.pid}`,
  mockS3Presign: vi.fn(),
  mockS3PartUrls: vi.fn(),
}))

vi.mock('@/lib/uploads/core/setup.server', () => ({
  UPLOAD_DIR_SERVER: testUploadDirectory,
}))

vi.mock('@/lib/uploads/config', () => ({
  USE_BLOB_STORAGE: false,
  USE_GCS_STORAGE: false,
  USE_S3_STORAGE: false,
  getStorageConfig: vi.fn(() => ({ bucket: 'test-bucket', region: 'us-east-1' })),
}))

vi.mock('@/lib/uploads/providers/s3/client', () => ({
  getS3PresignedUploadUrl: mockS3Presign,
  getS3MultipartPartUrls: mockS3PartUrls,
}))

import {
  completeMultipartProviderUpload,
  createPutProviderTransfer,
  getMultipartProviderPartUrls,
  headProviderObject,
  LocalUploadBodyError,
  listMultipartProviderParts,
  UPLOAD_URL_TTL_MS,
  writeLocalMultipartPart,
  writeLocalPutObject,
} from '@/lib/uploads/upload-session/provider'

const CONTEXT = 'workspace' as const
const METADATA = {
  uploadId: 'upload-1',
  userId: 'user-1',
  originalName: 'file.bin',
  purpose: 'workspace_file',
  workspaceId: 'workspace-1',
}

describe('local upload-session provider', () => {
  beforeEach(async () => {
    await rm(testUploadDirectory, { recursive: true, force: true })
    await mkdir(testUploadDirectory, { recursive: true })
  })

  it('streams an exact-size PUT and persists its object identity', async () => {
    await writeLocalPutObject({
      uploadId: 'upload-1',
      key: 'workspace/workspace-1/file.bin',
      body: byteStream('ab', 'cd'),
      expectedSize: 4,
      contentType: 'application/octet-stream',
      metadata: METADATA,
    })

    await expect(readFile(localPath('workspace/workspace-1/file.bin'), 'utf8')).resolves.toBe(
      'abcd'
    )
    await expect(
      headProviderObject({
        provider: 'local',
        key: 'workspace/workspace-1/file.bin',
        context: CONTEXT,
      })
    ).resolves.toMatchObject({
      size: 4,
      contentType: 'application/octet-stream',
      uploadId: 'upload-1',
      version: expect.any(String),
    })
    expect(await temporaryFiles('workspace/workspace-1')).toEqual([])
  })

  it('persists an empty PUT object with its identity metadata', async () => {
    await writeLocalPutObject({
      uploadId: 'upload-1',
      key: 'workspace/workspace-1/empty.md',
      body: byteStream(),
      expectedSize: 0,
      contentType: 'text/markdown',
      metadata: METADATA,
    })

    await expect(stat(localPath('workspace/workspace-1/empty.md'))).resolves.toMatchObject({
      size: 0,
    })
    await expect(
      headProviderObject({
        provider: 'local',
        key: 'workspace/workspace-1/empty.md',
        context: CONTEXT,
      })
    ).resolves.toMatchObject({
      size: 0,
      contentType: 'text/markdown',
      uploadId: 'upload-1',
      version: expect.any(String),
    })
  })

  it('does not let a replayed PUT overwrite the final object', async () => {
    const params = {
      uploadId: 'upload-1',
      key: 'workspace/workspace-1/file.bin',
      expectedSize: 3,
      contentType: 'application/octet-stream',
      metadata: METADATA,
    }
    await writeLocalPutObject({ ...params, body: byteStream('one') })

    await expect(writeLocalPutObject({ ...params, body: byteStream('two') })).rejects.toThrow()
    await expect(readFile(localPath(params.key), 'utf8')).resolves.toBe('one')
  })

  it.each([
    { name: 'short', chunks: ['ab'], expectedSize: 3 },
    { name: 'oversized', chunks: ['ab', 'cd'], expectedSize: 3 },
  ])('rejects a $name PUT and removes its temporary files', async ({ chunks, expectedSize }) => {
    await expect(
      writeLocalPutObject({
        uploadId: 'upload-1',
        key: 'workspace/workspace-1/file.bin',
        body: byteStream(...chunks),
        expectedSize,
        contentType: 'application/octet-stream',
        metadata: METADATA,
      })
    ).rejects.toBeInstanceOf(LocalUploadBodyError)

    await expect(
      headProviderObject({
        provider: 'local',
        key: 'workspace/workspace-1/file.bin',
        context: CONTEXT,
      })
    ).resolves.toBeNull()
    expect(await temporaryFiles('workspace/workspace-1')).toEqual([])
  })

  it('publishes a multipart part atomically after exact-size validation', async () => {
    await writeLocalMultipartPart({
      uploadId: 'upload-1',
      partNumber: 1,
      body: byteStream('abc'),
      expectedSize: 3,
    })

    await expect(readFile(localPath('.multipart/upload-1/1.part'), 'utf8')).resolves.toBe('abc')

    await expect(
      writeLocalMultipartPart({
        uploadId: 'upload-1',
        partNumber: 1,
        body: byteStream('x'),
        expectedSize: 3,
      })
    ).rejects.toBeInstanceOf(LocalUploadBodyError)

    await expect(readFile(localPath('.multipart/upload-1/1.part'), 'utf8')).resolves.toBe('abc')
    expect(await temporaryFiles('.multipart/upload-1')).toEqual([])
  })

  it('discovers local parts and assembles them directly at the final key', async () => {
    await writeLocalMultipartPart({
      uploadId: 'upload-1',
      partNumber: 1,
      body: byteStream('abc'),
      expectedSize: 3,
    })
    await writeLocalMultipartPart({
      uploadId: 'upload-1',
      partNumber: 2,
      body: byteStream('de'),
      expectedSize: 2,
    })

    const parts = await listMultipartProviderParts({
      provider: 'local',
      providerUploadId: null,
      uploadId: 'upload-1',
      key: 'workspace/workspace-1/file.bin',
      context: CONTEXT,
    })
    expect(parts).toEqual([
      { partNumber: 1, size: 3 },
      { partNumber: 2, size: 2 },
    ])

    await completeMultipartProviderUpload({
      provider: 'local',
      providerUploadId: null,
      uploadId: 'upload-1',
      key: 'workspace/workspace-1/file.bin',
      contentType: 'application/octet-stream',
      context: CONTEXT,
      parts,
      metadata: METADATA,
    })

    await expect(readFile(localPath('workspace/workspace-1/file.bin'), 'utf8')).resolves.toBe(
      'abcde'
    )
    await expect(stat(localPath('.multipart/upload-1'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

/** Mirrors `UPLOAD_SESSION_TTL_MS`, imported here as a literal so this suite
 * does not pull the upload-session service's database and billing graph. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

describe('signed transfer URL lifetimes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    mockS3Presign.mockResolvedValue({ url: 'https://s3.example/put', headers: {} })
    mockS3PartUrls.mockImplementation(
      async (_key: string, _uploadId: string, partNumbers: number[]) =>
        partNumbers.map((partNumber) => ({ partNumber, url: `https://s3.example/${partNumber}` }))
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('signs a whole-object PUT for the bounded URL lifetime, not the session TTL', async () => {
    await createPutProviderTransfer({
      provider: 's3',
      key: 'workspace/workspace-1/file.bin',
      contentType: 'application/octet-stream',
      fileSize: 4,
      context: CONTEXT,
      uploadId: 'upload-1',
      uploadToken: 'token-1',
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      metadata: METADATA,
    })

    expect(UPLOAD_URL_TTL_MS).toBeLessThan(SESSION_TTL_MS)
    expect(mockS3Presign).toHaveBeenCalledTimes(1)
    expect(mockS3Presign.mock.calls[0][0]).toMatchObject({
      expiresIn: UPLOAD_URL_TTL_MS / 1000,
    })
  })

  it('advertises the clamped URL expiry on the transfer, not the session TTL', async () => {
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS)

    const transfer = await createPutProviderTransfer({
      provider: 's3',
      key: 'workspace/workspace-1/file.bin',
      contentType: 'application/octet-stream',
      fileSize: 4,
      context: CONTEXT,
      uploadId: 'upload-1',
      uploadToken: 'token-1',
      expiresAt: sessionExpiresAt,
      metadata: METADATA,
    })

    expect(transfer.expiresAt).toBe(new Date(Date.now() + UPLOAD_URL_TTL_MS).toISOString())
    expect(transfer.expiresAt).not.toBe(sessionExpiresAt.toISOString())
    expect(new Date(transfer.expiresAt).getTime()).toBeLessThan(sessionExpiresAt.getTime())
  })

  it('advertises the full session lifetime for the unsigned local data plane', async () => {
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS)

    const transfer = await createPutProviderTransfer({
      provider: 'local',
      key: 'workspace/workspace-1/file.bin',
      contentType: 'application/octet-stream',
      fileSize: 4,
      context: CONTEXT,
      uploadId: 'upload-1',
      uploadToken: 'token-1',
      localOrigin: 'http://localhost:3000',
      expiresAt: sessionExpiresAt,
      metadata: METADATA,
    })

    expect(transfer.expiresAt).toBe(sessionExpiresAt.toISOString())
  })

  it('never signs a PUT past the end of its session', async () => {
    await createPutProviderTransfer({
      provider: 's3',
      key: 'workspace/workspace-1/file.bin',
      contentType: 'application/octet-stream',
      fileSize: 4,
      context: CONTEXT,
      uploadId: 'upload-1',
      uploadToken: 'token-1',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      metadata: METADATA,
    })

    expect(mockS3Presign.mock.calls[0][0]).toMatchObject({ expiresIn: 5 * 60 })
  })

  it('refuses to sign a PUT for a session that has already expired', async () => {
    await expect(
      createPutProviderTransfer({
        provider: 's3',
        key: 'workspace/workspace-1/file.bin',
        contentType: 'application/octet-stream',
        fileSize: 4,
        context: CONTEXT,
        uploadId: 'upload-1',
        uploadToken: 'token-1',
        expiresAt: new Date(Date.now() - 1),
        metadata: METADATA,
      })
    ).rejects.toThrow('Cannot sign an expired PUT upload session')
    expect(mockS3Presign).not.toHaveBeenCalled()
  })

  it('keeps multipart part URLs on the same bounded lifetime, re-signed on demand', async () => {
    const first = await getMultipartProviderPartUrls({
      provider: 's3',
      providerUploadId: 'provider-upload-1',
      key: 'workspace/workspace-1/file.bin',
      context: CONTEXT,
      partNumbers: [1],
      localUrl: (partNumber) => `http://local/${partNumber}`,
    })
    expect(first[0].expiresAt).toBe(new Date(Date.now() + UPLOAD_URL_TTL_MS).toISOString())

    // A multipart session that outlives its part URLs recovers by asking the
    // per-surface `.../parts` endpoint for a freshly signed window.
    vi.advanceTimersByTime(23 * 60 * 60 * 1000)
    const second = await getMultipartProviderPartUrls({
      provider: 's3',
      providerUploadId: 'provider-upload-1',
      key: 'workspace/workspace-1/file.bin',
      context: CONTEXT,
      partNumbers: [1],
      localUrl: (partNumber) => `http://local/${partNumber}`,
    })
    expect(second[0].expiresAt).toBe(new Date(Date.now() + UPLOAD_URL_TTL_MS).toISOString())
    expect(new Date(second[0].expiresAt).getTime()).toBeGreaterThan(
      new Date(first[0].expiresAt).getTime()
    )
  })

  it('signs multipart parts for the same lifetime it advertises', async () => {
    const urls = await getMultipartProviderPartUrls({
      provider: 's3',
      providerUploadId: 'provider-upload-1',
      key: 'workspace/workspace-1/file.bin',
      context: CONTEXT,
      partNumbers: [1],
      localUrl: (partNumber) => `http://local/${partNumber}`,
    })

    // The advertised `expiresAt` and the signature's own lifetime both come from
    // `UPLOAD_URL_TTL_MS`. A provider that defaults its own window instead would keep signing
    // 1h URLs while the advertised expiry moved — the advertise-vs-sign mismatch this ttl
    // constant exists to prevent.
    const signedExpiresIn = mockS3PartUrls.mock.calls[0][4]
    expect(signedExpiresIn).toBe(UPLOAD_URL_TTL_MS / 1000)
    expect(new Date(urls[0].expiresAt).getTime() - Date.now()).toBe(signedExpiresIn * 1000)
  })
})

function byteStream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function localPath(key: string): string {
  return `${testUploadDirectory}/${key}`
}

async function temporaryFiles(relativeDirectory: string): Promise<string[]> {
  const entries = await readdir(localPath(relativeDirectory)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    }
  )
  return entries.filter((entry) => entry.startsWith('.'))
}
