import { describe, expect, it } from 'vitest'
import {
  BOX_SERVICE_ACCOUNT_PROVIDER_ID,
  getClientCredentialAccountDescriptor,
  normalizeNetSuiteSuiteTalkOrigin,
  partitionClientCredentialFields,
  resolveClientCredentialAuthMethod,
  resolveSalesforceAuthMethod,
  SALESFORCE_DEFAULT_AUTH_METHOD,
  SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/client-credential-accounts/descriptors'

const salesforce = getClientCredentialAccountDescriptor(SALESFORCE_SERVICE_ACCOUNT_PROVIDER_ID)!
const box = getClientCredentialAccountDescriptor(BOX_SERVICE_ACCOUNT_PROVIDER_ID)!

const ids = (fields: { id: string }[]) => fields.map((field) => field.id)

describe('partitionClientCredentialFields', () => {
  describe('single-grant providers are unaffected by the auth-method machinery', () => {
    it('ignores an auth method a single-grant provider does not declare', () => {
      const { required } = partitionClientCredentialFields(box, 'jwt_bearer')
      expect(ids(required)).toEqual(['clientId', 'clientSecret', 'orgId'])
    })
  })

  describe('Salesforce, which offers two grants', () => {
    it('requires the consumer secret and hides key material on the client-credentials branch', () => {
      const { visible, required } = partitionClientCredentialFields(
        salesforce,
        'client_credentials'
      )
      expect(ids(required)).toEqual(['clientId', 'clientSecret', 'orgId'])
      expect(ids(visible)).not.toContain('privateKey')
      expect(ids(visible)).not.toContain('username')
    })

    it('requires the key and username on the JWT branch, and hides the consumer secret', () => {
      const { visible, required } = partitionClientCredentialFields(salesforce, 'jwt_bearer')
      expect(ids(required)).toEqual(['clientId', 'privateKey', 'username', 'orgId'])
      expect(ids(visible)).not.toContain('clientSecret')
    })

    it.each([
      ['absent', undefined],
      ['unrecognized', 'totally-made-up'],
    ])('falls back to the default grant when the method is %s', (_label, authMethod) => {
      // Credentials created before the JWT branch existed carry no `authMethod`,
      // so the fallback is what keeps them minting as they always did.
      const { required } = partitionClientCredentialFields(salesforce, authMethod)
      expect(ids(required)).toContain('clientSecret')
      expect(ids(required)).not.toContain('privateKey')
    })
  })
})

describe('normalizeNetSuiteSuiteTalkOrigin', () => {
  it('normalizes an account-specific HTTPS Company URL', () => {
    expect(
      normalizeNetSuiteSuiteTalkOrigin(' https://1234567-SB1.suitetalk.api.netsuite.com/ ')
    ).toBe('https://1234567-sb1.suitetalk.api.netsuite.com')
  })

  it.each([
    'http://1234567.suitetalk.api.netsuite.com',
    'https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1',
    'https://1234567.suitetalk.api.netsuite.com.evil.example',
    'https://user@1234567.suitetalk.api.netsuite.com',
  ])('rejects the non-authoritative SuiteTalk URL %j', (value) => {
    expect(normalizeNetSuiteSuiteTalkOrigin(value)).toBeUndefined()
  })
})

describe('resolveClientCredentialAuthMethod', () => {
  it('returns undefined for a provider that declares no method selector', () => {
    expect(resolveClientCredentialAuthMethod(box, 'jwt_bearer')).toBeUndefined()
  })

  it('accepts a declared method and rejects anything else', () => {
    expect(resolveClientCredentialAuthMethod(salesforce, 'jwt_bearer')).toBe('jwt_bearer')
    expect(resolveClientCredentialAuthMethod(salesforce, ' jwt_bearer ')).toBe('jwt_bearer')
    expect(resolveClientCredentialAuthMethod(salesforce, 'nope')).toBe(
      SALESFORCE_DEFAULT_AUTH_METHOD
    )
  })
})

describe('resolveSalesforceAuthMethod', () => {
  it('agrees with the descriptor-driven resolver the create path uses', () => {
    // The minter holds only the raw stored value; if these two ever disagreed a
    // credential would validate under one grant and mint under the other.
    for (const value of [undefined, '', 'client_credentials', 'jwt_bearer', 'garbage']) {
      expect(resolveSalesforceAuthMethod(value)).toBe(
        resolveClientCredentialAuthMethod(salesforce, value)
      )
    }
  })
})
