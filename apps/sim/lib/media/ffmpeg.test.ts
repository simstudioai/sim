/**
 * @vitest-environment node
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { capturedVideoFilters, capturedCaptions } = vi.hoisted(() => ({
  capturedVideoFilters: [] as string[],
  capturedCaptions: [] as string[],
}))

vi.mock('node:child_process', () => ({
  execSync: () => '/usr/bin/ffmpeg\n',
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
      fs.writeFileSync(outputPath, Buffer.from('stub-output'))
      handlers.end?.()
      return cmd
    }
    return cmd
  }
  const ffmpeg = ((_input?: unknown, options?: { cwd?: string }) =>
    makeCommand(options?.cwd)) as unknown as Record<string, unknown> & (() => unknown)
  ;(ffmpeg as Record<string, unknown>).setFfmpegPath = () => {}
  ;(ffmpeg as Record<string, unknown>).ffprobe = (
    _path: string,
    cb: (err: unknown, data: unknown) => void
  ) => cb(null, { streams: [], format: {} })
  return { default: ffmpeg }
})

import { runFfmpegOperation } from '@/lib/media/ffmpeg'

const videoInput = {
  buffer: Buffer.from('fake-video-bytes'),
  mimeType: 'video/mp4',
  name: 'clip.mp4',
}

describe('runFfmpegOperation add_text filtergraph injection', () => {
  beforeEach(() => {
    capturedVideoFilters.length = 0
    capturedCaptions.length = 0
  })

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
