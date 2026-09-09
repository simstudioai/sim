/**
 * @vitest-environment node
 */
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { testDirectory, mockInsertMetadata } = vi.hoisted(() => ({
  testDirectory: `/tmp/sim-knowledge-upload-compensation-${process.pid}`,
  mockInsertMetadata: vi.fn(),
}))

vi.mock('@/lib/uploads/core/setup.server', () => ({ UPLOAD_DIR_SERVER: testDirectory }))
vi.mock('@/lib/uploads/config', () => ({
  USE_BLOB_STORAGE: false,
  USE_S3_STORAGE: false,
  USE_GCS_STORAGE: false,
  getStorageConfig: () => ({}),
}))
vi.mock('@/lib/uploads/server/metadata', () => ({
  insertFileMetadata: vi.fn(),
  insertImmutableFileMetadata: mockInsertMetadata,
}))

import { LOCAL_UPLOAD_METADATA_SUFFIX } from '@/lib/uploads/core/storage-key'
import { downloadFile, headObject, uploadFile } from '@/lib/uploads/core/storage-service'
import { writeLocalPutObject } from '@/lib/uploads/upload-session/provider'

const KEY = 'kb/document.txt'
const ORIGINAL_ERROR = new Error('organization no longer exists')

function upload() {
  return uploadFile({
    file: Buffer.from('new bytes'),
    fileName: 'document.txt',
    customKey: KEY,
    preserveKey: true,
    context: 'knowledge-base',
    contentType: 'text/plain',
    metadata: { organizationId: 'org-1', userId: 'user-1' },
  })
}

async function writeOtherAttempt() {
  await writeLocalPutObject({
    uploadId: 'other-attempt',
    key: KEY,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from('keep these bytes'))
        controller.close()
      },
    }),
    expectedSize: Buffer.byteLength('keep these bytes'),
    contentType: 'text/plain',
    metadata: {},
  })
}

describe('local cache upload compensation', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockInsertMetadata.mockReset().mockResolvedValue({ id: 'file-1' })
    await rm(testDirectory, { recursive: true, force: true })
    await mkdir(testDirectory, { recursive: true })
  })

  afterAll(async () => {
    resetDbChainMock()
    await rm(testDirectory, { recursive: true, force: true })
  })

  it('uses one local root for concurrent metadata probes and bounded checkpoint reads', async () => {
    const objects = Array.from({ length: 8 }, (_, index) => ({
      key: `knowledge-embedding-checkpoints/v1/fixture/batch-${index}.bin`,
      bytes: Buffer.alloc(32_768 + index, index),
    }))
    for (const object of objects) {
      await uploadFile({
        file: object.bytes,
        fileName: 'checkpoint.bin',
        customKey: object.key,
        preserveKey: true,
        persistMetadata: false,
        context: 'knowledge-base',
        contentType: 'application/octet-stream',
      })
    }
    await Promise.all(
      objects.map(async (object) => {
        expect(await headObject(object.key, 'knowledge-base')).toEqual({
          size: object.bytes.length,
        })
        expect(
          await downloadFile({
            key: object.key,
            context: 'knowledge-base',
            maxBytes: object.bytes.length,
          })
        ).toEqual(object.bytes)
      })
    )
    expect(
      await headObject('knowledge-embedding-checkpoints/v1/fixture/missing.bin', 'knowledge-base')
    ).toBeNull()
  })

  it('removes the newly created file and sidecar while preserving the original metadata error', async () => {
    mockInsertMetadata.mockRejectedValueOnce(ORIGINAL_ERROR)

    await expect(upload()).rejects.toBe(ORIGINAL_ERROR)

    await expect(stat(join(testDirectory, KEY))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      stat(join(testDirectory, `${KEY}${LOCAL_UPLOAD_METADATA_SUFFIX}`))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not replace or delete a preexisting object', async () => {
    await writeOtherAttempt()

    await expect(upload()).rejects.toThrow()

    await expect(readFile(join(testDirectory, KEY), 'utf8')).resolves.toBe('keep these bytes')
    expect(mockInsertMetadata).not.toHaveBeenCalled()
  })

  it('preserves an object recreated by another attempt before compensation', async () => {
    mockInsertMetadata.mockImplementationOnce(async () => {
      await rm(join(testDirectory, KEY))
      await rm(join(testDirectory, `${KEY}${LOCAL_UPLOAD_METADATA_SUFFIX}`))
      await writeOtherAttempt()
      throw ORIGINAL_ERROR
    })

    await expect(upload()).rejects.toBe(ORIGINAL_ERROR)

    await expect(readFile(join(testDirectory, KEY), 'utf8')).resolves.toBe('keep these bytes')
  })
})
