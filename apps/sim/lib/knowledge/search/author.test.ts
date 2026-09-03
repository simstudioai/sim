/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { sourceAuthor } from '@/lib/knowledge/search/author'

describe('sourceAuthor', () => {
  it('prefers the sender of an email and drops the address', () => {
    expect(sourceAuthor({ From: '"Ada Lovelace" <ada@example.com>', Owner: 'Someone' })).toBe(
      'Ada Lovelace'
    )
  })

  it('falls through the author-like names in order', () => {
    expect(sourceAuthor({ Assignee: 'Grace', Owner: 'Alan' })).toBe('Alan')
    expect(sourceAuthor({ Reporter: 'Grace' })).toBe('Grace')
  })

  it('returns null when nothing names a person', () => {
    expect(sourceAuthor({ From: '<only@example.com>', Status: 'Open' })).toBeNull()
    expect(sourceAuthor({})).toBeNull()
  })
})
