import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { resetDbChainMock } from '@sim/testing'
import { uploadsConfigMock } from '@sim/testing/mocks/uploads-config.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const testDirectory = `/tmp/sim-knowledge-upload-compensation-${process.pid}`

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/uploads/config', () => uploadsConfigMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

import { LOCAL_UPLOAD_METADATA_SUFFIX } from '@/lib/uploads/core/storage-key'
import { uploadFile } from '@/lib/uploads/core/storage-service'
import { writeLocalPutObject } from '@/lib/uploads/upload-session/provider'

setUploadDirServer(testDirectory)

const mockInsertFileMetadata = uploadsMetadataMockFns.mockInsertFileMetadata
const mockDeleteFileMetadata = uploadsMetadataMockFns.mockDeleteFileMetadata
const mockInsertMetadata = uploadsMetadataMockFns.mockInsertImmutableFileMetadata

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
    resetDbChainMock()
    mockInsertMetadata.mockReset().mockResolvedValue({ id: 'file-1' })
    mockInsertFileMetadata.mockReset().mockResolvedValue({ id: 'file-1' })
    mockDeleteFileMetadata.mockReset().mockResolvedValue(undefined)
    await rm(testDirectory, { recursive: true, force: true })
    await mkdir(testDirectory, { recursive: true })
  })

  afterAll(async () => {
    resetDbChainMock()
    await rm(testDirectory, { recursive: true, force: true })
  })

  it('removes the newly created file and sidecar while preserving the original metadata error', async () => {
    mockInsertMetadata.mockRejectedValueOnce(ORIGINAL_ERROR)

    await expect(upload()).rejects.toBe(ORIGINAL_ERROR)

    await expect(stat(join(testDirectory, KEY))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      stat(join(testDirectory, `${KEY}${LOCAL_UPLOAD_METADATA_SUFFIX}`))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['execution', 'copilot'] as const)(
    'removes owned new local %s uploads if metadata persistence fails',
    async (context) => {
      const key = `${context}/unique-id/file.txt`
      mockInsertFileMetadata.mockRejectedValueOnce(ORIGINAL_ERROR)
      await expect(
        uploadFile({
          file: Buffer.from('hello'),
          fileName: 'file.txt',
          customKey: key,
          preserveKey: true,
          cleanupOnMetadataFailure: true,
          context,
          contentType: 'text/plain',
          metadata: { userId: 'user-1' },
        })
      ).rejects.toBe(ORIGINAL_ERROR)
      await expect(stat(join(testDirectory, key))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(mockDeleteFileMetadata).toHaveBeenCalledExactlyOnceWith(key)
    }
  )

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
