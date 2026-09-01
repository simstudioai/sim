import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { FILE_SEARCH_SEGMENT_CHARS } from '@/lib/workspace-files/search/constants'
import { compileFileSearchPattern } from '@/lib/workspace-files/search/pattern'
import {
  createFileSearchPreview,
  iterateLogicalLines,
  segmentLogicalLine,
  truncateUtf8ToBytes,
} from '@/lib/workspace-files/search/text'

const literal = (query: string) => compileFileSearchPattern(query, 'exact')

describe('workspace file search text utilities', () => {
  it('normalizes CRLF and preserves one-based logical line numbers', () => {
    expect([...iterateLogicalLines('first\r\nsecond\n')]).toEqual([
      { lineNumber: 1, text: 'first' },
      { lineNumber: 2, text: 'second' },
      { lineNumber: 3, text: '' },
    ])
  })

  it('splits a logical line into one segment exactly when it fits the segment width', () => {
    const fits = { lineNumber: 1, text: 'a'.repeat(FILE_SEARCH_SEGMENT_CHARS) }
    const overflows = { lineNumber: 1, text: 'a'.repeat(FILE_SEARCH_SEGMENT_CHARS + 1) }

    expect([...segmentLogicalLine(fits)]).toHaveLength(1)
    expect([...segmentLogicalLine(overflows)].length).toBeGreaterThan(1)
  })

  it('creates overlapping segments that preserve boundary matches', () => {
    const segments = [...segmentLogicalLine({ lineNumber: 3, text: 'abcdefghijklmnop' }, 10, 4)]
    expect(segments.map(({ content }) => content)).toEqual(['abcdefghij', 'ghijklmnop'])
    expect(segments[1]).toMatchObject({ lineNumber: 3, segmentNumber: 1, segmentStart: 6 })
    expect(segments[0].content).toContain('ghij')
    expect(segments[1].content).toContain('ghij')
  })

  it('returns a match-centered UTF-8-safe bounded preview', () => {
    const line = `${'🙂'.repeat(800)}needle${'é'.repeat(800)}`
    const preview = createFileSearchPreview(line, literal('needle'))
    expect(preview).toContain('needle')
    expect(preview.startsWith('…')).toBe(true)
    expect(preview.endsWith('…')).toBe(true)
    expect(Buffer.byteLength(preview, 'utf8')).toBeLessThanOrEqual(2048)
    expect(preview).not.toContain('�')
  })

  it('maps case-folded offsets back to the original line', () => {
    const line = `${'İ'.repeat(1200)}needle${'x'.repeat(1200)}`
    const preview = createFileSearchPreview(line, literal('needle'))

    expect(preview).toContain('needle')
    expect(Buffer.byteLength(preview, 'utf8')).toBeLessThanOrEqual(2048)
  })

  it('centers previews with locale-independent case folding', () => {
    const localeLowerCase = vi
      .spyOn(String.prototype, 'toLocaleLowerCase')
      .mockImplementation(function (this: string) {
        return String(this).replaceAll('I', 'ı').toLowerCase()
      })

    try {
      const line = `${'x'.repeat(1500)}aIb${'y'.repeat(1500)}`
      const preview = createFileSearchPreview(line, literal('aib'), 128)
      expect(preview).toContain('aIb')
    } finally {
      localeLowerCase.mockRestore()
    }
  })

  it('shows omitted logical-line content beyond the selected segment', () => {
    expect(
      createFileSearchPreview('needle and nearby text', literal('needle'), 2048, {
        prefixOmitted: true,
        suffixOmitted: true,
      })
    ).toBe('…needle and nearby text…')
  })

  /**
   * A regex match runs to wherever the pattern takes it, so `abc.*` on a long
   * line produces a match larger than the whole preview budget.
   */
  it('marks a preview whose match alone overruns the budget as truncated', () => {
    const line = `head ${'x'.repeat(500)}abc${'y'.repeat(4000)} tail`
    const start = line.indexOf('abc')
    const preview = createFileSearchPreview(
      line,
      compileFileSearchPattern('abc.*', 'regex'),
      2048,
      {
        matchRange: { start, end: line.length },
      }
    )

    expect(Buffer.byteLength(preview, 'utf8')).toBeLessThanOrEqual(2048)
    expect(preview.endsWith('…')).toBe(true)
    expect(preview).toContain('abc')
    expect(preview).not.toContain('\uFFFD')
  })

  it('truncates extracted text on a UTF-8 boundary', () => {
    const truncated = truncateUtf8ToBytes('abc🙂def', 6)
    expect(truncated).toBe('abc')
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(6)
  })
})
