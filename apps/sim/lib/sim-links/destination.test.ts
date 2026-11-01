import { describe, expect, it } from 'vitest'
import { resolveSimLinkTarget } from '@/lib/sim-links/destination'
import {
  parseTypedSimLink,
  simLinkFieldsSchema,
  typedSimLinkPrefix,
} from '@/lib/sim-links/validation'

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

function redirectUrl(
  url: string,
  values: string[],
  defaultUrl: string | null = null,
  query?: string
): string {
  const target = resolveSimLinkTarget({ url, defaultUrl }, values, query)
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
    'https://{*}@corp.example.com/',
    'https://corp.example.com:{*}/path',
    '{*}',
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://example.com/file',
    '//example.com/path',
    'example.com',
    'https://\t/{*}',
    'https://\n/{*}',
    'https://example.com/\r{*}',
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
    expect(acceptsDestination('https://example.com/{*}', 'https://elsewhere.example.org')).toBe(
      false
    )
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

  it.each(['https://{*}@corp.example.com/', 'https://user:{*}@corp.example.com/'])(
    'refuses to resolve %s, whose values could move the host',
    (url) => {
      expect(() => resolveSimLinkTarget({ url, defaultUrl: null }, ['evil.com', 'x'])).toThrow(
        'no fixed http(s) origin'
      )
    }
  )

  it.each([[['..', '..', 'attacker', 'phish']], [['.']], [['a', '..']]])(
    'refuses dot segments in %j, which would climb out of the link path',
    (values) => {
      for (const url of ['https://github.com/acme/{*}', 'https://github.com/acme/handbook']) {
        expect(resolveSimLinkTarget({ url, defaultUrl: null }, values)).toEqual({
          kind: 'invalid_values',
        })
      }
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
    for (const url of ['javascript:alert(1)', 'data:text/html,hi']) {
      expect(() => resolveSimLinkTarget({ url, defaultUrl: null }, [])).toThrow(
        'no fixed http(s) origin'
      )
    }
  })

  it.each([
    [
      'https://ex.com/p',
      [],
      null,
      'a=1&b=two%20words&edit',
      'https://ex.com/p?a=1&b=two%20words&edit',
    ],
    ['https://ex.com/p', [], null, 'q=a b', 'https://ex.com/p?q=a%20b'],
    ['https://ex.com/p', [], null, 'q=&flag', 'https://ex.com/p?q=&flag'],
    ['https://ex.com/p?x=1#top', ['y'], null, 'x=2', 'https://ex.com/p/y?x=1&x=2#top'],
    [
      'https://ex.com/search?q={*}',
      ['links'],
      null,
      'page=2',
      'https://ex.com/search?q=links&page=2',
    ],
    ['https://ex.com/{*}', [], 'https://ex.com/home', 'tab=open', 'https://ex.com/home?tab=open'],
    ['https://ex.com/s?q=a%20b&p=x/y', [], null, 'n=1', 'https://ex.com/s?q=a%20b&p=x/y&n=1'],
    ['https://ex.com/p', [], null, 'q=a#b', 'https://ex.com/p?q=a%23b'],
    ['https://ex.com/p', [], null, '', 'https://ex.com/p'],
  ])('carries the typed query to %s', (url, values, defaultUrl, query, expected) => {
    expect(redirectUrl(url, values, defaultUrl, query)).toBe(expected)
  })
})

describe('typedSimLinkPrefix', () => {
  it.each([
    ['', ''],
    ['sim/Team-Docs/ABC-1?x=1', 'teamdocs'],
  ])('reads the name prefix of %j', (typed, prefix) => {
    expect(typedSimLinkPrefix(typed)).toBe(prefix)
  })

  it.each(['...', '--', '.:-'])('has no prefix for %j, which no link name can match', (typed) => {
    expect(typedSimLinkPrefix(typed)).toBeNull()
  })
})

describe('parseTypedSimLink', () => {
  it.each([
    [' onboarding', 'onboarding'],
    ['onboarding ', 'onboarding'],
    ['onboarding ).', 'onboarding'],
  ])('drops the spaces around %j, which no name can hold', (name, trimmed) => {
    expect(parseTypedSimLink([name]).name).toBe(trimmed)
  })

  it('trims the name but keeps values verbatim when values follow', () => {
    expect(parseTypedSimLink([' jira ', ' ABC-1 '])).toEqual({ name: 'jira', values: [' ABC-1 '] })
  })

  it.each([
    ['onboarding).', 'onboarding'],
    ['onboarding,', 'onboarding'],
    ['onboarding”', 'onboarding'],
    ["onboarding'", 'onboarding'],
    ['onboarding]>', 'onboarding'],
    ['q4-goals?!', 'q4-goals'],
  ])('drops the prose punctuation pasted after %s', (name, trimmed) => {
    expect(parseTypedSimLink([name])).toEqual({ name: trimmed, values: [] })
  })

  it.each(['onboarding', 'q4-goals', 'a~b', 'x_'])('keeps %s, which has none', (name) => {
    expect(parseTypedSimLink([name]).name).toBe(name)
  })

  it('keeps a name that is nothing but punctuation, so it fails validation as typed', () => {
    expect(parseTypedSimLink(['...']).name).toBe('...')
  })

  it('keeps a name and its values verbatim when values follow, since a value may end in anything', () => {
    expect(parseTypedSimLink(['jira', 'ABC-1).'])).toEqual({ name: 'jira', values: ['ABC-1).'] })
  })

  it('reads no name from an empty path', () => {
    expect(parseTypedSimLink([])).toEqual({ name: '', values: [] })
  })
})
