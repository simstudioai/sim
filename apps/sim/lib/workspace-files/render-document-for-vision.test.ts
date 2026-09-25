import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

const { sandbox } = vi.hoisted(() => ({ sandbox: vi.fn() }))
vi.mock('@/lib/execution/remote-sandbox', () => ({ executeInSandbox: sandbox }))

import {
  renderDocumentForVision,
  resolveDocumentPages,
} from '@/lib/workspace-files/render-document-for-vision'

async function result(first = 1, last = 1, total = 1) {
  const jpeg = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } })
    .jpeg()
    .toBuffer()
  return {
    result: { first, last, total },
    collectedFiles: [{ relativePath: 'grid.jpg', contentBase64: jpeg.toString('base64') }],
  }
}

describe('document page selection', () => {
  it('defaults to the first 20 actual pages, retaining the complete total', () => {
    expect(resolveDocumentPages(37)).toEqual({ first: 1, last: 20, total: 37 })
    expect(resolveDocumentPages(3)).toEqual({ first: 1, last: 3, total: 3 })
    expect(resolveDocumentPages(37, '21-37')).toEqual({ first: 21, last: 37, total: 37 })
    expect(resolveDocumentPages(37, '3')).toEqual({ first: 3, last: 3, total: 37 })
  })
  it.each(['', '0', '-1', '2-1', '1-21', '1-38', '1,3', '1.5', '9007199254740992'])(
    'rejects invalid or unbounded pages %j',
    (pages) => {
      expect(() => resolveDocumentPages(37, pages)).toThrow()
    }
  )
})

describe('renderDocumentForVision', () => {
  it.each(['pdf', 'docx', 'pptx'])(
    'renders compiled %s bytes through the document sandbox with cancellation and bounded binary output',
    async (ext) => {
      sandbox.mockResolvedValue(await result(1, 20, 37))
      const source = Buffer.from('authorized compiled bytes')
      const signal = new AbortController().signal
      const image = await renderDocumentForVision(
        source,
        'application/octet-stream',
        `document.${ext}`,
        undefined,
        signal
      )
      expect(image).toMatchObject({ mediaType: 'image/jpeg', first: 1, last: 20, total: 37 })
      expect((await sharp(image.buffer).metadata()).format).toBe('jpeg')
      expect(sandbox).toHaveBeenCalledWith(
        expect.objectContaining({
          sandboxKind: 'doc',
          signal,
          timeoutMs: 150_000,
          outputSandboxDir: '/home/user/rendered',
          sandboxFiles: [
            {
              path: `/home/user/input.${ext}`,
              content: source.toString('base64'),
              encoding: 'base64',
            },
          ],
        })
      )
      const code = sandbox.mock.calls[0][0].code
      expect(code).toContain('"pdfinfo"')
      expect(code).toContain('"-f", str(first), "-l", str(last)')
      expect(code).toContain('"-scale-to", "1200"')
      expect(code).toContain('len(paths) != n')
      expect(code).toContain('requested = []')
    }
  )

  it('honors an explicit range, verifies returned accounting, and exports no image through stdout', async () => {
    sandbox.mockResolvedValue(await result(21, 30, 37))
    expect(
      await renderDocumentForVision(Buffer.from('pdf'), 'application/pdf', 'document.pdf', '21-30')
    ).toMatchObject({ first: 21, last: 30, total: 37 })
    expect(sandbox.mock.calls[0][0].code).toContain('requested = [21,30]')
    expect(sandbox.mock.calls[0][0].code).not.toContain('b64encode')
    sandbox.mockResolvedValue(await result(1, 10, 37))
    await expect(
      renderDocumentForVision(Buffer.from('pdf'), 'application/pdf', 'document.pdf', '21-30')
    ).rejects.toThrow('wrong page range')
  })

  it('refuses invalid selections before starting the sandbox', async () => {
    await expect(
      renderDocumentForVision(Buffer.from('pdf'), 'application/pdf', 'document.pdf', '1-21')
    ).rejects.toThrow('at most 20')
    expect(sandbox).not.toHaveBeenCalled()
  })

  it('rejects pages outside the actual total and malformed page accounting', async () => {
    sandbox.mockResolvedValue(await result(3, 5, 4))
    await expect(
      renderDocumentForVision(Buffer.from('pdf'), 'application/pdf', 'document.pdf', '3-5')
    ).rejects.toThrow("document's 4 pages")
    sandbox.mockResolvedValue({ result: { first: 1, last: 1, total: '1' } })
    await expect(
      renderDocumentForVision(Buffer.from('pdf'), 'application/pdf', 'document.pdf')
    ).rejects.toThrow('invalid page information')
  })

  it('rejects oversized, malformed, non-JPEG, or invalid-dimension sandbox images', async () => {
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
    const huge = await sharp({ create: { width: 2201, height: 1, channels: 3, background: 'red' } })
      .jpeg()
      .toBuffer()
    for (const encoded of [
      'a'.repeat(4 * Math.ceil((5 * 1024 * 1024) / 3) + 4),
      '!!!!',
      png.toString('base64'),
      huge.toString('base64'),
    ]) {
      sandbox.mockResolvedValue({
        result: { first: 1, last: 1, total: 1 },
        collectedFiles: [{ relativePath: 'grid.jpg', contentBase64: encoded }],
      })
      await expect(
        renderDocumentForVision(Buffer.from('pdf'), 'application/pdf', 'document.pdf')
      ).rejects.toThrow()
    }
  })

  it('does not expose raw sandbox errors', async () => {
    sandbox.mockResolvedValue({ error: 'private sandbox URL or credentials' })
    await expect(
      renderDocumentForVision(Buffer.from('pdf'), 'application/pdf', 'document.pdf')
    ).rejects.toThrow(/^Document could not be rendered$/)
  })
})
