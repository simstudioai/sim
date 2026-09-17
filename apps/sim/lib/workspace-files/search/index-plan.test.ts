import { describe, expect, it } from 'vitest'
import {
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
