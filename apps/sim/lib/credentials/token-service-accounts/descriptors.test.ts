/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getTokenServiceAccountDescriptor,
  getTokenServiceAccountErrorMessage,
  HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID,
  SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID,
  type TokenServiceAccountDescriptor,
} from '@/lib/credentials/token-service-accounts/descriptors'

function descriptorFor(providerId: string): TokenServiceAccountDescriptor {
  const descriptor = getTokenServiceAccountDescriptor(providerId)
  if (!descriptor) throw new Error(`missing descriptor for ${providerId}`)
  return descriptor
}

describe('getTokenServiceAccountErrorMessage', () => {
  const shopify = descriptorFor(SHOPIFY_SERVICE_ACCOUNT_PROVIDER_ID)
  const hubspot = descriptorFor(HUBSPOT_SERVICE_ACCOUNT_PROVIDER_ID)

  it('uses the provider-specific invalidCredentialsHelp override when present', () => {
    expect(shopify.invalidCredentialsHelp).toBeDefined()
    expect(getTokenServiceAccountErrorMessage(shopify, 'invalid_credentials')).toBe(
      shopify.invalidCredentialsHelp
    )
  })

  it('falls back to the generic token-noun message when no override is set', () => {
    expect(hubspot.invalidCredentialsHelp).toBeUndefined()
    expect(getTokenServiceAccountErrorMessage(hubspot, 'invalid_credentials')).toBe(
      `We couldn't authenticate with that ${hubspot.tokenNoun}. Double-check it in ${hubspot.serviceLabel} and try again.`
    )
  })

  it('maps site_not_found to the domain hint', () => {
    expect(getTokenServiceAccountErrorMessage(shopify, 'site_not_found')).toBe(
      "We couldn't find an account at that domain. Check the spelling and try again."
    )
  })

  it('maps provider_unavailable to a service-labeled retry message', () => {
    expect(getTokenServiceAccountErrorMessage(hubspot, 'provider_unavailable')).toBe(
      `We couldn't reach ${hubspot.serviceLabel} to verify these credentials. Try again in a moment.`
    )
  })

  it('maps duplicate_display_name to the name-collision message', () => {
    expect(getTokenServiceAccountErrorMessage(shopify, 'duplicate_display_name')).toBe(
      'A credential with that name already exists in this workspace.'
    )
  })

  it('falls back to a generic message for an unknown or absent code', () => {
    const fallback = "We couldn't add this credential. Try again in a moment."
    expect(getTokenServiceAccountErrorMessage(shopify, 'something_else')).toBe(fallback)
    expect(getTokenServiceAccountErrorMessage(shopify, undefined)).toBe(fallback)
  })
})
