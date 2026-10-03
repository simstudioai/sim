import { describe, expect, it } from 'vitest'
import { OAUTH_PROVIDERS } from './oauth'
import type { OAuthProvider } from './types'
import {
  canonicalizeServiceProviderId,
  credentialProviderMatchesService,
  getCanonicalScopesForProvider,
  getMissingRequiredScopes,
  parseProvider,
  providerIdsForService,
} from './utils'

describe('getCanonicalScopesForProvider', () => {
  it.concurrent('should return new array instance (not reference)', () => {
    const scopes1 = getCanonicalScopesForProvider('google-email')
    const scopes2 = getCanonicalScopesForProvider('google-email')

    expect(scopes1).not.toBe(scopes2)
    expect(scopes1).toEqual(scopes2)
  })
})

describe('parseProvider', () => {
  it.concurrent('should fallback to default for unknown compound provider', () => {
    const config = parseProvider('unknown-provider' as OAuthProvider)

    expect(config.baseProvider).toBe('unknown')
    expect(config.featureType).toBe('provider')
  })

  it.concurrent('should use default featureType for simple unknown provider', () => {
    const config = parseProvider('unknown' as OAuthProvider)

    expect(config.baseProvider).toBe('unknown')
    expect(config.featureType).toBe('default')
  })
})

describe('getMissingRequiredScopes', () => {
  it.concurrent('should return missing scopes', () => {
    const credential = { scopes: ['read'] }
    const missing = getMissingRequiredScopes(credential, ['read', 'write'])

    expect(missing).toEqual(['write'])
  })

  it.concurrent('should return all required scopes when credential is undefined', () => {
    const missing = getMissingRequiredScopes(undefined, ['read', 'write'])

    expect(missing).toEqual(['read', 'write'])
  })

  it.concurrent(
    'should report nothing missing for a service account, which grants no scopes',
    () => {
      const credential = { type: 'service_account', scopes: undefined }
      const missing = getMissingRequiredScopes(credential, ['read', 'write'])

      expect(missing).toEqual([])
    }
  )

  it.concurrent(
    'ignores offline_access, offline.access, and refresh_token in required scopes',
    () => {
      const missing = getMissingRequiredScopes({ scopes: ['read'] }, [
        'read',
        'offline_access',
        'offline.access',
        'refresh_token',
      ])

      expect(missing).toEqual([])
    }
  )

  it.concurrent('accepts calendar for a required calendar.readonly via the generic rule', () => {
    const credential = { scopes: ['https://www.googleapis.com/auth/calendar'] }
    const missing = getMissingRequiredScopes(credential, [
      'https://www.googleapis.com/auth/calendar.readonly',
    ])

    expect(missing).toEqual([])
  })

  /**
   * The rule derives only the bare read-write scope. Sim requests `gmail.send`,
   * `gmail.modify` and `gmail.labels` but never `.../auth/gmail`, so a consumer
   * must require one of the scopes actually granted rather than `gmail.readonly`.
   */
  it.concurrent('does not treat unrelated gmail scopes as covering gmail.readonly', () => {
    const credential = {
      scopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.labels',
      ],
    }
    const missing = getMissingRequiredScopes(credential, [
      'https://www.googleapis.com/auth/gmail.readonly',
    ])

    expect(missing).toEqual(['https://www.googleapis.com/auth/gmail.readonly'])
  })
})

describe('providerIdsForService', () => {
  it('widens a service primary id to its alternate authorization servers', () => {
    // The SQL counterpart to credentialProviderMatchesService: the block
    // picker queries by 'salesforce', and a sandbox credential is stored under
    // 'salesforce-sandbox'. Without the widening it is filtered out at the DB
    // and never reaches the picker, however correct the in-memory resolvers.
    expect(providerIdsForService('salesforce')).toEqual(['salesforce', 'salesforce-sandbox'])
  })

  it('does not widen an alternate server id back into the primary', () => {
    expect(providerIdsForService('salesforce-sandbox')).toEqual(['salesforce-sandbox'])
  })

  it('does not widen a service-account id into the OAuth family', () => {
    // Broadening here would leak OAuth credentials into a service-account query.
    expect(providerIdsForService('salesforce-service-account')).toEqual([
      'salesforce-service-account',
    ])
  })
})

describe('credentialProviderMatchesService', () => {
  const salesforce = OAUTH_PROVIDERS.salesforce.services.salesforce

  it('matches the primary OAuth id, an alternate server, and the service account', () => {
    expect(credentialProviderMatchesService('salesforce', salesforce)).toBe(true)
    // The alternate-server clause: without it a sandbox credential is invisible
    // to every surface that resolves a credential to its service.
    expect(credentialProviderMatchesService('salesforce-sandbox', salesforce)).toBe(true)
    expect(credentialProviderMatchesService('salesforce-service-account', salesforce)).toBe(true)
  })
})

describe('canonicalizeServiceProviderId', () => {
  const salesforce = OAUTH_PROVIDERS.salesforce.services.salesforce
  const gmail = OAUTH_PROVIDERS.google.services.gmail

  it('folds an alternate authorization server onto its service', () => {
    expect(canonicalizeServiceProviderId('salesforce-sandbox', salesforce)).toBe('salesforce')
  })

  it('never folds a family-wide service-account id onto one product', () => {
    // `google-service-account` authenticates every Google service, so folding it
    // onto whichever one matched first would mark exactly one as connected.
    expect(canonicalizeServiceProviderId('google-service-account', gmail)).toBe(
      'google-service-account'
    )
  })
})
