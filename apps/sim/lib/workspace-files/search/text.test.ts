import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { compileFileSearchPattern } from '@/lib/workspace-files/search/pattern'
import { createFileSearchPreview } from '@/lib/workspace-files/search/text'

const literal = (query: string) => compileFileSearchPattern(query, 'exact')

describe('workspace file search text utilities', () => {
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

  it('shows omitted logical-line content beyond the selected preview', () => {
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
})
