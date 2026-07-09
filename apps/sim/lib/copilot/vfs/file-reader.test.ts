/**
 * @vitest-environment node
 */

import { randomFillSync } from 'node:crypto'
import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

const { fetchWorkspaceFileBuffer } = vi.hoisted(() => ({
  fetchWorkspaceFileBuffer: vi.fn(),
}))

vi.mock('@sim/logger', () => loggerMock)
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer,
}))

import { readFileRecord, renderFileBuffer } from '@/lib/copilot/vfs/file-reader'

const MAX_IMAGE_READ_BYTES = 5 * 1024 * 1024

async function makeNoisePng(width: number, height: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const raw = Buffer.alloc(width * height * 3)
  randomFillSync(raw)
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
}

const SHARP_TEST_TIMEOUT_MS = 30_000

describe('readFileRecord', () => {
  it(
    'downscales oversized images into attachments that fit the read limit',
    async () => {
      const largePng = await makeNoisePng(1800, 1800)
      expect(largePng.length).toBeGreaterThan(MAX_IMAGE_READ_BYTES)

      fetchWorkspaceFileBuffer.mockResolvedValue(largePng)

      const result = await readFileRecord({
        id: 'wf_large',
        workspaceId: 'ws_1',
        name: 'chesspng.png',
        key: 'uploads/chesspng.png',
        path: '/api/files/serve/uploads%2Fchesspng.png?context=mothership',
        size: largePng.length,
        type: 'image/png',
        uploadedBy: 'user_1',
        uploadedAt: new Date(),
        deletedAt: null,
        storageContext: 'mothership',
      })

      expect(result?.attachment?.type).toBe('image')
      expect(result?.content).toContain('resized for vision')

      const decoded = Buffer.from(result?.attachment?.source.data ?? '', 'base64')
      expect(decoded.length).toBeLessThanOrEqual(MAX_IMAGE_READ_BYTES)
      expect(result?.attachment?.source.media_type).toMatch(/^image\/(jpeg|webp|png)$/)
    },
    SHARP_TEST_TIMEOUT_MS
  )

  it('returns the binary placeholder for an unrenderable type WITHOUT downloading', async () => {
    fetchWorkspaceFileBuffer.mockClear()
    const result = await readFileRecord({
      id: 'wf_bin',
      workspaceId: 'ws_1',
      name: 'archive.bin',
      key: 'uploads/archive.bin',
      path: '/api/files/serve/uploads%2Farchive.bin?context=mothership',
      size: 4_000_000_000, // 4 GB — must never be fetched into memory
      type: 'application/octet-stream',
      uploadedBy: 'user_1',
      uploadedAt: new Date(),
      deletedAt: null,
      storageContext: 'mothership',
    })

    expect(result?.content).toContain('[Binary file: archive.bin')
    expect(fetchWorkspaceFileBuffer).not.toHaveBeenCalled()
  })
})

describe('renderFileBuffer', () => {
  it('renders readable text content verbatim with line counts', async () => {
    const buffer = Buffer.from('line one\nline two\nline three')
    const result = await renderFileBuffer(buffer, {
      name: 'notes.txt',
      type: 'text/plain',
      ext: 'txt',
    })
    expect(result.content).toBe('line one\nline two\nline three')
    expect(result.totalLines).toBe(3)
    expect(result.attachment).toBeUndefined()
  })

  it('renders csv and json by content type', async () => {
    const csv = await renderFileBuffer(Buffer.from('a,b\n1,2'), {
      name: 'data.csv',
      type: 'text/csv',
      ext: 'csv',
    })
    expect(csv.content).toBe('a,b\n1,2')

    const json = await renderFileBuffer(Buffer.from('{"k":1}'), {
      name: 'config.json',
      type: 'application/json',
      ext: 'json',
    })
    expect(json.content).toBe('{"k":1}')
  })

  it('returns a binary placeholder for unrenderable types', async () => {
    const result = await renderFileBuffer(Buffer.from([0x00, 0x01, 0x02, 0x03]), {
      name: 'blob.dat',
      type: 'application/octet-stream',
      ext: 'dat',
    })
    expect(result.content).toContain('[Binary file: blob.dat')
    expect(result.attachment).toBeUndefined()
  })

  it('rejects oversized text without returning content', async () => {
    const big = Buffer.alloc(MAX_IMAGE_READ_BYTES + 1, 0x61) // > 5MB of 'a'
    const result = await renderFileBuffer(big, {
      name: 'huge.txt',
      type: 'text/plain',
      ext: 'txt',
    })
    expect(result.content).toContain('[File too large to display inline: huge.txt')
  })
})
