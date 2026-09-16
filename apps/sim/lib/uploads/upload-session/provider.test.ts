/**
 * @vitest-environment node
 */
import { link, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Spied rather than replaced: every assertion in this file reads the real
 * filesystem, and the only behaviour worth faking is a single `link` answering
 * `EXDEV`, which no temporary directory can be made to produce on its own.
 */
vi.mock('node:fs/promises', { spy: true })

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

import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'
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

/** Longest name the file contracts admit, in the key shape workspace files use. */
const MAX_LENGTH_KEY = `workspace/workspace-1/${buildStorageKeySegment(
  '1700000000000-0123456789abcdef-',
  `${'a'.repeat(251)}.txt`
)}`

const NAME_MAX = 255
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

  it('cancels a stalled local upload without publishing a partial object', async () => {
    const controller = new AbortController()
    let canceled = false
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const pending = writeLocalPutObject({
      uploadId: 'canceled-upload',
      key: 'workspace/workspace-1/canceled.bin',
      body: new ReadableStream<Uint8Array>({
        pull() {
          started()
        },
        cancel() {
          canceled = true
        },
      }),
      expectedSize: 10,
      contentType: 'application/octet-stream',
      metadata: {},
      signal: controller.signal,
    })
    const result = expect(pending).rejects.toHaveProperty('name', 'AbortError')
    await ready
    controller.abort()
    await result
    expect(canceled).toBe(true)
    await expect(
      stat(join(testUploadDirectory, 'workspace/workspace-1/canceled.bin'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
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

  /**
   * Staging moved out of the destination's own directory into one shared
   * `.staging` root, which is what makes this reachable: a volume mounted under
   * part of the uploads tree puts the staged object and its destination on
   * different devices, and a hard link cannot span them. Publication has to
   * survive that without giving up the create-or-fail the link provides.
   */
  it('publishes across a filesystem boundary a hard link cannot span', async () => {
    vi.mocked(link).mockRejectedValueOnce(
      Object.assign(new Error('EXDEV: cross-device link'), { code: 'EXDEV' })
    )

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
    ).resolves.toMatchObject({ size: 4, uploadId: 'upload-1' })
    expect(await temporaryFiles('workspace/workspace-1')).toEqual([])
    expect(await allEntries('.staging')).toEqual([])
  })

  it('still refuses to overwrite an existing object when the link cannot span devices', async () => {
    const params = {
      uploadId: 'upload-1',
      key: 'workspace/workspace-1/file.bin',
      expectedSize: 3,
      contentType: 'application/octet-stream',
      metadata: METADATA,
    }
    await writeLocalPutObject({ ...params, body: byteStream('one') })
    vi.mocked(link).mockRejectedValueOnce(
      Object.assign(new Error('EXDEV: cross-device link'), { code: 'EXDEV' })
    )

    await expect(writeLocalPutObject({ ...params, body: byteStream('two') })).rejects.toThrow()

    await expect(readFile(localPath(params.key), 'utf8')).resolves.toBe('one')
    expect(await temporaryFiles('workspace/workspace-1')).toEqual([])
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

  // A staged object named after its destination overflows `NAME_MAX` at the
  // contract's longest name, and the whole session becomes unusable: the
  // transfer URL is issued, the PUT against it 500s, and `complete` then reports
  // the object missing.
  it('stores a PUT under the longest key the name contract can produce', async () => {
    await writeLocalPutObject({
      uploadId: '11111111-1111-4111-8111-111111111111',
      key: MAX_LENGTH_KEY,
      body: byteStream('abc'),
      expectedSize: 3,
      contentType: 'text/plain',
      metadata: METADATA,
    })

    await expect(readFile(localPath(MAX_LENGTH_KEY), 'utf8')).resolves.toBe('abc')
    await expect(
      headProviderObject({ provider: 'local', key: MAX_LENGTH_KEY, context: CONTEXT })
    ).resolves.toMatchObject({ size: 3, contentType: 'text/plain' })
    expect(await temporaryFiles('workspace/workspace-1')).toEqual([])
    expect(await allEntries('.staging')).toEqual([])
  })

  it('assembles multipart parts under the longest key the name contract can produce', async () => {
    await writeLocalMultipartPart({
      uploadId: 'upload-1',
      partNumber: 1,
      body: byteStream('abc'),
      expectedSize: 3,
    })

    await completeMultipartProviderUpload({
      provider: 'local',
      providerUploadId: null,
      uploadId: 'upload-1',
      key: MAX_LENGTH_KEY,
      contentType: 'text/plain',
      context: CONTEXT,
      parts: [{ partNumber: 1, size: 3 }],
      metadata: METADATA,
    })

    await expect(readFile(localPath(MAX_LENGTH_KEY), 'utf8')).resolves.toBe('abc')
    expect(await allEntries('.staging')).toEqual([])
  })

  // The reservation only holds while every local path stays inside one
  // component's budget, staged names included.
  it('keeps every path component it writes within NAME_MAX', async () => {
    await writeLocalPutObject({
      uploadId: '11111111-1111-4111-8111-111111111111',
      key: MAX_LENGTH_KEY,
      body: byteStream('abc'),
      expectedSize: 3,
      contentType: 'text/plain',
      metadata: METADATA,
    })

    for (const path of await walk(testUploadDirectory)) {
      for (const component of path.split('/')) {
        expect(Buffer.byteLength(component, 'utf-8')).toBeLessThanOrEqual(NAME_MAX)
      }
    }
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

async function allEntries(relativeDirectory: string): Promise<string[]> {
  return readdir(localPath(relativeDirectory)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
}

/** Every path under `directory`, relative to it, files and directories alike. */
async function walk(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths: string[] = []
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    paths.push(relative)
    if (entry.isDirectory()) paths.push(...(await walk(`${directory}/${entry.name}`, relative)))
  }
  return paths
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
