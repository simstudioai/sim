/**
 * @vitest-environment node
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { calls, probe } = vi.hoisted(() => ({
  calls: [] as Array<{
    executable: string
    args: string[]
    maxBuffer?: number
    outputSize?: number
    signal?: AbortSignal
    timeout?: number
  }>,
  probe: {
    fail: false,
    json: JSON.stringify({
      streams: [
        {
          channels: 2,
          codec_name: 'aac',
          codec_type: 'audio',
          sample_rate: '48000',
        },
      ],
      format: { bit_rate: '192000', duration: '7.5', format_name: 'mov,mp4,m4a' },
    }),
    outputSize: undefined as number | undefined,
  },
}))

vi.mock('node:child_process', () => ({
  execFileSync: (_executable: string, args: string[]) =>
    args[0] === 'ffprobe' ? '/usr/bin/ffprobe\n' : '/usr/bin/ffmpeg\n',
  execFile: (
    executable: string,
    args: string[],
    options: { maxBuffer?: number; signal?: AbortSignal; timeout?: number },
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    calls.push({
      executable,
      args,
      maxBuffer: options.maxBuffer,
      signal: options.signal,
      timeout: options.timeout,
    })
    if (executable.includes('ffprobe')) {
      if (probe.fail) {
        callback(new Error('invalid media'), '', 'invalid media')
      } else {
        callback(null, probe.json, '')
      }
      return
    }

    fs.writeFileSync(args.at(-1) as string, Buffer.from('converted-audio'))
    if (probe.outputSize !== undefined) {
      fs.truncateSync(args.at(-1) as string, probe.outputSize)
    }
    callback(null, '', '')
  },
}))

import { extractAudioFromVideo, getAudioMetadata } from '@/lib/audio/extractor'

beforeEach(() => {
  calls.length = 0
  probe.fail = false
  probe.outputSize = undefined
})

describe('audio FFmpeg execution', () => {
  it('reads typed metadata directly from ffprobe JSON', async () => {
    const metadata = await getAudioMetadata(Buffer.from('audio'), 'audio/mp4')

    expect(metadata).toEqual({
      bitrate: 192000,
      channels: 2,
      codec: 'aac',
      duration: 7.5,
      format: 'mov,mp4,m4a',
      sampleRate: 48000,
    })
    expect(calls[0]).toMatchObject({
      executable: '/usr/bin/ffprobe',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    })
  })

  it('keeps MIME-derived input filenames inside the temporary directory', async () => {
    await getAudioMetadata(Buffer.from('audio'), 'audio/../../../../escaped')

    const inputFile = calls[0].args.at(-1)
    expect(inputFile).toBeDefined()
    expect(path.basename(inputFile as string)).toBe('input.dat')
    expect(inputFile).toMatch(/audio-ffprobe-[^/]+\/input\.dat$/)
  })

  it('normalizes MIME parameters before selecting a known extension', async () => {
    await getAudioMetadata(Buffer.from('audio'), ' Audio/MPEG; codecs=mp3 ')

    expect(calls[0].args.at(-1)).toMatch(/input\.mp3$/)
  })

  it('converts with a shell-free argument vector and preserves audio options', async () => {
    const result = await extractAudioFromVideo(Buffer.from('video'), 'video/mp4', {
      bitrate: '128',
      channels: 1,
      outputFormat: 'mp3',
      sampleRate: 44_100,
    })

    expect(result).toMatchObject({
      buffer: Buffer.from('converted-audio'),
      duration: 7.5,
      format: 'mp3',
      size: 15,
    })
    const conversion = calls.find((call) => call.executable.includes('ffmpeg'))
    expect(conversion?.args).toEqual([
      '-y',
      '-nostdin',
      '-i',
      expect.stringMatching(/input\.mp4$/),
      '-f',
      'mp3',
      '-acodec',
      'libmp3lame',
      '-ac',
      '1',
      '-ar',
      '44100',
      '-b:a',
      '128k',
      expect.stringMatching(/output\.mp3$/),
    ])
    expect(conversion).toMatchObject({ maxBuffer: 4 * 1024 * 1024, timeout: 600_000 })
  })

  it('forwards cancellation to both probing and conversion', async () => {
    const controller = new AbortController()

    await extractAudioFromVideo(Buffer.from('video'), 'video/mp4', {
      outputFormat: 'mp3',
      signal: controller.signal,
    })

    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.signal === controller.signal)).toBe(true)
  })

  it('rejects oversized converted output before reading it into memory', async () => {
    probe.outputSize = 250 * 1024 * 1024 + 1

    await expect(
      extractAudioFromVideo(Buffer.from('video'), 'video/mp4', { outputFormat: 'mp3' })
    ).rejects.toThrow(/FFmpeg audio output exceeds maximum size/)
  })

  it('returns an existing audio buffer when metadata probing fails', async () => {
    probe.fail = true
    const buffer = Buffer.from('already-audio')

    const result = await extractAudioFromVideo(buffer, 'audio/mpeg')

    expect(result).toEqual({
      buffer,
      duration: 0,
      format: 'mpeg',
      size: buffer.length,
    })
    expect(calls.some((call) => call.executable.includes('ffmpeg'))).toBe(false)
  })
})
