/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { liveSearchProviderSchema } from '@/lib/api/contracts/mothership-assistant-tools'
import { searchMemberAccountProvider } from '@/lib/sim-search/connectors'
import {
  LIVE_SEARCH_PROVIDER_CATALOG,
  LIVE_SEARCH_PROVIDER_IDS,
  liveSearchProviderForCredential,
  supportsLiveSearchMode,
} from '@/lib/sim-search/live/provider-catalog'
import { LIVE_SEARCH_PROVIDERS } from '@/lib/sim-search/live/providers'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

describe('live Search registration', () => {
  it.each([
    ['google_drive', 'google-drive'],
    ['gmail', 'gmail'],
    ['google_calendar', 'google-calendar'],
    ['jira', 'jira'],
    ['confluence', 'confluence'],
    ['github', 'github-repositories'],
    ['slack', null],
    ['gitlab', null],
    ['coda', null],
  ])(
    'configures standard member sign-in or preserves specialized setup for %s',
    (connector, provider) => {
      expect(searchMemberAccountProvider(connector)).toBe(provider)
    }
  )

  it('has branding and both runtime operations for every advertised Search connector', () => {
    const sources = Object.values(CONNECTOR_META_REGISTRY)
      .filter((meta) => meta.search)
      .map((meta) => meta.id)
    expect(new Set(sources)).toEqual(new Set(LIVE_SEARCH_PROVIDER_IDS))
    expect(new Set(liveSearchProviderSchema.options)).toEqual(new Set(sources))
    expect(new Set(Object.keys(LIVE_SEARCH_PROVIDERS))).toEqual(new Set(sources))
    for (const provider of LIVE_SEARCH_PROVIDER_IDS) {
      expect(CONNECTOR_META_REGISTRY[provider]?.name).toBeTruthy()
      expect(CONNECTOR_META_REGISTRY[provider]?.icon).toBeDefined()
      expect(LIVE_SEARCH_PROVIDERS[provider].search).toBeTypeOf('function')
      expect(LIVE_SEARCH_PROVIDERS[provider].read).toBeTypeOf('function')
      const origin = new URL(LIVE_SEARCH_PROVIDER_CATALOG[provider].origin)
      expect(origin.protocol).toBe('https:')
      expect(origin.href).toBe(`${origin.origin}/`)
    }
  })

  it('binds each stored credential provider to at most one Search provider', () => {
    const ids = LIVE_SEARCH_PROVIDER_IDS.flatMap((provider) => [
      ...LIVE_SEARCH_PROVIDER_CATALOG[provider].credentialProviderIds,
    ])
    expect(new Set(ids).size).toBe(ids.length)
    for (const provider of LIVE_SEARCH_PROVIDER_IDS)
      for (const id of LIVE_SEARCH_PROVIDER_CATALOG[provider].credentialProviderIds)
        expect(liveSearchProviderForCredential(id)).toBe(provider)
    expect(liveSearchProviderForCredential('unknown')).toBeUndefined()
    expect(liveSearchProviderForCredential('google-sheets')).toBe('google_drive')
    expect(liveSearchProviderForCredential('google-slides')).toBe('google_drive')
  })

  it('keeps member-only and service-only authentication capabilities explicit', () => {
    expect(supportsLiveSearchMode('gitlab', 'member')).toBe(false)
    expect(supportsLiveSearchMode('gitlab', 'service_account')).toBe(true)
    for (const provider of ['jira', 'slack'] as const) {
      expect(supportsLiveSearchMode(provider, 'member')).toBe(true)
      expect(supportsLiveSearchMode(provider, 'service_account')).toBe(false)
    }
  })
})
