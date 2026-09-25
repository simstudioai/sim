import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { uploadsConfigMock } from '@sim/testing/mocks/uploads-config.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/config', () => uploadsConfigMock)
vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { uploadFile } from '@/lib/uploads/core/storage-service'

let directory = ''

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sim-chat-image-'))
  setUploadDirServer(directory)
})
afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})
describe('metadata-free immutable local uploads', () => {
  it('publishes exactly one complete winner under concurrent retries', async () => {
    const buffers = [Buffer.alloc(10000, 1), Buffer.alloc(10000, 2)]
    const results = await Promise.allSettled(
      buffers.map((file) =>
        uploadFile({
          file,
          fileName: 'image.webp',
          customKey: 'chat-images/image.webp',
          contentType: 'image/webp',
          context: 'mothership',
          preserveKey: true,
          persistMetadata: false,
          createOnly: true,
        })
      )
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const winner = results.findIndex((result) => result.status === 'fulfilled')
    expect(await readFile(join(directory, 'chat-images/image.webp'))).toEqual(buffers[winner])
    expect(await readdir(join(directory, 'chat-images'))).toEqual(['image.webp'])
  })
  it('aborted upload leaves no visible object', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      uploadFile({
        file: Buffer.from('bytes'),
        fileName: 'cancelled.webp',
        contentType: 'image/webp',
        context: 'mothership',
        persistMetadata: false,
        createOnly: true,
        signal: controller.signal,
      })
    ).rejects.toThrow()
    await expect(readFile(join(directory, 'cancelled.webp'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
