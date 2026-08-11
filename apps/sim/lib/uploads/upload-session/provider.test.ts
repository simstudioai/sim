/**
 * @vitest-environment node
 */
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { testUploadDirectory } = vi.hoisted(() => ({
  testUploadDirectory: `/tmp/sim-upload-session-provider-${process.pid}`,
}))

vi.mock('@/lib/uploads/core/setup.server', () => ({
  UPLOAD_DIR_SERVER: testUploadDirectory,
}))

vi.mock('@/lib/uploads/config', () => ({
  USE_BLOB_STORAGE: false,
  USE_GCS_STORAGE: false,
  USE_S3_STORAGE: false,
  getStorageConfig: vi.fn(() => ({})),
}))

import {
  completeMultipartProviderUpload,
  headProviderObject,
  LocalUploadBodyError,
  listMultipartProviderParts,
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
