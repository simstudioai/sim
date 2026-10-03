import type { BrowserKnownSession, BrowserSessionEvidence } from '@sim/browser-protocol'
import type { BrowserCredentialMetadata, BrowserSiteInfo } from '@sim/desktop-bridge'
import { describe, expect, it } from 'vitest'
import {
  buildOmniboxSuggestions,
  mergeSuggestionSources,
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
  it('does not suggest a host known only from a saved credential', () => {
    expect(mergeSuggestionSources([], [credential('https://saved-only.com')])).toEqual([])
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
  it('does not offer an imported host without positive visit evidence', () => {
    expect(
      mergeSuggestionSources(
        [],
        [],
        [site('cookie-only.com'), site('zero-visits.com', { visits: 0 })]
      )
    ).toEqual([])
  })
})

describe('rankSuggestions', () => {
  it('keeps a host with an account above an imported one that looks newer', () => {
    const mixed = [
      suggestion('imported.com', 900, undefined, SUGGESTION_TIER.IMPORTED, 5000),
      suggestion('account.com', 100),
    ]

    expect(hostnames(rankSuggestions(mixed, ''))).toEqual(['account.com', 'imported.com'])
  })
})

describe('buildOmniboxSuggestions', () => {
  it('does not send URL-looking input through search completions', () => {
    const results = buildOmniboxSuggestions([suggestion('github.com', 100)], 'github.com', [
      'github.com login',
    ])

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ kind: 'site', hostname: 'github.com' })
  })

  it('keeps an empty omnibox local-only', () => {
    const results = buildOmniboxSuggestions([suggestion('github.com', 100)], '', [
      'ignored remote completion',
    ])

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ kind: 'site', hostname: 'github.com' })
  })
})
