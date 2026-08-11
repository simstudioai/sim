/**
 * @vitest-environment node
 */
import fs from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
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

  it('keeps the formats the input MIME map already supported', async () => {
    // Asserted through the rejection's own "Supported:" list rather than by
    // converting for real: a `not.toThrow` on a live transcode passes on any
    // rejection, including "FFmpeg not found".
    const error = await runFfmpegOperation('convert', [mediaFile()], { format: 'exe' }).catch(
      (e: Error) => e
    )

    for (const format of ['mp4', 'mov', 'webm', 'mp3', 'wav', 'gif', 'webp', 'weba']) {
      expect(error.message).toContain(format)
    }
  })
})

describe('runFfmpegOperation scale bounds', () => {
  it.each([
    [30000, 30000],
    [1, 1],
    [4097, 1080],
    [1920, 0],
    [0, 1080],
    [1920.5, 1080],
  ])('rejects scale_pad at %sx%s', async (width, height) => {
    await expect(runFfmpegOperation('scale_pad', [mediaFile()], { width, height })).rejects.toThrow(
      'must be an integer between 16 and 4096'
    )
  })
})

describe('runFfmpegOperation per-operation validation', () => {
  // Each rule is asserted at the operation that owns it. The complementary
  // property — that an operation ignores options it never reads — cannot be
  // asserted without running a real transcode, so it is left to review.
  it('rejects an out-of-range volume on mix_audio, which consumes it', async () => {
    await expect(
      runFfmpegOperation('mix_audio', [mediaFile('audio/mpeg'), mediaFile('audio/mpeg')], {
        volume: 15,
      })
    ).rejects.toThrow('volume must be a number between 0 and 10')
  })

  it('rejects a trim whose end precedes its start', async () => {
    await expect(runFfmpegOperation('trim', [mediaFile()], { start: 10, end: 5 })).rejects.toThrow(
      'end (5s) must be greater than or equal to start (10s)'
    )
  })

  it('restricts extract_audio to audio containers', async () => {
    await expect(
      runFfmpegOperation('extract_audio', [mediaFile()], { format: 'png' })
    ).rejects.toThrow('Unsupported output format')
  })
})

describe('runFfmpegOperation abort handling', () => {
  it('refuses to start once the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const mkdtemp = vi.spyOn(fs, 'mkdtemp')

    await expect(
      runFfmpegOperation('convert', [mediaFile()], { format: 'mp3' }, { signal: controller.signal })
    ).rejects.toThrow(/aborted/i)

    // "Refuses to start" means exactly this: no temp dir, so no input was ever
    // written and no process was ever spawned.
    expect(mkdtemp).not.toHaveBeenCalled()
    mkdtemp.mockRestore()
  })
})
