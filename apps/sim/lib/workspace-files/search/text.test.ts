import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  createFileSearchPreview,
  escapeFileSearchLikePattern,
  isFileSearchCaseSensitive,
  iterateLogicalLines,
  segmentLogicalLine,
  truncateUtf8ToBytes,
} from '@/lib/workspace-files/search/text'

describe('workspace file search text utilities', () => {
  it('implements Unicode smart-case and escapes LIKE metacharacters', () => {
    expect(isFileSearchCaseSensitive('résumé')).toBe(false)
    expect(isFileSearchCaseSensitive('Résumé')).toBe(true)
    expect(isFileSearchCaseSensitive('東京A')).toBe(true)
    expect(escapeFileSearchLikePattern('100%_done\\')).toBe('100\\%\\_done\\\\')
  })

  it('normalizes CRLF and preserves one-based logical line numbers', () => {
    expect([...iterateLogicalLines('first\r\nsecond\n')]).toEqual([
      { lineNumber: 1, text: 'first' },
      { lineNumber: 2, text: 'second' },
      { lineNumber: 3, text: '' },
    ])
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
    const preview = createFileSearchPreview(line, 'needle', false)
    expect(preview).toContain('needle')
    expect(preview.startsWith('…')).toBe(true)
    expect(preview.endsWith('…')).toBe(true)
    expect(Buffer.byteLength(preview, 'utf8')).toBeLessThanOrEqual(2048)
    expect(preview).not.toContain('�')
  })

  it('maps case-folded offsets back to the original line', () => {
    const line = `${'İ'.repeat(1200)}needle${'x'.repeat(1200)}`
    const preview = createFileSearchPreview(line, 'needle', false)

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
      const line = `${'x'.repeat(1500)}I${'y'.repeat(1500)}`
      const preview = createFileSearchPreview(line, 'i', false, 128)
      expect(preview).toContain('I')
    } finally {
      localeLowerCase.mockRestore()
    }
  })

  it('shows omitted logical-line content beyond the selected segment', () => {
    expect(
      createFileSearchPreview('needle and nearby text', 'needle', false, 2048, {
        prefixOmitted: true,
        suffixOmitted: true,
      })
    ).toBe('…needle and nearby text…')
  })

  it('truncates extracted text on a UTF-8 boundary', () => {
    const truncated = truncateUtf8ToBytes('abc🙂def', 6)
    expect(truncated).toBe('abc')
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(6)
  })
})
