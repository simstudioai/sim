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
})
