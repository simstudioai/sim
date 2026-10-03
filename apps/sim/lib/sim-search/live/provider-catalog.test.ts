import { describe, expect, it } from 'vitest'
import {
  LIVE_SEARCH_PROVIDER_CATALOG,
  LIVE_SEARCH_PROVIDER_IDS,
  liveSearchProviderForCredential,
} from '@/lib/sim-search/live/provider-catalog'

describe('live Search registration', () => {
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
})
