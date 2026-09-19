import { describe, expect, it } from 'vitest'
import {
  estimateTrigramKeys,
  iterateFileSearchChunks,
  planFileSearchIndex,
} from '@/lib/workspace-files/search/index-plan'

const signal = new AbortController().signal

describe('file search chunk packing', () => {
  it.each(['', 'abc', '\n\nabc\r\n', `${'x'.repeat(8192)}\nlast`, `${'🙂'.repeat(9000)}\r\nlast`])(
    'preserves every nonempty logical line and UTF-8 boundaries',
    (text) => {
      const plan = planFileSearchIndex({ text, partial: false }, signal)
      const restored = new Map<number, string>()
      for (const chunk of iterateFileSearchChunks(plan, signal)) {
        expect(Buffer.byteLength(chunk.content)).toBeLessThanOrEqual(8192)
        expect(chunk.content).not.toContain('\ufffd')
        if (chunk.fragment)
          restored.set(
            chunk.lineStart,
            (restored.get(chunk.lineStart) ?? '') + [...chunk.content].slice(chunk.overlap).join('')
          )
        else
          chunk.content.split('\n').forEach((line, offset) => {
            if (line) restored.set(chunk.lineStart + offset, line)
          })
      }
      const expected = new Map<number, string>()
      text
        .replace(/\r(?=\n|$)/g, '')
        .split('\n')
        .forEach((line, index) => {
          if (line) expected.set(index + 1, line)
        })
      expect(restored).toEqual(expected)
    }
  )
  it.each([
    ['', 1],
    ['abc', 1],
    ['abc\n', 1],
    ['abc\r\n', 1],
    ['\n', 1],
    ['a\n\n', 2],
    ['a\nb', 2],
  ])('counts visible lines for %j', (text, expected) => {
    expect(planFileSearchIndex({ text, partial: false }, signal).lineCount).toBe(expected)
  })
  it('rejects incomplete extraction before producing any chunks', () => {
    expect(() => planFileSearchIndex({ text: 'prefix', partial: true }, signal)).toThrow(
      'incomplete_extraction'
    )
  })
  it('rejects oversize complete text without publishing a prefix', () => {
    expect(() =>
      planFileSearchIndex({ text: 'x'.repeat(25 * 1024 * 1024 + 1), partial: false }, signal)
    ).toThrow('extracted_text_too_large')
  })
  it.each([
    ['a binary stored as base64 text', 'iVBORw0KGgo'.repeat(10_000)],
    [
      'an SVG embedding a data URI',
      `<svg><title>sheet</title><image href="data:image/jpeg;base64,${'/9j/4AAQ'.repeat(8000)}"/></svg>`,
    ],
    ['space-separated runs at the minimum run length', `${'aB3'.repeat(86)} `.repeat(500)],
    ['base64 wrapped at 76 columns', `${'aB3d'.repeat(19)}\n`.repeat(2000)],
    [
      'a PEM-style block wrapped at 64 columns with CRLF',
      `-----BEGIN DATA-----\r\n${`${'Qk9z'.repeat(16)}\r\n`.repeat(2000)}-----END DATA-----\r\n`,
    ],
  ])('excludes %s before producing any chunks', (_, text) => {
    expect(() => planFileSearchIndex({ text, partial: false }, signal)).toThrow('encoded_content')
  })
  it.each([
    [
      'a small config carrying one signature',
      `{"$schema":"https://example.com/schema.json","signature":"${'Qk9'.repeat(200)}"}`,
    ],
    [
      'a lockfile whose integrity hashes are short runs',
      `"pkg": ["pkg@1.0.0", "", {}, "sha512-${'Ab1+'.repeat(22)}=="],\n\n`.repeat(2000),
    ],
    ['space-separated runs just short of the run length', `${'aB3'.repeat(85)} `.repeat(500)],
    ['one short token per line', `${'aB3d'.repeat(10)}\n`.repeat(5000)],
    ['lines that each end in a long hash', `checksum ${'aB3d'.repeat(19)}\n`.repeat(2000)],
    ['an unwrapped DNA sequence', `>chr1\n${'ACGT'.repeat(20_000)}\n`],
    ['a hex digest dump', `${'deadbeef0123'.repeat(5000)}\n`],
    [
      'prose that embeds an encoded payload smaller than itself',
      `${'Quarterly results and notes. '.repeat(5000)}${'aB3d'.repeat(10_000)}`,
    ],
  ])('keeps %s searchable', (_, text) => {
    expect(() => planFileSearchIndex({ text, partial: false }, signal)).not.toThrow()
  })
  it.each([
    ['cat', 4],
    ['Cat CAT cat', 4],
    ['foo|bar', 8],
    ['a', 2],
    ['', 0],
    ['--- ___ ...', 0],
  ])('estimates pg_trgm keys for %j', (text, expected) => {
    expect(estimateTrigramKeys(text)).toBe(expected)
  })
  it('stops iteration when aborted', () => {
    const controller = new AbortController()
    const chunks = iterateFileSearchChunks(
      planFileSearchIndex({ text: 'abc\n'.repeat(10000), partial: false }, signal),
      controller.signal
    )
    expect(chunks.next().done).toBe(false)
    controller.abort()
    expect(() => chunks.next()).toThrow()
  })
})
