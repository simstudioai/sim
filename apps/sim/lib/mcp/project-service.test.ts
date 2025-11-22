import { describe, expect, it } from 'vitest'
import { normalizeProjectSlug } from '@/lib/mcp/project-slug'

describe('normalizeProjectSlug', () => {
  it('converts text to kebab-case and trims invalid characters', () => {
    expect(normalizeProjectSlug('My Cool Server')).toBe('my-cool-server')
    expect(normalizeProjectSlug('  Spaces   Everywhere  ')).toBe('spaces-everywhere')
    expect(normalizeProjectSlug('Symbols!@#and$$$stuff')).toBe('symbols-and-stuff')
  })

  it('falls back to a default slug when input is empty', () => {
    expect(normalizeProjectSlug('')).toBe('server')
    expect(normalizeProjectSlug('***')).toBe('server')
  })

  it('limits slug length to avoid oversized identifiers', () => {
    const longName = 'x'.repeat(200)
    expect(normalizeProjectSlug(longName).length).toBeLessThanOrEqual(64)
  })
})
