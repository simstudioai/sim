/** @vitest-environment node */
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sandbox, transcode } = vi.hoisted(() => ({ sandbox: vi.fn(), transcode: vi.fn() }))
vi.mock('@/lib/execution/remote-sandbox', () => ({ executeInSandbox: sandbox }))
vi.mock('@/lib/uploads/server/heic', () => ({
  isHevcHeifContainer: (buffer: Buffer) => buffer.toString('ascii', 8, 12) === 'heic',
  isHeifContainer: (buffer: Buffer) => buffer.toString('ascii', 4, 8) === 'ftyp',
  transcodeHeicToJpeg: transcode,
}))

import { prepareImageForVision } from '@/lib/workspace-files/prepare-image-for-vision'

const raster = () => sharp({ create: { width: 3, height: 2, channels: 3, background: '#ff0000' } })

describe('prepareImageForVision', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['png', 'jpeg', 'webp', 'gif'] as const)(
    'preserves valid bounded %s bytes and sniffs the actual format',
    async (format) => {
      const source = await raster().toFormat(format).toBuffer()
      const image = await prepareImageForVision(source)
      expect(image).toEqual({ buffer: source, mediaType: `image/${format}`, width: 3, height: 2 })
      expect(image.buffer).toBe(source)
      expect(sandbox).not.toHaveBeenCalled()
    }
  )

  it('converts SVG and TIFF into real provider-supported rasters', async () => {
    const sources = [
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="red"/></svg>'
      ),
      await raster().tiff().toBuffer(),
    ]
    for (const source of sources) {
      const image = await prepareImageForVision(source)
      expect(['image/webp', 'image/jpeg']).toContain(image.mediaType)
      const decoded = await sharp(image.buffer).raw().toBuffer({ resolveWithObject: true })
      expect(decoded.info).toMatchObject({ width: 3, height: 2 })
      expect(decoded.data[0]).toBeGreaterThan(240)
      expect(decoded.data[1]).toBeLessThan(20)
    }
  })

  it('resizes oversized dimensions, even when compressed bytes already fit', async () => {
    const source = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer()
    const image = await prepareImageForVision(source)
    expect(image).toMatchObject({ width: 1568, height: 784 })
    expect(image.buffer.length).toBeLessThanOrEqual(5 * 1024 * 1024)
    expect((await sharp(image.buffer).metadata()).width).toBe(1568)
  })

  it('uses the existing guarded HEIC decoder when native decoding fails', async () => {
    const jpeg = await raster().jpeg().toBuffer()
    transcode.mockResolvedValue(jpeg)
    const source = Buffer.from('0000ftypheic0000')
    expect(await prepareImageForVision(source)).toMatchObject({
      buffer: jpeg,
      mediaType: 'image/jpeg',
    })
    expect(transcode).toHaveBeenCalledWith(source)
  })

  it('transcodes known HEVC brands even when native container metadata succeeds', async () => {
    const source = await raster().avif().toBuffer()
    source.write('heic', 8, 'ascii')
    expect((await sharp(source).metadata()).width).toBe(3)
    const jpeg = await raster().jpeg().toBuffer()
    transcode.mockResolvedValue(jpeg)
    expect(await prepareImageForVision(source)).toMatchObject({
      buffer: jpeg,
      mediaType: 'image/jpeg',
    })
    expect(transcode).toHaveBeenCalledTimes(1)
    expect(transcode).toHaveBeenCalledWith(source)
  })

  it('rejects a failed guarded HEVC decode without falling through to native metadata', async () => {
    transcode.mockResolvedValue(null)
    await expect(prepareImageForVision(Buffer.from('0000ftypheic0000'))).rejects.toThrow(
      'HEIC image could not be decoded'
    )
    expect(transcode).toHaveBeenCalledTimes(1)
  })

  it('rejects excessive source bytes before any decoder or sandbox runs', async () => {
    await expect(prepareImageForVision(Buffer.allocUnsafe(100 * 1024 * 1024 + 1))).rejects.toThrow(
      '100 MB'
    )
    expect(transcode).not.toHaveBeenCalled()
    expect(sandbox).not.toHaveBeenCalled()
  })

  it.each(['BMP', 'ICO'] as const)(
    'routes %s through a bounded, cancellable Pillow sandbox export',
    async (format) => {
      const jpeg = await raster().jpeg().toBuffer()
      sandbox.mockResolvedValue({ result: null, exportedFileContent: jpeg.toString('base64') })
      const source = format === 'BMP' ? Buffer.from('BMfixture') : Buffer.from([0, 0, 1, 0, 1, 0])
      const signal = new AbortController().signal
      expect(await prepareImageForVision(source, signal)).toMatchObject({
        buffer: jpeg,
        mediaType: 'image/jpeg',
      })
      expect(sandbox).toHaveBeenCalledWith(
        expect.objectContaining({
          sandboxKind: 'doc',
          signal,
          timeoutMs: 60_000,
          outputSandboxPath: '/home/user/image.jpg',
          sandboxFiles: [
            {
              path: `/home/user/input.${format.toLowerCase()}`,
              content: source.toString('base64'),
              encoding: 'base64',
            },
          ],
        })
      )
      expect(sandbox.mock.calls[0][0].code).toContain(`image.format != "${format}"`)
      expect(sandbox.mock.calls[0][0].code).toContain('Image.MAX_IMAGE_PIXELS = 100_000_000')
      expect(sandbox.mock.calls[0][0].code).toContain('image.thumbnail((1568, 1568))')
    }
  )

  it('rejects empty, corrupt, and decompression-bomb images instead of passing their bytes through', async () => {
    for (const source of [
      Buffer.alloc(0),
      Buffer.from('not a png'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"></svg>'),
    ]) {
      await expect(prepareImageForVision(source)).rejects.toThrow()
    }
    expect(sandbox).not.toHaveBeenCalled()
  })

  it('rejects a corrupt PNG raster even if its metadata is readable', async () => {
    const source = await raster().png().toBuffer()
    const idat = source.indexOf('IDAT')
    source.fill(0, idat + 4, source.length - 12)
    await expect(prepareImageForVision(source)).rejects.toThrow('could not be decoded')
  })

  it('stops before decoding an aborted request', async () => {
    const controller = new AbortController()
    controller.abort(new Error('stopped'))
    await expect(prepareImageForVision(Buffer.from('BM'), controller.signal)).rejects.toThrow(
      'stopped'
    )
    expect(sandbox).not.toHaveBeenCalled()
  })
})
