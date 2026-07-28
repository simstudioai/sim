/**
 * @vitest-environment node
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildDrawtextFilter, escapeFilterValue } from '@/lib/media/ffmpeg'

/** Metacharacters that must survive both filtergraph tokenizer passes. */
const METACHARACTER_CASES: Array<[string, string]> = [
  ['a:b', 'a\\\\\\:b'],
  ["a'b", "a\\\\\\'b"],
  ['a\\b', 'a\\\\\\\\b'],
  ['a,b', 'a\\\\\\,b'],
  ['a;b', 'a\\\\\\;b'],
  ['a[b]', 'a\\\\\\[b\\\\\\]'],
  ['a=b', 'a\\\\\\=b'],
]

/**
 * FFmpeg is not available in CI, so these assert the generated filtergraph
 * string and the on-disk text file rather than the rendered output. The
 * `runs through real ffmpeg` block below covers the grammar end to end where a
 * binary exists.
 */
describe('escapeFilterValue', () => {
  it.concurrent.each(METACHARACTER_CASES)('escapes %j at both levels', (input, expected) => {
    expect(escapeFilterValue(input)).toBe(expected)
  })

  it.concurrent('leaves ordinary paths and newlines untouched', () => {
    expect(escapeFilterValue('/tmp/media-ffmpeg-abc123/drawtext.txt')).toBe(
      '/tmp/media-ffmpeg-abc123/drawtext.txt'
    )
    expect(escapeFilterValue('a\nb')).toBe('a\nb')
  })

  it.concurrent('never leaves a bare quote that could open a quoted section', () => {
    expect(escapeFilterValue("x':y=1")).not.toMatch(/(^|[^\\])'/)
  })
})

describe('buildDrawtextFilter', () => {
  let dir: string

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-test-'))
  })

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('routes the text through textfile and never inlines it', async () => {
    const { filter, textPath } = await buildDrawtextFilter(dir, 'Hello world', 'bottom')

    expect(filter.startsWith('drawtext=')).toBe(true)
    expect(filter).toContain(`textfile=${textPath}`)
    expect(filter).not.toContain('Hello world')
    expect(filter).not.toContain(':text=')
    expect(await fs.readFile(textPath, 'utf-8')).toBe('Hello world')
  })

  it('writes a distinct text file per call so two overlays cannot clobber each other', async () => {
    const first = await buildDrawtextFilter(dir, 'first overlay', 'bottom')
    const second = await buildDrawtextFilter(dir, 'second overlay', 'bottom')

    expect(second.textPath).not.toBe(first.textPath)
    expect(await fs.readFile(first.textPath, 'utf-8')).toBe('first overlay')
    expect(await fs.readFile(second.textPath, 'utf-8')).toBe('second overlay')
  })

  it('disables %{} expansion so text renders literally', async () => {
    const { filter, textPath } = await buildDrawtextFilter(dir, '100% of %{pts}', 'bottom')

    expect(filter).toContain('expansion=none')
    expect(await fs.readFile(textPath, 'utf-8')).toBe('100% of %{pts}')
  })

  it('cannot introduce a new filter option from the text value', async () => {
    const injection = "a':x=90:fontcolor=red,drawbox=0:0:100:100:red\\:,[in]scale=2[out];"
    const { filter, textPath } = await buildDrawtextFilter(dir, injection, 'bottom')

    const options = filter.replace(/^drawtext=/, '').split(':')
    const optionNames = options.map((option) => option.split('=')[0])

    expect(optionNames).toEqual([
      'textfile',
      'expansion',
      'fontcolor',
      'fontsize',
      'box',
      'boxcolor',
      'boxborderw',
      'x',
      'y',
    ])
    expect(filter).not.toContain('drawbox')
    expect(filter).not.toContain('fontcolor=red')
    expect(filter).toContain('fontcolor=white')
    expect(filter).not.toContain('x=90')
    expect(await fs.readFile(textPath, 'utf-8')).toBe(injection)
  })

  it.each([
    ['single quote', "it's here"],
    ['colon', 'ratio 16:9'],
    ['backslash', 'C:\\path\\to'],
    ['comma', 'a, b, c'],
    ['newline', 'line one\nline two'],
    ['semicolon and brackets', 'a;b[c]d'],
    ['textfile option injection', 'x:textfile=/etc/passwd'],
    ['fontfile option injection', 'x:fontfile=/etc/shadow'],
  ])('writes %s verbatim to the text file', async (_label, text) => {
    const { filter, textPath } = await buildDrawtextFilter(dir, text, 'center')

    expect(await fs.readFile(textPath, 'utf-8')).toBe(text)
    expect(filter.replace(/^drawtext=/, '').split(':').length).toBe(9)
    expect(filter).toContain('x=(w-text_w)/2')
    expect(filter).toContain('y=(h-text_h)/2')
    expect(filter.match(/textfile=/g)?.length).toBe(1)
  })

  it('escapes a temp dir path containing filtergraph metacharacters', async () => {
    const trickyDir = path.join(dir, "a:b'c[d]")
    await fs.mkdir(trickyDir, { recursive: true })

    const { filter, textPath } = await buildDrawtextFilter(trickyDir, 'text', 'top')

    // The literal expected escaping, not a restatement of the implementation:
    // each metacharacter survives as three backslashes plus itself.
    const escapedSegment = String.raw`a\\\:b\\\'c\\\[d\\\]`
    expect(filter).toContain(`textfile=${dir}/${escapedSegment}/${path.basename(textPath)}`)
    expect(filter).not.toContain(`textfile=${trickyDir}/`)
  })

  it('falls back to the bottom position for an unknown position', async () => {
    const { filter } = await buildDrawtextFilter(dir, 'text', 'nowhere')

    expect(filter).toContain('y=h*0.86')
  })
})

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Renders one frame against the real binary so the escaping is validated by
 * FFmpeg's own parser rather than by a restatement of it.
 */
describe.skipIf(!hasFfmpeg())('runs through real ffmpeg', () => {
  let base: string

  beforeAll(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-real-'))
  })

  afterAll(async () => {
    await fs.rm(base, { recursive: true, force: true })
  })

  it.each([
    ['plain', 'plain'],
    ['quote', "a'b"],
    ['colon', 'a:b'],
    ['backslash', 'a\\b'],
    ['comma', 'a,b'],
    ['semicolon', 'a;b'],
    ['equals', 'a=b'],
    ['brackets', 'a[b]c'],
    ['newline', 'a\nb'],
    ['every metacharacter', "all'-:,;=[]\\-\nmix"],
  ])('reads the text file from a dir containing %s', async (_label, name) => {
    const dir = path.join(base, name)
    await fs.mkdir(dir, { recursive: true })
    const { filter } = await buildDrawtextFilter(dir, 'hello', 'bottom')

    expect(() =>
      execFileSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=64x64:d=0.04',
          '-vf',
          filter,
          '-frames:v',
          '1',
          '-f',
          'null',
          '-',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
    ).not.toThrow()
  })
})
