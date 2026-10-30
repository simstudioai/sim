import { describe, expect, it } from 'vitest'
import { resolveSimLinkTarget } from '@/lib/sim-links/destination'
import { simLinkFieldsSchema } from '@/lib/sim-links/validation'

const fields = {
  name: 'docs',
  defaultUrl: null,
  description: null,
  unlisted: false,
  restrictEdit: false,
}

function acceptsDestination(url: string, defaultUrl: string | null = null): boolean {
  return simLinkFieldsSchema.safeParse({ ...fields, url, defaultUrl }).success
}

function redirectUrl(url: string, values: string[], defaultUrl: string | null = null): string {
  const target = resolveSimLinkTarget({ url, defaultUrl }, values)
  if (target.kind !== 'redirect') throw new Error(`Expected a redirect, got ${target.kind}`)
  return target.url
}

describe('Sim link destinations', () => {
  it.each([
    'https://{*}',
    'https://{*}.example.com',
    'https://example.com{*}',
    'https://example.com@{*}',
    'https://example.com:{*}',
    '{*}',
    'https:{*}',
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://example.com/file',
    '//example.com/path',
    'example.com',
  ])('rejects %s, whose origin is not a fixed http(s) origin', (url) => {
    expect(acceptsDestination(url)).toBe(false)
  })

  it.each([
    'https://example.com/{*}',
    'https://example.com/search?q={*}',
    'https://example.com/#{*}',
    'http://intranet.example.com/browse/PROD-{*}',
  ])('accepts %s, where values fill only after the origin', (url) => {
    expect(acceptsDestination(url)).toBe(true)
  })

  it('accepts a default destination only for a variable link, and only a fixed one', () => {
    expect(acceptsDestination('https://example.com/{*}', 'https://example.com')).toBe(true)
    expect(acceptsDestination('https://example.com', 'https://example.com/other')).toBe(false)
    expect(acceptsDestination('https://example.com/{*}', 'https://example.com/{*}')).toBe(false)
    expect(acceptsDestination('https://example.com/{*}', 'javascript:alert(1)')).toBe(false)
  })

  it.each(['//evil.com', '@evil.com', '../../admin', '?x=1#y', '%2Fetc', 'a:b'])(
    'keeps the origin when a value is %s',
    (value) => {
      const url = new URL(redirectUrl('https://example.com/{*}', [value]))
      expect(url.origin).toBe('https://example.com')
      expect(url.search).toBe('')
      expect(url.hash).toBe('')
    }
  )

  it('fills each variable in order, the last taking every remaining value', () => {
    expect(redirectUrl('https://github.com/{*}/issues/{*}', ['sim', 'BUG 12', 'x'])).toBe(
      'https://github.com/sim/issues/BUG%2012/x'
    )
    expect(redirectUrl('https://example.com/search?q={*}', ['how do links work'])).toBe(
      'https://example.com/search?q=how%20do%20links%20work'
    )
  })

  it('asks for values a variable link cannot do without', () => {
    expect(
      resolveSimLinkTarget({ url: 'https://ex.com/{*}/{*}', defaultUrl: null }, ['a'])
    ).toEqual({ kind: 'missing_values', required: 2 })
    expect(resolveSimLinkTarget({ url: 'https://ex.com/{*}', defaultUrl: null }, [])).toEqual({
      kind: 'missing_values',
      required: 1,
    })
  })

  it('opens the default destination only when no value is given', () => {
    expect(redirectUrl('https://ex.com/{*}', [], 'https://ex.com/home')).toBe('https://ex.com/home')
    expect(redirectUrl('https://ex.com/{*}', ['42'], 'https://ex.com/home')).toBe(
      'https://ex.com/42'
    )
  })

  it('appends values to a plain link, keeping its query and fragment', () => {
    expect(redirectUrl('https://ex.com/docs/', ['a b'])).toBe('https://ex.com/docs/a%20b')
    expect(redirectUrl('https://ex.com/p?x=1#top', ['y', 'z'])).toBe('https://ex.com/p/y/z?x=1#top')
    expect(redirectUrl('https://ex.com/p', [])).toBe('https://ex.com/p')
  })

  it('refuses to redirect to a stored destination that is not http(s)', () => {
    expect(() =>
      resolveSimLinkTarget({ url: 'javascript:alert(1)', defaultUrl: null }, [])
    ).toThrow('not an http(s) URL')
  })
})
