import type { BrowserKnownSession } from '@sim/browser-protocol'
import type { BrowserCredentialMetadata } from '@sim/desktop-bridge'
import { describe, expect, it } from 'vitest'
import {
  mergeSuggestionSources,
  moveActiveIndex,
  rankSuggestions,
  type UrlSuggestion,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/url-suggestions'

function session(
  hostname: string,
  lastObservedAt = '2026-01-01T00:00:00.000Z'
): BrowserKnownSession {
  return { hostname, evidence: 'cookie', lastObservedAt } as BrowserKnownSession
}

function credential(
  origin: string,
  overrides: Partial<BrowserCredentialMetadata> = {}
): BrowserCredentialMetadata {
  return {
    id: origin,
    origin,
    username: 'ada',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'chrome',
    ...overrides,
  } as BrowserCredentialMetadata
}

function suggestion(hostname: string, lastSeenAt: number, name?: string): UrlSuggestion {
  return { hostname, url: `https://${hostname}`, lastSeenAt, name }
}

const hostnames = (results: UrlSuggestion[]) => results.map((result) => result.hostname)

describe('mergeSuggestionSources', () => {
  it('suggests hosts the browser is signed into', () => {
    const merged = mergeSuggestionSources([session('github.com')], [])

    expect(merged).toEqual([
      {
        hostname: 'github.com',
        url: 'https://github.com',
        lastSeenAt: Date.parse('2026-01-01T00:00:00.000Z'),
      },
    ])
  })

  it('suggests hosts with a saved password, carrying the imported icon', () => {
    const merged = mergeSuggestionSources(
      [],
      [credential('https://news.ycombinator.com', { icon: 'data:image/png;base64,AAA' })]
    )

    expect(merged[0]).toMatchObject({
      hostname: 'news.ycombinator.com',
      url: 'https://news.ycombinator.com',
      icon: 'data:image/png;base64,AAA',
    })
  })

  it('lists a host present in both sources once', () => {
    const merged = mergeSuggestionSources(
      [session('github.com')],
      [credential('https://github.com')]
    )

    expect(merged).toHaveLength(1)
  })

  it('keeps the imported icon when the host is also signed in', () => {
    const merged = mergeSuggestionSources(
      [session('github.com')],
      [credential('https://github.com', { icon: 'data:image/png;base64,BBB' })]
    )

    expect(merged[0].icon).toBe('data:image/png;base64,BBB')
  })

  it('keeps the most recent evidence when a host appears twice', () => {
    const merged = mergeSuggestionSources(
      [session('github.com', '2026-03-01T00:00:00.000Z')],
      [credential('https://github.com', { updatedAt: '2026-01-01T00:00:00.000Z' })]
    )

    expect(merged[0].lastSeenAt).toBe(Date.parse('2026-03-01T00:00:00.000Z'))
  })

  it('distinguishes hosts that differ only by subdomain', () => {
    const merged = mergeSuggestionSources([session('mail.google.com'), session('google.com')], [])

    expect(hostnames(merged).sort()).toEqual(['google.com', 'mail.google.com'])
  })

  it('ignores a credential whose origin cannot be parsed', () => {
    const merged = mergeSuggestionSources([], [credential('not a url')])

    expect(merged).toEqual([])
  })

  it('survives an unparseable timestamp rather than ranking on NaN', () => {
    const merged = mergeSuggestionSources([session('github.com', 'whenever')], [])

    expect(merged[0].lastSeenAt).toBe(0)
  })
})

describe('mergeSuggestionSources with an imported directory', () => {
  it('names a host from what the import learned', () => {
    const merged = mergeSuggestionSources(
      [session('mail.google.com')],
      [],
      [{ hostname: 'mail.google.com', name: 'Gmail', icon: 'data:png' }]
    )

    expect(merged[0]).toMatchObject({ name: 'Gmail', icon: 'data:png' })
  })

  it('leaves a host unnamed when the import never saw it', () => {
    const merged = mergeSuggestionSources([session('intranet.local')], [], [])

    expect(merged[0].name).toBeUndefined()
  })

  it('prefers a credential’s own icon over the directory’s', () => {
    const merged = mergeSuggestionSources(
      [],
      [credential('https://github.com', { icon: 'data:from-vault' })],
      [{ hostname: 'github.com', name: 'GitHub', icon: 'data:from-directory' }]
    )

    expect(merged[0]).toMatchObject({ name: 'GitHub', icon: 'data:from-vault' })
  })
})

describe('rankSuggestions', () => {
  const corpus = [
    suggestion('github.com', 300),
    suggestion('gitlab.com', 200),
    suggestion('news.ycombinator.com', 100),
  ]

  it('lists the most recent hosts before anything is typed', () => {
    expect(hostnames(rankSuggestions(corpus, ''))).toEqual([
      'github.com',
      'gitlab.com',
      'news.ycombinator.com',
    ])
  })

  it('treats a whitespace-only query as nothing typed', () => {
    expect(hostnames(rankSuggestions(corpus, '   '))).toHaveLength(3)
  })

  it('narrows to what was typed', () => {
    expect(hostnames(rankSuggestions(corpus, 'gitl'))).toEqual(['gitlab.com'])
  })

  it('matches across the dot, which the palette matcher treats as a boundary', () => {
    expect(hostnames(rankSuggestions(corpus, 'git.co'))).toContain('github.com')
  })

  it('drops hosts that do not match at all', () => {
    expect(rankSuggestions(corpus, 'zzzz')).toEqual([])
  })

  it('finds a site by the name its own browser gave it', () => {
    const named = [suggestion('mail.google.com', 100, 'Gmail'), suggestion('github.com', 200)]

    expect(hostnames(rankSuggestions(named, 'gmail'))).toEqual(['mail.google.com'])
  })

  it('matches an imported name regardless of case', () => {
    const named = [suggestion('mail.google.com', 100, 'Gmail')]

    expect(hostnames(rankSuggestions(named, 'GMail'))).toEqual(['mail.google.com'])
  })

  it('falls back to the hostname for a site the import never named', () => {
    const unnamed = [suggestion('mail.google.com', 100)]

    expect(hostnames(rankSuggestions(unnamed, 'google'))).toEqual(['mail.google.com'])
    expect(rankSuggestions(unnamed, 'gmail')).toEqual([])
  })

  it('still matches a host by its own labels', () => {
    const corpus = [suggestion('news.ycombinator.com', 100)]

    expect(hostnames(rankSuggestions(corpus, 'ycombinator'))).toEqual(['news.ycombinator.com'])
  })

  it('does not let one site’s name pull in another', () => {
    const corpus = [suggestion('mail.google.com', 100, 'Gmail'), suggestion('github.com', 200)]

    expect(hostnames(rankSuggestions(corpus, 'gmail'))).not.toContain('github.com')
  })

  it('breaks equal matches by recency', () => {
    const tied = [suggestion('example.com', 100), suggestion('example.com', 500)]

    expect(rankSuggestions(tied, 'example')[0].lastSeenAt).toBe(500)
  })

  it('orders identically-timed hosts stably rather than arbitrarily', () => {
    const tied = [suggestion('beta.com', 100), suggestion('alpha.com', 100)]

    expect(hostnames(rankSuggestions(tied, ''))).toEqual(['alpha.com', 'beta.com'])
  })

  it('caps the list so the dropdown cannot run off the panel', () => {
    const many = Array.from({ length: 30 }, (_, index) => suggestion(`host${index}.com`, index))

    expect(rankSuggestions(many, '')).toHaveLength(8)
    expect(rankSuggestions(many, '', 3)).toHaveLength(3)
  })

  it('leaves the corpus untouched', () => {
    const original = [...corpus]
    rankSuggestions(corpus, '')

    expect(corpus).toEqual(original)
  })
})

describe('moveActiveIndex', () => {
  it('highlights nothing until the user arrows in, so Enter still means "go to what I typed"', () => {
    expect(moveActiveIndex(null, 1, 3)).toBe(0)
  })

  it('enters at the bottom when arrowing up from nothing', () => {
    expect(moveActiveIndex(null, -1, 3)).toBe(2)
  })

  it('moves through the list', () => {
    expect(moveActiveIndex(0, 1, 3)).toBe(1)
    expect(moveActiveIndex(2, -1, 3)).toBe(1)
  })

  it('wraps at both ends', () => {
    expect(moveActiveIndex(2, 1, 3)).toBe(0)
    expect(moveActiveIndex(0, -1, 3)).toBe(2)
  })

  it('has nowhere to go in an empty list', () => {
    expect(moveActiveIndex(null, 1, 0)).toBeNull()
    expect(moveActiveIndex(0, 1, 0)).toBeNull()
  })
})
