/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { escapeCql } from '@/connectors/confluence/confluence'

describe('escapeCql', () => {
  it.concurrent('returns plain strings unchanged', () => {
    expect(escapeCql('Engineering')).toBe('Engineering')
  })

  it.concurrent('escapes double quotes', () => {
    expect(escapeCql('say "hello"')).toBe('say \\"hello\\"')
  })

  it.concurrent('escapes backslashes', () => {
    expect(escapeCql('path\\to\\file')).toBe('path\\\\to\\\\file')
  })

  it.concurrent('escapes backslashes before quotes', () => {
    expect(escapeCql('a\\"b')).toBe('a\\\\\\"b')
  })

  it.concurrent('handles empty string', () => {
    expect(escapeCql('')).toBe('')
  })

  it.concurrent('leaves other special chars unchanged', () => {
    expect(escapeCql("it's a test & <tag>")).toBe("it's a test & <tag>")
  })
})
