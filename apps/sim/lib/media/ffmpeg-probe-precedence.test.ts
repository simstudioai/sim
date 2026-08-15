/**
 * Standalone file: the resolved ffprobe path is memoized at module scope, so
 * the first resolution in a process wins. Testing precedence therefore needs a
 * module whose memo no other test has populated.
 *
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { execSyncMock, execFileMock, existsSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
  execFileMock: vi.fn(),
  existsSyncMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execSync: execSyncMock,
  execFile: execFileMock,
}))

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}))

import { runFfmpegOperation } from '@/lib/media/ffmpeg'

describe('ffprobe lookup precedence', () => {
  it('prefers ffprobe on PATH over a sibling of the ffmpeg binary', async () => {
    // ffmpeg resolves into a directory whose ffprobe sibling may be stray or
    // unusable; a real PATH entry must win. Both lookups go through execSync,
    // so they are distinguished by the command.
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('ffprobe')) return '/usr/bin/ffprobe\n'
      if (cmd.includes('ffmpeg')) return '/opt/broken/ffmpeg\n'
      throw new Error(`unexpected command: ${cmd}`)
    })
    // The sibling exists on disk — without this the test cannot tell the two
    // orderings apart, because a non-existent sibling is skipped either way.
    existsSyncMock.mockImplementation((p: string) => p === '/opt/broken/ffprobe')
    execFileMock.mockImplementation((_bin, _args, _opts, cb) => {
      cb(null, JSON.stringify({ format: {}, streams: [] }), '')
      return {}
    })

    await runFfmpegOperation('probe', [{ buffer: Buffer.from('media'), mimeType: 'video/mp4' }])

    expect(execFileMock.mock.calls[0][0]).toBe('/usr/bin/ffprobe')
    expect(execFileMock.mock.calls[0][0]).not.toBe('/opt/broken/ffprobe')
  })
})
