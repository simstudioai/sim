/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { generateUniqueName } from '@/lib/core/utils/unique-name'

const simpleFormat = (attempt: number) => (attempt === 0 ? 'File' : `File ${attempt + 1}`)
const fileFormat = (attempt: number) => (attempt === 0 ? 'untitled.md' : `untitled (${attempt}).md`)

describe('generateUniqueName', () => {
  it('returns the base name when nothing is taken', () => {
    expect(generateUniqueName([], simpleFormat)).toBe('File')
  })

  it('increments the suffix until a free name is found', () => {
    expect(generateUniqueName(['untitled.md', 'untitled (1).md'], fileFormat)).toBe(
      'untitled (2).md'
    )
  })

  it('skips gaps left by deleted names', () => {
    expect(generateUniqueName(['untitled.md', 'untitled (2).md'], fileFormat)).toBe(
      'untitled (1).md'
    )
  })

  it('compares case-sensitively by default', () => {
    expect(generateUniqueName(['FILE'], simpleFormat)).toBe('File')
  })

  it('compares case-insensitively when requested', () => {
    expect(generateUniqueName(['FILE'], simpleFormat, { caseInsensitive: true })).toBe('File 2')
    expect(generateUniqueName(['file', 'File 2'], simpleFormat, { caseInsensitive: true })).toBe(
      'File 3'
    )
  })

  it('accepts any iterable of existing names', () => {
    expect(generateUniqueName(new Set(['untitled.md']), fileFormat)).toBe('untitled (1).md')
  })
})
