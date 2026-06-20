/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isSignInProviderAllowed, SIGN_IN_PROVIDER_IDS } from '@/lib/auth/constants'

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
