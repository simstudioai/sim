import { describe, expect, it } from 'vitest'
import { normalizeOrigin, normalizeUsername } from '@/main/browser-credentials/origin'

describe('normalizeOrigin', () => {
  it.each([
    ['https://example.com/login?next=1', 'https://example.com'],
    ['https://EXAMPLE.com', 'https://example.com'],
    ['https://example.com:443/', 'https://example.com'],
    ['http://example.com:80/', 'http://example.com'],
    ['https://example.com:8443/', 'https://example.com:8443'],
  ])('reduces %s to %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected)
  })

  it.each([
    ['file:///etc/passwd'],
    ['data:text/html,<h1>hi'],
    ['javascript:alert(1)'],
    ['about:blank'],
    ['android://token@com.example/'],
    ['not a url'],
    [''],
  ])('refuses %s, which cannot host a credential', (input) => {
    expect(normalizeOrigin(input)).toBeNull()
  })
})

describe('exact-origin identity', () => {
  it('reduces only identical sites to the same origin', () => {
    // Each of these is a different site as far as filling is concerned.
    // Widening any of them is how a password reaches somewhere it should not.
    expect(normalizeOrigin('https://example.com')).not.toBe(
      normalizeOrigin('https://sub.example.com')
    )
    expect(normalizeOrigin('https://accounts.google.com')).not.toBe(
      normalizeOrigin('https://google.com')
    )
    expect(normalizeOrigin('https://example.com')).not.toBe(normalizeOrigin('http://example.com'))
    expect(normalizeOrigin('https://example.com')).not.toBe(
      normalizeOrigin('https://example.com:8443')
    )
    expect(normalizeOrigin('https://example.com/a')).toBe(normalizeOrigin('https://EXAMPLE.com/b'))
  })
})

describe('normalizeUsername', () => {
  it('trims but preserves case', () => {
    expect(normalizeUsername('  Ada ')).toBe('Ada')
    expect(normalizeUsername('ada')).not.toBe(normalizeUsername('Ada'))
  })
})
