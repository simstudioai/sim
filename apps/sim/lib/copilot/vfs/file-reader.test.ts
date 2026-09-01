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

import {
  MAX_IMAGE_READ_BYTES,
  MAX_IMAGE_SOURCE_BYTES,
  MAX_PARSEABLE_READ_BYTES,
  MAX_TEXT_READ_BYTES,
  readFileRecord,
} from '@/lib/copilot/vfs/file-reader'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { MAX_TRANSCODE_INPUT_BYTES } from '@/lib/uploads/server/heic'

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

      // Recorded size deliberately disagrees with the real bytes: it is client-declared,
      // so the placeholder must report what was actually fetched.
      const result = await readFileRecord(imageRecord('bomb.png', 999_999))

      expect(result?.attachment).toBeUndefined()
      expect(result?.content).toContain('It is too large to decode safely.')
      // The byte count must survive formatting too — a sub-1KB bomb formatted without
      // `includeBytes` collapses to "0 Bytes" next to the real reason.
      expect(result?.content).toContain(`(${bomb.length} Bytes)`)
    },
    SHARP_TEST_TIMEOUT_MS
  )

  it.each([
    ['48MP iPhone', 8064, 6048],
    ['61MP full-frame', 9504, 6336],
    ['102MP medium format', 11648, 8736],
  ])('does not refuse a %s frame on pixel count', async (_camera, width, height) => {
    // Guards the ceiling from being tightened below real hardware. These reach the
    // resize ladder and fail there on the stub's truncated pixel data — what matters
    // is that they are not turned away by the pixel budget first.
    fetchWorkspaceFileBuffer.mockResolvedValue(await makeBombPng(width, height))

    const result = await readFileRecord(imageRecord('photo.png', 4_000_000))

    expect(result?.content).not.toContain('It is too large to decode safely.')
  })

  it('reports the too-large placeholder when an understated record.size hides an oversized object', async () => {
    fetchWorkspaceFileBuffer.mockRejectedValue(
      new PayloadSizeLimitError({
        label: 'workspace file',
        maxBytes: MAX_IMAGE_SOURCE_BYTES,
        observedBytes: MAX_IMAGE_SOURCE_BYTES + 5_000,
      })
    )

    const result = await readFileRecord(imageRecord('understated.png', 1024))

    expect(result?.attachment).toBeUndefined()
    expect(result?.content).toContain('Image too large to read inline')
    // The observed size, not the understated 1024 the cap exists to distrust.
    expect(result?.content).toContain(`${MAX_IMAGE_SOURCE_BYTES + 5_000} bytes`)
    // And the cap was actually handed to the download — the placeholder alone would
    // still appear if the argument were dropped, since the mock rejects regardless.
    expect(fetchWorkspaceFileBuffer).toHaveBeenCalledWith(expect.anything(), {
      maxBytes: MAX_IMAGE_SOURCE_BYTES,
    })
  })

  it.each([
    ['text', 'notes.txt', 'text/plain', MAX_TEXT_READ_BYTES, 'File too large to display inline'],
    [
      'document',
      'report.pdf',
      'application/pdf',
      MAX_PARSEABLE_READ_BYTES,
      'Document too large to parse inline',
    ],
  ])(
    'caps the %s download and reports the observed size when it breaches',
    async (_kind, name, type, cap, expected) => {
      fetchWorkspaceFileBuffer.mockRejectedValue(
        new PayloadSizeLimitError({
          label: 'workspace file',
          maxBytes: cap,
          observedBytes: cap + 7_000,
        })
      )

      const result = await readFileRecord(imageRecord(name, 1024, type))

      expect(result?.content).toContain(expected)
      expect(result?.content).toContain(`${cap + 7_000} bytes`)
      expect(fetchWorkspaceFileBuffer).toHaveBeenCalledWith(expect.anything(), { maxBytes: cap })
    }
  )

  it('reports an oversized HEIF as a size refusal, not as a corrupt file', async () => {
    // `ftyp`+`heic` brand, past the WebAssembly transcoder's own tighter ceiling.
    const heif = Buffer.alloc(MAX_TRANSCODE_INPUT_BYTES + 1)
    heif.write('ftypheic', 4, 'ascii')
    fetchWorkspaceFileBuffer.mockResolvedValue(heif)

    const result = await readFileRecord(imageRecord('photo.heic', heif.length, 'image/heic'))

    expect(result?.attachment).toBeUndefined()
    expect(result?.content).toContain('It is too large to decode safely.')
    expect(result?.content).not.toContain('It could not be decoded.')
  })

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
