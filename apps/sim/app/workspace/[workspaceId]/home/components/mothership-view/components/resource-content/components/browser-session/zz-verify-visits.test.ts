import type { BrowserCredentialMetadata, BrowserSiteInfo } from '@sim/desktop-bridge'
import { describe, expect, it } from 'vitest'
import {
  mergeSuggestionSources,
  rankSuggestions,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/url-suggestions'

/** One import batch stamps every credential with the same instant (vault.ts). */
const BATCH = '2026-07-27T10:00:00.000Z'

function credential(origin: string): BrowserCredentialMetadata {
  return {
    id: origin,
    origin,
    username: 'user',
    createdAt: BATCH,
    updatedAt: BATCH,
    source: 'chrome',
  }
}

function site(hostname: string, visits: number, name?: string): BrowserSiteInfo {
  return { hostname, name, visits, importedAt: BATCH }
}

/** 16 saved-password hosts, as a real Chrome profile would produce. */
const CREDENTIAL_HOSTS = [
  'accounts.google.com',
  'accounts.spotify.com',
  'adobe.com',
  'airbnb.com',
  'app-na2.hubspot.com',
  'app.asana.com',
  'app.rippling.com',
  'chatgpt.com',
  'github.com',
  'cursor.com',
  'dashboard.stripe.com',
  'www.linkedin.com',
  'notion.so',
  'vercel.com',
  'x.com',
  'zoom.us',
]

/** History-derived visit counts for those same hosts. */
const VISITS: Record<string, number> = {
  'github.com': 8495,
  'www.linkedin.com': 561,
  'cursor.com': 532,
  'dashboard.stripe.com': 510,
  'chatgpt.com': 400,
  'notion.so': 300,
  'x.com': 250,
  'accounts.google.com': 200,
  'vercel.com': 150,
  'app.asana.com': 90,
  'zoom.us': 80,
  'accounts.spotify.com': 60,
  'app.rippling.com': 40,
  'app-na2.hubspot.com': 30,
  'airbnb.com': 20,
  'adobe.com': 10,
}

describe('visits propagation through the merge', () => {
  it('shows what the empty-query dropdown actually contains', () => {
    const credentials = CREDENTIAL_HOSTS.map((h) => credential(`https://${h}`))
    const sites = CREDENTIAL_HOSTS.map((h) => site(h, VISITS[h]))

    const merged = mergeSuggestionSources([], credentials, sites)
    const githubEntry = merged.find((s) => s.hostname === 'github.com')
    const top = rankSuggestions(merged, '').map((s) => s.hostname)

    const withVisits = merged.map((s) => ({ ...s, visits: VISITS[s.hostname] }))
    const wouldBe = rankSuggestions(withVisits, '').map((s) => s.hostname)

    expect({
      github: githubEntry,
      actualTop8: top,
      ifVisitsCopiedTop8: wouldBe,
    }).toBe('SHOW_ME')
  })

  it('shows what it WOULD contain if visits were copied', () => {
    const credentials = CREDENTIAL_HOSTS.map(credential)
    const sites = CREDENTIAL_HOSTS.map((h) => site(h, VISITS[h]))
    const merged = mergeSuggestionSources([], credentials, sites).map((s) => ({
      ...s,
      visits: VISITS[s.hostname],
    }))
    console.log(
      'with visits copied, top 8:',
      rankSuggestions(merged, '').map((s) => s.hostname)
    )
  })

  it('checks the pure-imported case (no credentials) still ranks by visits', () => {
    const sites = CREDENTIAL_HOSTS.map((h) => site(h, VISITS[h]))
    const merged = mergeSuggestionSources([], [], sites)
    console.log(
      'imported-only top 8:',
      rankSuggestions(merged, '').map((s) => s.hostname)
    )
  })

  it('checks whether a typed query still reaches github.com', () => {
    const credentials = CREDENTIAL_HOSTS.map(credential)
    const sites = CREDENTIAL_HOSTS.map((h) => site(h, VISITS[h]))
    const merged = mergeSuggestionSources([], credentials, sites)
    console.log(
      'query "g" ->',
      rankSuggestions(merged, 'g').map((s) => s.hostname)
    )
    console.log(
      'query "gi" ->',
      rankSuggestions(merged, 'gi').map((s) => s.hostname)
    )
  })
})
