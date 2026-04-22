/**
 * @vitest-environment node
 */

import { randomFillSync } from 'node:crypto'
import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

const { downloadWorkspaceFile } = vi.hoisted(() => ({
  downloadWorkspaceFile: vi.fn(),
}))

vi.mock('@sim/logger', () => loggerMock)
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  downloadWorkspaceFile,
}))

import { readFileRecord } from '@/lib/copilot/vfs/file-reader'

const MAX_IMAGE_READ_BYTES = 5 * 1024 * 1024

async function makeNoisePng(width: number, height: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const raw = Buffer.alloc(width * height * 3)
  randomFillSync(raw)
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
}

describe('readFileRecord', () => {
  it('returns small images as attachments without resize note', async () => {
    const sharp = (await import('sharp')).default
    const smallPng = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer()

    downloadWorkspaceFile.mockResolvedValue(smallPng)

    const result = await readFileRecord({
      id: 'wf_small',
      workspaceId: 'ws_1',
      name: 'small.png',
      key: 'uploads/small.png',
      path: '/api/files/serve/uploads%2Fsmall.png?context=mothership',
      size: smallPng.length,
      type: 'image/png',
      uploadedBy: 'user_1',
      uploadedAt: new Date(),
      deletedAt: null,
      storageContext: 'mothership',
    })

    expect(result?.attachment?.type).toBe('image')
    expect(result?.attachment?.source.media_type).toBe('image/png')
    expect(result?.content).not.toContain('resized for vision')
    expect(Buffer.from(result?.attachment?.source.data ?? '', 'base64')).toEqual(smallPng)
  })

  it('downscales oversized images into attachments that fit the read limit', async () => {
    const largePng = await makeNoisePng(1800, 1800)
    expect(largePng.length).toBeGreaterThan(MAX_IMAGE_READ_BYTES)

    downloadWorkspaceFile.mockResolvedValue(largePng)

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
  })
})
