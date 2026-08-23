/**
 * @vitest-environment node
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { capturedVideoFilters, capturedCaptions, killSignals, probeReport, command, saves } =
  vi.hoisted(() => ({
    capturedVideoFilters: [] as string[],
    capturedCaptions: [] as string[],
    killSignals: [] as string[],
    probeReport: { json: '{"streams":[],"format":{}}' },
    command: { hang: false },
    saves: { waiters: [] as Array<() => void> },
  }))

vi.mock('node:child_process', () => ({
  execSync: (cmd: string) =>
    String(cmd).includes('ffprobe') ? '/usr/bin/ffprobe\n' : '/usr/bin/ffmpeg\n',
  // `promisify` honors this symbol the same way it does for the real execFile,
  // so the module under test destructures `{ stdout }` exactly as in production.
  execFile: Object.assign(() => undefined, {
    [Symbol.for('nodejs.util.promisify.custom')]: async () => ({
      stdout: probeReport.json,
      stderr: '',
    }),
  }),
}))

vi.mock('fluent-ffmpeg', () => {
  const makeCommand = (cwd?: string) => {
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    const cmd: Record<string, unknown> = {}
    const chain = (fn?: (arg: unknown) => void) => (arg?: unknown) => {
      fn?.(arg)
      return cmd
    }
    cmd.input = chain()
    cmd.inputOptions = chain()
    cmd.outputOptions = chain()
    cmd.complexFilter = chain()
    cmd.audioFilters = chain()
    cmd.noVideo = chain()
    cmd.setStartTime = chain()
    cmd.setDuration = chain()
    cmd.seekInput = chain()
    cmd.frames = chain()
    cmd.kill = chain((signal) => {
      killSignals.push(String(signal))
    })
    cmd.videoFilters = chain((arg) => {
      const filter = String(arg)
      capturedVideoFilters.push(filter)
      // The caption is a bare relative filename resolved against the command's cwd (the
      // temp dir). Read it back while it still exists to prove the raw caption never
      // reached the filtergraph string.
      const match = filter.match(/textfile=([^:]+)/)
      if (match && cwd) {
        capturedCaptions.push(fs.readFileSync(path.join(cwd, match[1]), 'utf-8'))
      }
    })
    cmd.on = (event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler
      return cmd
    }
    cmd.save = (outputPath: string) => {
      for (const resolve of saves.waiters.splice(0)) resolve()
      // A hung command never emits `end`, standing in for an encode that outlives
      // the request that asked for it.
      if (command.hang) return cmd
      fs.writeFileSync(outputPath, Buffer.from('stub-output'))
      handlers.end?.()
      return cmd
    }
    return cmd
  }
  const ffmpeg = ((_input?: unknown, options?: { cwd?: string }) =>
    makeCommand(options?.cwd)) as unknown as Record<string, unknown> & (() => unknown)
  ;(ffmpeg as Record<string, unknown>).setFfmpegPath = () => {}
  return { default: ffmpeg }
})

import { runFfmpegOperation } from '@/lib/media/ffmpeg'

const videoInput = {
  buffer: Buffer.from('fake-video-bytes'),
  mimeType: 'video/mp4',
  name: 'clip.mp4',
}

/** Resolves once the next FFmpeg command reaches `.save()`, i.e. once it is running. */
function nextSave(): Promise<void> {
  return new Promise((resolve) => saves.waiters.push(resolve))
}

beforeEach(() => {
  capturedVideoFilters.length = 0
  capturedCaptions.length = 0
  killSignals.length = 0
  saves.waiters.length = 0
  command.hang = false
  probeReport.json = '{"streams":[],"format":{}}'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runFfmpegOperation add_text filtergraph injection', () => {
  it('routes the caption through textfile= so it never becomes filtergraph syntax', async () => {
    await runFfmpegOperation('add_text', [videoInput], { text: 'Hello World :) 100% done' })

    expect(capturedVideoFilters).toHaveLength(1)
    const filter = capturedVideoFilters[0]
    expect(filter.startsWith('drawtext=textfile=')).toBe(true)
    expect(filter).toContain(':expansion=none:')
    // The caption text must not be inlined into the filter string.
    expect(filter).not.toContain('Hello World')
  })

  it('neutralizes a breakout payload that would inject textfile=/proc/self/environ', async () => {
    const payload = "x',drawtext=textfile=/proc/self/environ:x=10:y=10,drawtext=text=hi"
    await runFfmpegOperation('add_text', [videoInput], { text: payload })

    const filter = capturedVideoFilters[0]
    // The whole graph is a single, app-authored drawtext reading our temp caption file.
    expect(filter.startsWith('drawtext=textfile=')).toBe(true)
    // None of the attacker's injected syntax leaks into the filtergraph string.
    expect(filter).not.toContain('/proc/self/environ')
    expect(filter).not.toContain('drawtext=text=hi')
    // ...and the payload is stored verbatim as literal caption bytes instead.
    expect(capturedCaptions).toEqual([payload])
  })

  it('neutralizes a movie= read-SSRF breakout payload', async () => {
    const payload =
      "x'[d];movie=filename=http\\://169.254.169.254/latest:f=tty[m];[d][m]overlay=0:0"
    await runFfmpegOperation('add_text', [videoInput], { text: payload })

    const filter = capturedVideoFilters[0]
    expect(filter).not.toContain('movie=')
    expect(filter).not.toContain('169.254.169.254')
    expect(capturedCaptions).toEqual([payload])
  })
})

describe('runFfmpegOperation scale targets', () => {
  it('renders a known aspect ratio at its preset size', async () => {
    await runFfmpegOperation('scale_pad', [videoInput], { aspectRatio: '9:16' })

    expect(capturedVideoFilters[0]).toContain('scale=1080:1920')
  })

  it('accepts explicit dimensions up to the 4K ceiling', async () => {
    await runFfmpegOperation('scale_pad', [videoInput], { width: 3840, height: 2160 })

    expect(capturedVideoFilters[0]).toContain('scale=3840:2160')
  })

  it('rejects a dimension above the per-axis ceiling before spawning FFmpeg', async () => {
    await expect(
      runFfmpegOperation('scale_pad', [videoInput], { width: 30000, height: 30000 })
    ).rejects.toThrow(/width must be between 16 and 4096/)
    expect(capturedVideoFilters).toHaveLength(0)
  })

  it('rejects a frame whose area exceeds the pixel budget even when both axes fit', async () => {
    await expect(
      runFfmpegOperation('scale_pad', [videoInput], { width: 4096, height: 4096 })
    ).rejects.toThrow(/pixel limit/)
    expect(capturedVideoFilters).toHaveLength(0)
  })

  it('rejects a non-finite dimension', async () => {
    await expect(
      runFfmpegOperation('scale_pad', [videoInput], {
        width: Number.POSITIVE_INFINITY,
        height: 720,
      })
    ).rejects.toThrow(/must be a finite number/)
    expect(capturedVideoFilters).toHaveLength(0)
  })
})

describe('runFfmpegOperation concat normalization target', () => {
  const twoVideoStreams = JSON.stringify({
    streams: [{ codec_type: 'video', codec_name: 'h264', width: 4096, height: 4096 }],
    format: { duration: '2', format_name: 'mp4' },
  })

  it('fits an oversized square source inside the same area budget scale_pad enforces', async () => {
    probeReport.json = twoVideoStreams

    await runFfmpegOperation('concat', [videoInput, videoInput])

    // First filter is the normalization pass for input 0.
    const target = capturedVideoFilters[0].match(/scale=(\d+):(\d+):/)
    expect(target).not.toBeNull()
    const width = Number(target![1])
    const height = Number(target![2])
    expect(width * height).toBeLessThanOrEqual(4096 * 2304)
    // Aspect ratio of the square source survives the fit.
    expect(width).toBe(height)
  })

  it('holds the area bound for dimensions that round up on both axes', async () => {
    // 2694x3520 is the worst case in the whole dimension space: the scale factor
    // lands both axes on .5, and rounding both up to an even number put the pair
    // 3072 pixels back over the budget it had just been scaled into.
    probeReport.json = JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 2694, height: 3520 }],
      format: { duration: '2', format_name: 'mp4' },
    })

    await runFfmpegOperation('concat', [videoInput, videoInput])

    const target = capturedVideoFilters[0].match(/scale=(\d+):(\d+):/)
    expect(Number(target![1]) * Number(target![2])).toBeLessThanOrEqual(4096 * 2304)
  })

  it('emits even dimensions, which yuv420p requires', async () => {
    probeReport.json = JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 1919, height: 1081 }],
      format: { duration: '2', format_name: 'mp4' },
    })

    await runFfmpegOperation('concat', [videoInput, videoInput])

    const target = capturedVideoFilters[0].match(/scale=(\d+):(\d+):/)
    expect(Number(target![1]) % 2).toBe(0)
    expect(Number(target![2]) % 2).toBe(0)
  })

  it('leaves an ordinary source untouched', async () => {
    probeReport.json = JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }],
      format: { duration: '2', format_name: 'mp4' },
    })

    await runFfmpegOperation('concat', [videoInput, videoInput])

    expect(capturedVideoFilters[0]).toContain('scale=1920:1080')
  })
})

describe('runFfmpegOperation output format', () => {
  const traversals = [
    '../../../../../../../../tmp/pwned.mp4',
    '../sibling.mp4',
    'mp4/../../../etc/x',
    '/etc/passwd',
    'mp4\u0000.txt',
  ]

  for (const format of traversals) {
    it(`refuses to build an output path from ${JSON.stringify(format)}`, async () => {
      await expect(runFfmpegOperation('convert', [videoInput], { format })).rejects.toThrow(
        /Unsupported output format/
      )
      // Rejected before FFmpeg is handed anything to write.
      expect(saves.waiters.length).toBe(0)
    })
  }

  it('refuses a traversal on extract_audio too', async () => {
    await expect(
      runFfmpegOperation('extract_audio', [videoInput], { format: '../../../tmp/pwned.mp3' })
    ).rejects.toThrow(/Unsupported output format/)
  })

  it('still accepts ordinary container extensions', async () => {
    for (const format of ['mp4', 'mp3', 'webm', 'm4a', 'flac', 'opus', 'gif', 'mkv']) {
      const result = await runFfmpegOperation('convert', [videoInput], { format })
      expect(result.ext).toBe(format)
    }
  })

  it('lowercases before validating, so MP4 is still a valid target', async () => {
    const result = await runFfmpegOperation('convert', [videoInput], { format: 'MP4' })
    expect(result.ext).toBe('mp4')
  })
})

describe('runFfmpegOperation process bounds', () => {
  it('kills a command that outlives the operation budget', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    command.hang = true

    const saved = nextSave()
    const result = runFfmpegOperation('convert', [videoInput], { format: 'mp4' })
    await saved
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

    await expect(result).rejects.toThrow(/media operation limit/)
    expect(killSignals).toEqual(['SIGKILL'])
  })

  it('kills a running command when the caller cancels', async () => {
    command.hang = true
    const controller = new AbortController()

    const saved = nextSave()
    const result = runFfmpegOperation(
      'convert',
      [videoInput],
      { format: 'mp4' },
      { signal: controller.signal }
    )
    await saved
    controller.abort()

    await expect(result).rejects.toThrow('FFmpeg cancelled')
    expect(killSignals).toEqual(['SIGKILL'])
  })

  it('refuses to spawn anything once the caller has already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      runFfmpegOperation('convert', [videoInput], { format: 'mp4' }, { signal: controller.signal })
    ).rejects.toThrow('FFmpeg cancelled')
    expect(killSignals).toHaveLength(0)
  })

  it('leaves a command that finishes inside the budget untouched', async () => {
    const result = await runFfmpegOperation('convert', [videoInput], { format: 'mp4' })

    expect(result.buffer?.toString()).toBe('stub-output')
    expect(killSignals).toHaveLength(0)
  })
})

describe('runFfmpegOperation probe', () => {
  it('maps the ffprobe report onto the media probe shape', async () => {
    probeReport.json = JSON.stringify({
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      format: { duration: '12.5', format_name: 'mov,mp4,m4a' },
    })

    const result = await runFfmpegOperation('probe', [videoInput])

    expect(result.probe).toEqual({
      durationSeconds: 12.5,
      format: 'mov,mp4,m4a',
      width: 1920,
      height: 1080,
      videoCodec: 'h264',
      audioCodec: 'aac',
      hasAudio: true,
      hasVideo: true,
    })
  })

  it('reports a container with no streams without inventing metadata', async () => {
    const result = await runFfmpegOperation('probe', [videoInput])

    expect(result.probe).toEqual({
      durationSeconds: 0,
      format: 'unknown',
      width: undefined,
      height: undefined,
      videoCodec: undefined,
      audioCodec: undefined,
      hasAudio: false,
      hasVideo: false,
    })
  })
})
