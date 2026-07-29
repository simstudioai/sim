import type { BrowserKnownSession, BrowserSessionEvidence } from '@sim/browser-protocol'
import type { BrowserCredentialMetadata, BrowserSiteInfo } from '@sim/desktop-bridge'
import { describe, expect, it } from 'vitest'
import {
  mergeSuggestionSources,
  moveActiveIndex,
  rankSuggestions,
  SUGGESTION_TIER,
  type SuggestionTier,
  type UrlSuggestion,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/url-suggestions'

const IMPORTED_AT = '2026-02-01T00:00:00.000Z'

function session(
  hostname: string,
  lastObservedAt = '2026-01-01T00:00:00.000Z',
  evidence: BrowserSessionEvidence = 'cookies'
): BrowserKnownSession {
  return { hostname, evidence, lastObservedAt }
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

function site(hostname: string, overrides: Partial<BrowserSiteInfo> = {}): BrowserSiteInfo {
  return { hostname, importedAt: IMPORTED_AT, ...overrides }
}

function suggestion(
  hostname: string,
  lastSeenAt: number,
  name?: string,
  tier: SuggestionTier = SUGGESTION_TIER.ACCOUNT,
  visits?: number
): UrlSuggestion {
  return { hostname, url: `https://${hostname}`, lastSeenAt, name, tier, visits }
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
        tier: SUGGESTION_TIER.ACTIVE,
      },
    ])
  })

  it('trusts a sign-in the agent completed as much as a saved password', () => {
    const [signedIn] = mergeSuggestionSources(
      [session('github.com', '2026-01-01T00:00:00.000Z', 'sign-in-completed')],
      []
    )
    const [saved] = mergeSuggestionSources([], [credential('https://gitlab.com')])

    expect(signedIn.tier).toBe(SUGGESTION_TIER.ACCOUNT)
    expect(saved.tier).toBe(SUGGESTION_TIER.ACCOUNT)
  })

  it('holds a host known only by its cookie below one with an account', () => {
    const merged = mergeSuggestionSources(
      [session('cookies.com')],
      [credential('https://saved.com')]
    )

    expect(merged.find((entry) => entry.hostname === 'cookies.com')?.tier).toBe(
      SUGGESTION_TIER.ACTIVE
    )
    expect(hostnames(rankSuggestions(merged, ''))).toEqual(['saved.com', 'cookies.com'])
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
      [site('mail.google.com', { name: 'Gmail', icon: 'data:png' })]
    )

    expect(merged).toHaveLength(1)
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
      [site('github.com', { name: 'GitHub', icon: 'data:from-directory' })]
    )

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ name: 'GitHub', icon: 'data:from-vault' })
  })

  it('offers a host the import brought over even though nothing here has signed into it', () => {
    const merged = mergeSuggestionSources(
      [],
      [],
      [site('news.ycombinator.com', { name: 'Hacker News', visits: 42 })]
    )

    expect(merged).toEqual([
      {
        hostname: 'news.ycombinator.com',
        url: 'https://news.ycombinator.com',
        name: 'Hacker News',
        lastSeenAt: Date.parse(IMPORTED_AT),
        tier: SUGGESTION_TIER.IMPORTED,
        visits: 42,
      },
    ])
  })

  it('lists a host that was both imported and saved once, at the tier its account earned', () => {
    const merged = mergeSuggestionSources(
      [],
      [credential('https://github.com', { updatedAt: '2026-01-15T00:00:00.000Z' })],
      [site('github.com', { name: 'GitHub', visits: 900 })]
    )

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      tier: SUGGESTION_TIER.ACCOUNT,
      lastSeenAt: Date.parse('2026-01-15T00:00:00.000Z'),
      visits: 900,
    })
  })

  it('keeps the visit counts of hosts promoted above the imported tier', () => {
    const merged = mergeSuggestionSources(
      [session('gitlab.com')],
      [credential('https://github.com')],
      [site('github.com', { visits: 900 }), site('gitlab.com', { visits: 40 })]
    )

    // Both were promoted out of the imported tier by other evidence. Dropping
    // their counts here is what left byConfidence with nothing but hostnames.
    expect(merged.map((result) => [result.hostname, result.visits])).toEqual([
      ['github.com', 900],
      ['gitlab.com', 40],
    ])
  })

  it('orders a password import by usage rather than falling back to the alphabet', () => {
    // One import stamps every credential with the same instant, so tier and
    // recency both tie and visits is the only thing left to sort on. These
    // hosts are deliberately in the opposite order by name and by usage.
    const hosts: Array<[string, number]> = [
      ['adobe.com', 10],
      ['github.com', 500],
      ['zoom.us', 8495],
    ]
    const merged = mergeSuggestionSources(
      [],
      hosts.map(([hostname]) => credential(`https://${hostname}`)),
      hosts.map(([hostname, visits]) => site(hostname, { visits }))
    )

    expect(hostnames(rankSuggestions(merged, ''))).toEqual(['zoom.us', 'github.com', 'adobe.com'])
  })

  it('reaches an imported host by the name the source browser gave it', () => {
    const merged = mergeSuggestionSources([], [], [site('mail.google.com', { name: 'Gmail' })])

    expect(hostnames(rankSuggestions(merged, 'gmail'))).toEqual(['mail.google.com'])
  })

  it('skips a site record with no hostname rather than offering a bare https://', () => {
    const merged = mergeSuggestionSources([], [], [site(''), site('github.com')])

    expect(hostnames(merged)).toEqual(['github.com'])
  })

  it('survives an import stamped with an unparseable time rather than ranking on NaN', () => {
    const merged = mergeSuggestionSources(
      [],
      [],
      [
        site('github.com', { importedAt: 'whenever' }),
        site('gitlab.com', { importedAt: undefined }),
      ]
    )

    expect(merged.map((result) => result.lastSeenAt)).toEqual([0, 0])
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

  it('keeps a host with an account above an imported one that looks newer', () => {
    const mixed = [
      suggestion('imported.com', 900, undefined, SUGGESTION_TIER.IMPORTED, 5000),
      suggestion('account.com', 100),
    ]

    expect(hostnames(rankSuggestions(mixed, ''))).toEqual(['account.com', 'imported.com'])
  })

  it('orders imported hosts by how much the source browser used each one', () => {
    const imported = [
      suggestion('barely-used.com', 100, undefined, SUGGESTION_TIER.IMPORTED, 2),
      suggestion('daily-driver.com', 100, undefined, SUGGESTION_TIER.IMPORTED, 90),
    ]

    expect(hostnames(rankSuggestions(imported, ''))).toEqual([
      'daily-driver.com',
      'barely-used.com',
    ])
  })

  it('falls back to recency then hostname for imported hosts used equally', () => {
    const sameVisits = [
      suggestion('older.com', 100, undefined, SUGGESTION_TIER.IMPORTED, 5),
      suggestion('recent.com', 500, undefined, SUGGESTION_TIER.IMPORTED, 5),
    ]
    const sameImport = [
      suggestion('beta.com', 100, undefined, SUGGESTION_TIER.IMPORTED, 5),
      suggestion('alpha.com', 100, undefined, SUGGESTION_TIER.IMPORTED, 5),
    ]

    expect(hostnames(rankSuggestions(sameVisits, ''))).toEqual(['recent.com', 'older.com'])
    expect(hostnames(rankSuggestions(sameImport, ''))).toEqual(['alpha.com', 'beta.com'])
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
