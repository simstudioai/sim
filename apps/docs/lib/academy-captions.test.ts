/** @vitest-environment node */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const docsDir = path.resolve(import.meta.dirname, '..')
const academyDir = path.join(docsDir, 'content/docs/academy')
const lessons = readdirSync(academyDir, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.mdx'))
  .flatMap((file) => {
    const content = readFileSync(path.join(academyDir, file), 'utf8')
    return [...content.matchAll(/<VideoPlaceholder\b[\s\S]*?\/>/g)]
      .filter(([tag]) => /\bsrc="/.test(tag))
      .map(([tag]) => ({ file, tag }))
  })

describe('Academy captions', () => {
  it('provides a local caption track for every published lesson video', () => {
    expect(lessons.length).toBeGreaterThan(0)
    for (const { file, tag } of lessons) {
      const source = tag.match(/\bcaptionsSrc="([^"]+)"/)?.[1]
      expect(source, file).toMatch(/^\/captions\/academy\/[a-z-]+\.en\.vtt$/)
      const track = readFileSync(path.join(docsDir, 'public', source!), 'utf8')
      expect(track.startsWith('WEBVTT\n'), file).toBe(true)
      const cues = track.matchAll(
        /(\d{2}):(\d{2}):(\d{2}\.\d{3}) --> (\d{2}):(\d{2}):(\d{2}\.\d{3})\n([\s\S]*?)(?=\n\n|$)/g
      )
      let previousEnd = 0
      let cueCount = 0
      for (const cue of cues) {
        const start = Number(cue[1]) * 3600 + Number(cue[2]) * 60 + Number(cue[3])
        const end = Number(cue[4]) * 3600 + Number(cue[5]) * 60 + Number(cue[6])
        expect(start, file).toBeGreaterThanOrEqual(previousEnd)
        expect(end, file).toBeGreaterThan(start)
        expect(cue[7].trim(), file).not.toBe('')
        previousEnd = end
        cueCount++
      }
      expect(cueCount, file).toBeGreaterThan(0)
    }
  })
})
