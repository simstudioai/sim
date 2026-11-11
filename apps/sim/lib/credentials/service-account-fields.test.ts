import { describe, expect, it } from 'vitest'
import { getMissingServiceAccountFields } from '@/lib/credentials/service-account-fields'

describe('required fields for a service-account create', () => {
  it('accepts a keyless Snowflake configuration in place of the token and host', () => {
    expect(
      getMissingServiceAccountFields('snowflake-service-account', { serviceAccountJson: '{}' })
    ).toEqual([])
  })

  it('still asks a Snowflake create with neither mode for the token and host', () => {
    expect(getMissingServiceAccountFields('snowflake-service-account', {})).toEqual(
      expect.arrayContaining(['apiToken', 'domain'])
    )
  })

  it('does not let a JSON configuration stand in for another token provider’s token', () => {
    expect(
      getMissingServiceAccountFields('hubspot-service-account', { serviceAccountJson: '{}' })
    ).toEqual(['apiToken'])
  })

  it('asks a Shopify client-credentials create for the client ID, secret, and store domain', () => {
    expect(
      getMissingServiceAccountFields('shopify-service-account', {
        authMethod: 'client_credentials',
      })
    ).toEqual(['clientId', 'clientSecret', 'domain'])
    expect(
      getMissingServiceAccountFields('shopify-service-account', {
        authMethod: 'client_credentials',
        clientId: 'client',
        clientSecret: 'secret',
        domain: 'acme.myshopify.com',
      })
    ).toEqual([])
  })

  it('still asks a Shopify create without an auth method for the token and store domain', () => {
    expect(
      getMissingServiceAccountFields('shopify-service-account', {
        clientId: 'client',
        clientSecret: 'secret',
      })
    ).toEqual(['apiToken', 'domain'])
  })

  it('does not let client credentials stand in for a token on a provider without that mode', () => {
    expect(
      getMissingServiceAccountFields('hubspot-service-account', {
        authMethod: 'client_credentials',
        clientId: 'client',
        clientSecret: 'secret',
      })
    ).toEqual(['apiToken'])
  })

  it('asks an Atlassian OAuth 2.0 create for the client ID, secret, and site, not a token', () => {
    expect(
      getMissingServiceAccountFields('atlassian-service-account', {
        authMethod: 'client_credentials',
      })
    ).toEqual(['clientId', 'clientSecret', 'domain'])
    expect(getMissingServiceAccountFields('atlassian-service-account', {})).toEqual([
      'apiToken',
      'domain',
    ])
  })

  it('asks a Linear client-credentials create for only the client ID and secret', () => {
    expect(
      getMissingServiceAccountFields('linear-service-account', { authMethod: 'client_credentials' })
    ).toEqual(['clientId', 'clientSecret'])
    expect(getMissingServiceAccountFields('linear-service-account', {})).toEqual(['apiToken'])
  })
})
