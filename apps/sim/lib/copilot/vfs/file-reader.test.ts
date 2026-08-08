/**
 * @vitest-environment node
 */

import { randomFillSync } from 'node:crypto'
import { crc32 } from 'node:zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchWorkspaceFileBuffer } = vi.hoisted(() => ({
  fetchWorkspaceFileBuffer: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer,
}))

import { readFileRecord } from '@/lib/copilot/vfs/file-reader'

const MAX_IMAGE_READ_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_SOURCE_BYTES = 25 * 1024 * 1024

async function makeNoisePng(width: number, height: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const raw = Buffer.alloc(width * height * 3)
  randomFillSync(raw)
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
}

/**
 * A decompression bomb: a few hundred bytes on the wire declaring a raster far too
 * large to decode. Built by rewriting the IHDR dimensions of a real PNG rather than
 * by rendering one, because rendering the raster is the very cost under test.
 */
async function makeBombPng(width: number, height: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } })
    .png()
    .toBuffer()
  png.writeUInt32BE(width, 16)
  png.writeUInt32BE(height, 20)
  // IHDR's CRC covers the chunk type and data — bytes 12..29 of a PNG.
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29)
  return png
}

function imageRecord(name: string, size: number, type = 'image/png') {
  return {
    id: 'wf_img',
    workspaceId: 'ws_1',
    name,
    key: `uploads/${name}`,
    path: `/api/files/serve/uploads%2F${name}?context=mothership`,
    size,
    type,
    uploadedBy: 'user_1',
    uploadedAt: new Date(),
    deletedAt: null,
    storageContext: 'mothership' as const,
  }
}

const SHARP_TEST_TIMEOUT_MS = 30_000

describe('readFileRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it(
    'rejects a decompression bomb without decoding its raster',
    async () => {
      // 9e8 pixels — ~3.6GB once decoded as RGBA.
      const bomb = await makeBombPng(30_000, 30_000)
      expect(bomb.length).toBeLessThan(MAX_IMAGE_READ_BYTES)

      fetchWorkspaceFileBuffer.mockResolvedValue(bomb)

      const result = await readFileRecord(imageRecord('bomb.png', bomb.length))

      expect(result?.attachment).toBeUndefined()
      expect(result?.content).toContain('It is too large to decode safely.')
    },
    SHARP_TEST_TIMEOUT_MS
  )

  it('rejects an oversized image on its stored size before fetching it', async () => {
    const result = await readFileRecord(imageRecord('huge.png', MAX_IMAGE_SOURCE_BYTES + 1))

    expect(fetchWorkspaceFileBuffer).not.toHaveBeenCalled()
    expect(result?.attachment).toBeUndefined()
    expect(result?.content).toContain('Image too large to read inline')
  })

  it(
    'downscales oversized images into attachments that fit the read limit',
    async () => {
      const largePng = await makeNoisePng(1800, 1800)
      expect(largePng.length).toBeGreaterThan(MAX_IMAGE_READ_BYTES)

      fetchWorkspaceFileBuffer.mockResolvedValue(largePng)

      const result = await readFileRecord(imageRecord('chesspng.png', largePng.length))

      expect(result?.attachment?.type).toBe('image')
      expect(result?.content).toContain('resized for vision')

      const decoded = Buffer.from(result?.attachment?.source.data ?? '', 'base64')
      expect(decoded.length).toBeLessThanOrEqual(MAX_IMAGE_READ_BYTES)
      expect(result?.attachment?.source.media_type).toMatch(/^image\/(jpeg|webp|png)$/)
    },
    SHARP_TEST_TIMEOUT_MS
  )
})
