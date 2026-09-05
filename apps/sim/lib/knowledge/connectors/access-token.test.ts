/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptApiKey, mockResolveTokenBundle } = vi.hoisted(() => ({
  mockDecryptApiKey: vi.fn(),
  mockResolveTokenBundle: vi.fn(),
}))

vi.mock('@/lib/api-key/crypto', () => ({ decryptApiKey: mockDecryptApiKey }))
vi.mock('@/lib/oauth/credential-service', () => ({
  resolveCredentialTokenBundle: mockResolveTokenBundle,
}))

import {
  connectorServiceAccountScopes,
  connectorServiceAccountSubject,
  resolveConnectorAccessToken,
} from '@/lib/knowledge/connectors/access-token'
import type { ConnectorAuthConfig } from '@/connectors/types'

const OAUTH_AUTH: ConnectorAuthConfig = {
  mode: 'oauth',
  provider: 'google-drive',
  requiredScopes: ['https://www.googleapis.com/auth/drive'],
}

const NO_CREDENTIAL = { credentialId: null, encryptedApiKey: null }

function credentialConnector(credentialId: string) {
  return { credentialId, encryptedApiKey: null }
}

describe('connectorServiceAccountScopes', () => {
  it('falls back to the interactive scopes when the sets coincide', () => {
    expect(connectorServiceAccountScopes(OAUTH_AUTH)).toEqual([
      'https://www.googleapis.com/auth/drive',
    ])
  })

  it('prefers the declared domain-wide-delegation set over the consent set', () => {
    expect(
      connectorServiceAccountScopes({
        ...OAUTH_AUTH,
        serviceAccountScopes: ['https://www.googleapis.com/auth/drive.readonly'],
      })
    ).toEqual(['https://www.googleapis.com/auth/drive.readonly'])
  })

  it('has no scopes for an API-key connector', () => {
    expect(connectorServiceAccountScopes({ mode: 'apiKey' })).toBeUndefined()
  })
})

describe('resolveConnectorAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDecryptApiKey.mockResolvedValue({ decrypted: 'plaintext-key' })
    mockResolveTokenBundle.mockResolvedValue({ accessToken: 'access-token' })
  })

  it('decrypts the stored key for an API-key connector', async () => {
    await expect(
      resolveConnectorAccessToken({
        auth: { mode: 'apiKey' },
        connector: { credentialId: null, encryptedApiKey: 'cipher' },
        userId: 'user-1',
        requestId: 'req-1',
        sourceConfig: {},
      })
    ).resolves.toEqual({ accessToken: 'plaintext-key' })
    expect(mockResolveTokenBundle).not.toHaveBeenCalled()
  })

  it('preserves a stored PAT when a connector adds an OAuth connection method', async () => {
    await expect(
      resolveConnectorAccessToken({
        auth: { mode: 'oauth', provider: 'github-repositories', apiKey: { label: 'Token' } },
        connector: { credentialId: null, encryptedApiKey: 'legacy-cipher' },
        userId: 'user-1',
        requestId: 'req-1',
        sourceConfig: {},
      })
    ).resolves.toEqual({ accessToken: 'plaintext-key' })
    expect(mockDecryptApiKey).toHaveBeenCalledWith('legacy-cipher')
    expect(mockResolveTokenBundle).not.toHaveBeenCalled()
  })

  it('uses an explicitly selected OAuth account before a retained legacy key', async () => {
    await expect(
      resolveConnectorAccessToken({
        auth: { mode: 'oauth', provider: 'github-repositories', apiKey: { label: 'Token' } },
        connector: { credentialId: 'account-1', encryptedApiKey: 'legacy-cipher' },
        userId: 'user-1',
        requestId: 'req-1',
        sourceConfig: {},
      })
    ).resolves.toEqual({ accessToken: 'access-token' })
    expect(mockDecryptApiKey).not.toHaveBeenCalled()
  })

  it('does not accept an undeclared key alternative on other OAuth connectors', async () => {
    await expect(
      resolveConnectorAccessToken({
        auth: OAUTH_AUTH,
        connector: { credentialId: null, encryptedApiKey: 'cipher' },
        userId: 'user-1',
        requestId: 'req-1',
        sourceConfig: {},
      })
    ).rejects.toThrow('missing credential ID')
    expect(mockDecryptApiKey).not.toHaveBeenCalled()
  })

  it('resolves an empty token for an optional API-key connector with no key', async () => {
    await expect(
      resolveConnectorAccessToken({
        auth: { mode: 'apiKey', optional: true },
        connector: NO_CREDENTIAL,
        userId: 'user-1',
        requestId: 'req-1',
        sourceConfig: {},
      })
    ).resolves.toEqual({ accessToken: '' })
  })

  it('refuses an API-key connector that requires a key it does not have', async () => {
    await expect(
      resolveConnectorAccessToken({
        auth: { mode: 'apiKey' },
        connector: NO_CREDENTIAL,
        userId: 'user-1',
        requestId: 'req-1',
        sourceConfig: {},
      })
    ).rejects.toThrow('missing encrypted API key')
  })

  it('refuses an OAuth connector with no credential', async () => {
    await expect(
      resolveConnectorAccessToken({
        auth: OAUTH_AUTH,
        connector: NO_CREDENTIAL,
        userId: 'user-1',
        requestId: 'req-1',
        sourceConfig: {},
      })
    ).rejects.toThrow('missing credential ID')
  })

  /**
   * The regression this module exists for: a service-account credential mints
   * against scopes it is told, and Google's resolver throws outright when the
   * caller passes none.
   */
  it('passes the connector scopes through so a service account can mint', async () => {
    await resolveConnectorAccessToken({
      auth: OAUTH_AUTH,
      connector: credentialConnector('credential-1'),
      userId: 'credential-owner',
      requestId: 'req-1',
      sourceConfig: {},
    })
    expect(mockResolveTokenBundle).toHaveBeenCalledWith(
      'credential-1',
      'credential-owner',
      'req-1',
      ['https://www.googleapis.com/auth/drive'],
      undefined
    )
  })

  it('carries the credential cloud id so the connector skips discovering it', async () => {
    mockResolveTokenBundle.mockResolvedValue({ accessToken: 'access-token', cloudId: 'cloud-1' })
    await expect(
      resolveConnectorAccessToken({
        auth: { mode: 'oauth', provider: 'confluence' },
        connector: credentialConnector('credential-1'),
        userId: 'credential-owner',
        requestId: 'req-1',
        sourceConfig: {},
      })
    ).resolves.toEqual({ accessToken: 'access-token', cloudId: 'cloud-1' })
  })

  it('omits the cloud id rather than carrying an empty one', async () => {
    await expect(
      resolveConnectorAccessToken({
        auth: OAUTH_AUTH,
        connector: credentialConnector('credential-1'),
        userId: 'credential-owner',
        requestId: 'req-1',
        sourceConfig: {},
      })
    ).resolves.toEqual({ accessToken: 'access-token' })
  })

  it.each([
    ['no bundle', null],
    ['a bundle with no token', { accessToken: '' }],
  ])('reports %s as no token rather than throwing', async (_label, bundle) => {
    mockResolveTokenBundle.mockResolvedValue(bundle)
    await expect(
      resolveConnectorAccessToken({
        auth: OAUTH_AUTH,
        connector: credentialConnector('credential-1'),
        userId: 'credential-owner',
        requestId: 'req-1',
        sourceConfig: {},
      })
    ).resolves.toBeNull()
  })
})

describe('connectorServiceAccountSubject', () => {
  const withSubject: ConnectorAuthConfig = {
    ...OAUTH_AUTH,
    serviceAccountSubjectFieldId: 'adminEmail',
  }

  it('reads the administrator from the field the connector names', () => {
    expect(connectorServiceAccountSubject(withSubject, { adminEmail: 'Admin@Corp.com ' })).toBe(
      'admin@corp.com'
    )
  })

  it('has no subject when the connector names no field', () => {
    expect(
      connectorServiceAccountSubject(OAUTH_AUTH, { adminEmail: 'admin@corp.com' })
    ).toBeUndefined()
  })

  it('treats a blank or missing value as no subject', () => {
    expect(connectorServiceAccountSubject(withSubject, {})).toBeUndefined()
    expect(connectorServiceAccountSubject(withSubject, { adminEmail: '  ' })).toBeUndefined()
    expect(connectorServiceAccountSubject(withSubject, { adminEmail: 42 })).toBeUndefined()
  })
})

describe('impersonation on the connector path', () => {
  const withSubject: ConnectorAuthConfig = {
    ...OAUTH_AUTH,
    serviceAccountSubjectFieldId: 'adminEmail',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveTokenBundle.mockResolvedValue({ accessToken: 'access-token' })
  })

  it('mints as the administrator the connector is configured to crawl as', async () => {
    await expect(
      resolveConnectorAccessToken({
        auth: withSubject,
        connector: credentialConnector('credential-1'),
        userId: 'credential-owner',
        requestId: 'req-1',
        sourceConfig: { adminEmail: 'admin@corp.com' },
      })
    ).resolves.toEqual({ accessToken: 'access-token' })
    expect(mockResolveTokenBundle).toHaveBeenCalledWith(
      'credential-1',
      'credential-owner',
      'req-1',
      OAUTH_AUTH.requiredScopes,
      'admin@corp.com'
    )
  })

  it('impersonates nobody for a connector that names no subject field', async () => {
    await resolveConnectorAccessToken({
      auth: OAUTH_AUTH,
      connector: credentialConnector('credential-1'),
      userId: 'credential-owner',
      requestId: 'req-1',
      sourceConfig: { adminEmail: 'admin@corp.com' },
    })
    expect(mockResolveTokenBundle).toHaveBeenCalledWith(
      'credential-1',
      'credential-owner',
      'req-1',
      OAUTH_AUTH.requiredScopes,
      undefined
    )
  })
})
