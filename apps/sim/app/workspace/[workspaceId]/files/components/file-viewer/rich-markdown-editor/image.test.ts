/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { resolveDisplaySrc } from './image'

describe('resolveDisplaySrc', () => {
  it('rewrites an in-app workspace file path to its serving endpoint (display only)', () => {
    expect(resolveDisplaySrc('/workspace/W1/files/F123')).toBe('/api/files/view/F123')
    expect(resolveDisplaySrc('/workspace/any-ws-id/files/abc-def')).toBe('/api/files/view/abc-def')
  })

  it('leaves absolute and non-workspace URLs untouched', () => {
    expect(resolveDisplaySrc('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
    expect(resolveDisplaySrc('http://localhost/workspace/W1/files/F1')).toBe(
      'http://localhost/workspace/W1/files/F1'
    )
    expect(resolveDisplaySrc('/other/path/files/x')).toBe('/other/path/files/x')
    expect(resolveDisplaySrc('relative/image.png')).toBe('relative/image.png')
  })

  it('passes through empty/undefined and unparseable values', () => {
    expect(resolveDisplaySrc(undefined)).toBeUndefined()
    expect(resolveDisplaySrc('')).toBe('')
    expect(resolveDisplaySrc('/workspace/W1/files/')).toBe('/workspace/W1/files/')
  })
})
