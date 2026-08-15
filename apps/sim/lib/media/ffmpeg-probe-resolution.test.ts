/**
 * Standalone file: the ffmpeg module memoizes its binary lookup at module
 * scope, so exercising the "no ffmpeg installed" branch needs a fresh module
 * state that a shared file would already have consumed.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execSyncMock, execFileMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
  execFileMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execSync: execSyncMock,
  execFile: execFileMock,
}))

import { runFfmpegOperation } from '@/lib/media/ffmpeg'

const PROBE_JSON = JSON.stringify({
  format: { duration: '3', format_name: 'mov,mp4' },
  streams: [{ codec_type: 'video', codec_name: 'h264', width: 640, height: 480 }],
})

describe('probing without a discoverable ffmpeg binary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // No ffmpeg on this host.
    execSyncMock.mockImplementation(() => {
      throw new Error('which: no ffmpeg in PATH')
    })
    execFileMock.mockImplementation((_bin, _args, _opts, cb) => {
      cb(null, PROBE_JSON, '')
      return {}
    })
  })

  it('keeps probing across repeated calls', async () => {
    const file = { buffer: Buffer.from('media'), mimeType: 'video/mp4' }

    // The second call is the regression: the binary lookup is memoized after
    // the first, and an ffmpeg-required check here would throw from then on
    // even though ffprobe is perfectly usable.
    for (const _ of [1, 2, 3]) {
      const result = await runFfmpegOperation('probe', [file])
      expect(result.probe).toMatchObject({ hasVideo: true, width: 640, height: 480 })
    }

    expect(execFileMock).toHaveBeenCalledTimes(3)
    expect(execFileMock.mock.calls[0][0]).toContain('ffprobe')
  })

  it('always hands ffprobe a positive timeout', async () => {
    // Node reads `timeout: 0` as "no timeout", so the computed cap is floored.
    // Asserted on a healthy budget rather than an expired one: forcing the
    // expired window means racing the abort timer, which makes the test flaky.
    await runFfmpegOperation('probe', [{ buffer: Buffer.from('media'), mimeType: 'video/mp4' }])

    const opts = execFileMock.mock.calls[0][2] as { timeout: number }
    expect(opts.timeout).toBeGreaterThan(0)
    expect(opts.timeout).toBeLessThanOrEqual(15_000)
  })

  it('still refuses to transcode, which genuinely needs ffmpeg', async () => {
    await expect(
      runFfmpegOperation('convert', [{ buffer: Buffer.from('m'), mimeType: 'video/mp4' }], {
        format: 'mp3',
      })
    ).rejects.toThrow('FFmpeg not found')
  })
})
