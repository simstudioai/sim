/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getRequestedSignInProviderId,
  isSignInProviderAllowed,
  SIGN_IN_PROVIDER_IDS,
} from '@/lib/auth/constants'

describe('sign-in provider allowlist', () => {
  it('permits only the first-party login providers', () => {
    expect([...SIGN_IN_PROVIDER_IDS]).toEqual(['google', 'github', 'microsoft'])
  })

  it('allows first-party login providers to sign in', () => {
    for (const providerId of SIGN_IN_PROVIDER_IDS) {
      expect(isSignInProviderAllowed(providerId)).toBe(true)
    }
  })

  it('rejects integration connectors from the sign-in endpoints', () => {
    const connectors = [
      'microsoft-ad',
      'microsoft-teams',
      'microsoft-excel',
      'outlook',
      'onedrive',
      'sharepoint',
      'salesforce',
      'jira',
      'confluence',
      'hubspot',
      'box',
      'wordpress',
      'google-drive',
      'google-sheets',
      'vertex-ai',
    ]
    for (const providerId of connectors) {
      expect(isSignInProviderAllowed(providerId)).toBe(false)
    }
  })

  it('rejects missing or malformed provider identifiers', () => {
    expect(isSignInProviderAllowed(undefined)).toBe(false)
    expect(isSignInProviderAllowed(null)).toBe(false)
    expect(isSignInProviderAllowed('')).toBe(false)
    expect(isSignInProviderAllowed(123)).toBe(false)
    expect(isSignInProviderAllowed({ provider: 'google' })).toBe(false)
  })
})

describe('getRequestedSignInProviderId', () => {
  it('reads the `provider` field on /sign-in/social', () => {
    expect(getRequestedSignInProviderId('/sign-in/social', { provider: 'microsoft' })).toBe(
      'microsoft'
    )
  })

  it('reads the `providerId` field on /sign-in/oauth2', () => {
    expect(getRequestedSignInProviderId('/sign-in/oauth2', { providerId: 'salesforce' })).toBe(
      'salesforce'
    )
  })

  it('checks the field the /sign-in/oauth2 handler uses, ignoring a decoy `provider`', () => {
    const body = { provider: 'google', providerId: 'salesforce' }
    const resolved = getRequestedSignInProviderId('/sign-in/oauth2', body)
    expect(resolved).toBe('salesforce')
    expect(isSignInProviderAllowed(resolved)).toBe(false)
  })

  it('checks the field the /sign-in/social handler uses, ignoring a decoy `providerId`', () => {
    const body = { provider: 'salesforce', providerId: 'google' }
    const resolved = getRequestedSignInProviderId('/sign-in/social', body)
    expect(resolved).toBe('salesforce')
    expect(isSignInProviderAllowed(resolved)).toBe(false)
  })

  it('returns undefined for unrelated paths and missing bodies', () => {
    expect(getRequestedSignInProviderId('/sign-in/email', { provider: 'google' })).toBeUndefined()
    expect(getRequestedSignInProviderId('/sign-in/social', undefined)).toBeUndefined()
    expect(getRequestedSignInProviderId('/sign-in/oauth2', null)).toBeUndefined()
  })
})
