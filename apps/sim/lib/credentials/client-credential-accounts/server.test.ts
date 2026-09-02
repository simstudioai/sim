/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE } from '@/lib/credentials/client-credential-accounts/descriptors'
import { parseClientCredentialAccountSecretBlob } from '@/lib/credentials/client-credential-accounts/server'

const MALFORMED = 'Stored client-credential service-account secret is malformed'

function blob(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE,
    providerId: 'zoom-service-account',
    clientId: 'cid',
    clientSecret: 'secret',
    orgId: 'org',
    ...overrides,
  })
}

describe('parseClientCredentialAccountSecretBlob', () => {
  it('returns the parsed blob when it matches the expected provider', () => {
    const parsed = parseClientCredentialAccountSecretBlob(blob(), 'zoom-service-account')
    expect(parsed.clientId).toBe('cid')
    expect(parsed.orgId).toBe('org')
  })

  it('throws the clean malformed error on a non-JSON payload (not a raw SyntaxError)', () => {
    expect(() =>
      parseClientCredentialAccountSecretBlob('not json {', 'zoom-service-account')
    ).toThrow(MALFORMED)
  })

  it('rejects a blob whose providerId does not match the credential row', () => {
    expect(() => parseClientCredentialAccountSecretBlob(blob(), 'box-service-account')).toThrow(
      MALFORMED
    )
  })

  it('rejects a blob with the wrong discriminator type', () => {
    expect(() =>
      parseClientCredentialAccountSecretBlob(
        blob({ type: 'token_service_account' }),
        'zoom-service-account'
      )
    ).toThrow(MALFORMED)
  })

  it('rejects a blob missing a required secret field', () => {
    expect(() =>
      parseClientCredentialAccountSecretBlob(blob({ clientSecret: '' }), 'zoom-service-account')
    ).toThrow(MALFORMED)
  })

  it('throws the clean malformed error on a JSON-null payload', () => {
    expect(() => parseClientCredentialAccountSecretBlob('null', 'zoom-service-account')).toThrow(
      MALFORMED
    )
  })

  it('accepts a key-based blob that carries a private key instead of a client secret', () => {
    const parsed = parseClientCredentialAccountSecretBlob(
      blob({
        providerId: 'salesforce-service-account',
        clientSecret: undefined,
        authMethod: 'jwt_bearer',
        privateKey: '-----BEGIN PRIVATE KEY-----',
        username: 'integration.user@acme.com',
      }),
      'salesforce-service-account'
    )
    expect(parsed.clientSecret).toBeUndefined()
    expect(parsed.authMethod).toBe('jwt_bearer')
  })

  it('still rejects a blob carrying neither a client secret nor a private key', () => {
    expect(() =>
      parseClientCredentialAccountSecretBlob(
        blob({ providerId: 'salesforce-service-account', clientSecret: undefined }),
        'salesforce-service-account'
      )
    ).toThrow(MALFORMED)
  })

  it('parses a pre-JWT salesforce blob unchanged', () => {
    // Credentials created before the JWT branch existed carry no `authMethod`;
    // they must keep resolving to the client-credentials grant.
    const parsed = parseClientCredentialAccountSecretBlob(
      blob({ providerId: 'salesforce-service-account' }),
      'salesforce-service-account'
    )
    expect(parsed.clientSecret).toBe('secret')
    expect(parsed.authMethod).toBeUndefined()
  })

  it('requires every descriptor field for a NetSuite certificate blob', () => {
    const netSuiteBlob = blob({
      providerId: 'netsuite-service-account',
      clientSecret: undefined,
      orgId: 'https://1234567.suitetalk.api.netsuite.com',
      certificateId: 'cert-1',
      privateKey: '-----BEGIN PRIVATE KEY-----',
    })
    expect(
      parseClientCredentialAccountSecretBlob(netSuiteBlob, 'netsuite-service-account')
    ).toMatchObject({ certificateId: 'cert-1' })

    expect(() =>
      parseClientCredentialAccountSecretBlob(
        blob({
          providerId: 'netsuite-service-account',
          clientSecret: undefined,
          orgId: 'https://1234567.suitetalk.api.netsuite.com',
          privateKey: '-----BEGIN PRIVATE KEY-----',
        }),
        'netsuite-service-account'
      )
    ).toThrow(MALFORMED)
  })

  it('round-trips every Oracle Fusion endpoint and scope field', () => {
    const oracleBlob = blob({
      providerId: 'oracle-fusion-service-account',
      orgId: '',
      instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
      tokenUrl: 'https://idcs-abc.identity.oraclecloud.com/oauth2/v1/token',
      scope: 'urn:opc:resource:fa:scope',
    })
    expect(
      parseClientCredentialAccountSecretBlob(oracleBlob, 'oracle-fusion-service-account')
    ).toMatchObject({
      instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
      tokenUrl: 'https://idcs-abc.identity.oraclecloud.com/oauth2/v1/token',
      scope: 'urn:opc:resource:fa:scope',
    })
    expect(() =>
      parseClientCredentialAccountSecretBlob(
        blob({
          providerId: 'oracle-fusion-service-account',
          orgId: '',
          instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
          tokenUrl: undefined,
          scope: 'urn:opc:resource:fa:scope',
        }),
        'oracle-fusion-service-account'
      )
    ).toThrow(MALFORMED)
  })
})
