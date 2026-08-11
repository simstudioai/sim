/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MAX_FFMPEG_INPUTS, type MediaFile, runFfmpegOperation } from '@/lib/media/ffmpeg'

function mediaFile(mimeType = 'video/mp4'): MediaFile {
  return { buffer: Buffer.from('media'), mimeType, name: 'clip.mp4' }
}

describe('runFfmpegOperation input bounds', () => {
  it('rejects more inputs than the cap before touching the filesystem', async () => {
    const inputs = Array.from({ length: MAX_FFMPEG_INPUTS + 1 }, () => mediaFile())

    await expect(runFfmpegOperation('concat', inputs)).rejects.toThrow(
      `At most ${MAX_FFMPEG_INPUTS} input files`
    )
  })

  it('still requires at least one input', async () => {
    await expect(runFfmpegOperation('convert', [], { format: 'mp3' })).rejects.toThrow(
      'At least one input file is required'
    )
  })
})

describe('runFfmpegOperation output format validation', () => {
  it.each([
    ['../../escape.mp4', 'traversal'],
    ['../pwned.mp3', 'parent segment'],
    ['/etc/cron.d/x.mp4', 'absolute path'],
    ['mp4/../../x', 'embedded separator'],
  ])('rejects %s as an output format (%s)', async (format) => {
    await expect(runFfmpegOperation('convert', [mediaFile()], { format })).rejects.toThrow(
      'Unsupported output format'
    )
  })

  it('rejects a format with no known muxer', async () => {
    await expect(runFfmpegOperation('convert', [mediaFile()], { format: 'exe' })).rejects.toThrow(
      'Unsupported output format'
    )
  })

  it('rejects a traversal format on extract_audio too', async () => {
    await expect(
      runFfmpegOperation('extract_audio', [mediaFile()], { format: '../../escape.mp3' })
    ).rejects.toThrow('Unsupported output format')
  })
})

describe('runFfmpegOperation scale bounds', () => {
  it.each([
    [30000, 30000],
    [1, 1],
    [4097, 1080],
    [1920, 0],
    [1920.5, 1080],
  ])('rejects scale_pad at %sx%s', async (width, height) => {
    await expect(runFfmpegOperation('scale_pad', [mediaFile()], { width, height })).rejects.toThrow(
      /must be an integer between 16 and 4096|requires width\+height/
    )
  })
})

describe('runFfmpegOperation abort handling', () => {
  it('refuses to start once the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      runFfmpegOperation('convert', [mediaFile()], { format: 'mp3' }, { signal: controller.signal })
    ).rejects.toThrow(/aborted/i)
  })
})
