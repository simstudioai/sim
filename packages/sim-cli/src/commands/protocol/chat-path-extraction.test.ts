import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractAttachmentPaths } from './chat-attachments.js'

let dir: string
let file: string
let spaced: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-extract-'))
  file = join(dir, 'report.pdf')
  spaced = join(dir, 'my report.pdf')
  writeFileSync(file, 'x')
  writeFileSync(spaced, 'x')
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('extractAttachmentPaths', () => {
  it('pulls a path out of surrounding prose and leaves a tag', async () => {
    const result = await extractAttachmentPaths(`summarize ${file} for me`)
    expect(result).toEqual({ paths: [file], text: 'summarize [File #1] for me' })
  })

  it('handles a path at the start or end of the line', async () => {
    expect((await extractAttachmentPaths(`${file} what is this`))?.text).toBe(
      '[File #1] what is this'
    )
    expect((await extractAttachmentPaths(`look at ${file}`))?.text).toBe('look at [File #1]')
  })

  it('numbers multiple attachments in order', async () => {
    const result = await extractAttachmentPaths(`diff ${file} against ${file}`)
    expect(result?.text).toBe('diff [File #1] against [File #2]')
    expect(result?.paths).toHaveLength(2)
  })

  it('understands quoted and escaped paths with spaces', async () => {
    expect((await extractAttachmentPaths(`read "${spaced}" please`))?.paths).toEqual([spaced])
    const escaped = spaced.replace(/ /gu, '\\ ')
    expect((await extractAttachmentPaths(`read ${escaped} please`))?.paths).toEqual([spaced])
  })

  it('leaves path-like prose alone when the file does not exist', async () => {
    expect(await extractAttachmentPaths('check /nope/missing.png please')).toBeNull()
    expect(await extractAttachmentPaths('see src/does-not-exist.ts line 4')).toBeNull()
  })

  it('attaches a relative path that resolves against the working directory', async () => {
    expect((await extractAttachmentPaths('read src/index.ts'))?.paths).toEqual(['src/index.ts'])
  })

  it('returns null for a message with no paths', async () => {
    expect(await extractAttachmentPaths('hello there')).toBeNull()
  })

  it('takes a whole line that is one unescaped path with spaces', async () => {
    expect((await extractAttachmentPaths(`  ${spaced}  `))?.paths).toEqual([spaced])
  })

  it('stops at the per-turn attachment limit and leaves the rest as text', async () => {
    const line = Array.from({ length: 6 }, () => file).join(' ')
    const result = await extractAttachmentPaths(line)
    expect(result?.paths).toHaveLength(5)
    expect(result?.text).toBe(`[File #1] [File #2] [File #3] [File #4] [File #5] ${file}`)
  })

  it('keeps the line breaks in a multi-line message', async () => {
    const result = await extractAttachmentPaths(`first line\nsummarize ${file}\nlast line`)
    expect(result?.text).toBe('first line\nsummarize [File #1]\nlast line')
  })

  it('does not throw on an unclosed quote', async () => {
    expect(await extractAttachmentPaths(`read "${file}`)).toBeNull()
  })
})
