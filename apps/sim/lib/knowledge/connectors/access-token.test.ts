import { authOAuthUtilsMock, authOAuthUtilsMockFns } from '@sim/testing/mocks/auth-oauth-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptApiKey } = vi.hoisted(() => ({ mockDecryptApiKey: vi.fn() }))

vi.mock('@/lib/api-key/crypto', () => ({ decryptApiKey: mockDecryptApiKey }))
vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)

import type { ConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import {
  connectorServiceAccountScopes,
  connectorServiceAccountSubject,
  resolveConnectorAccessToken,
  syncContextForToken,
} from '@/lib/knowledge/connectors/access-token'
import { isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import { gmailConnectorMeta } from '@/connectors/gmail/meta'
import { googleCalendarConnectorMeta } from '@/connectors/google-calendar/meta'
import type { ConnectorAuthConfig } from '@/connectors/types'

const {
  mockResolveCredentialTokenBundle: mockResolveTokenBundle,
  mockResolveOAuthAccountId,
  mockGetServiceAccountToken,
} = authOAuthUtilsMockFns

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
  it('prefers the declared domain-wide-delegation set over the consent set', () => {
    expect(
      connectorServiceAccountScopes({
        ...OAUTH_AUTH,
        serviceAccountScopes: ['https://www.googleapis.com/auth/drive.readonly'],
      })
    ).toEqual(['https://www.googleapis.com/auth/drive.readonly'])
  })
})

describe('resolveConnectorAccessToken', () => {
  beforeEach(() => {
    mockDecryptApiKey.mockResolvedValue({ decrypted: 'plaintext-key' })
    mockResolveTokenBundle.mockResolvedValue({ accessToken: 'access-token' })
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

  it('treats a blank or missing value as no subject', () => {
    expect(connectorServiceAccountSubject(withSubject, {})).toBeUndefined()
    expect(connectorServiceAccountSubject(withSubject, { adminEmail: '  ' })).toBeUndefined()
    expect(connectorServiceAccountSubject(withSubject, { adminEmail: 42 })).toBeUndefined()
  })
})

describe('delegated connector access', () => {
  const driveScope = 'https://www.googleapis.com/auth/drive.readonly'
  const delegationAuth: ConnectorAuthConfig = {
    ...OAUTH_AUTH,
    serviceAccountScopes: [driveScope],
    adminServiceAccountScopes: [
      driveScope,
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
    ],
    serviceAccountDelegationScopes: [driveScope],
    serviceAccountSubjectFieldId: 'adminEmail',
  }

  function resolve(
    auth: ConnectorAuthConfig = delegationAuth,
    accessMode: ConnectorAccessMode = 'admin'
  ) {
    return resolveConnectorAccessToken({
      auth,
      accessMode,
      connector: credentialConnector('service-credential'),
      userId: 'actor',
      requestId: 'request',
      sourceConfig: { adminEmail: 'admin@example.com' },
    })
  }

  beforeEach(() => {
    mockResolveTokenBundle.mockResolvedValue({ accessToken: 'directory-token' })
    mockResolveOAuthAccountId.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'google-service-account',
      credentialId: 'service-credential',
    })
    mockGetServiceAccountToken.mockResolvedValue('user-drive-token')
  })

  it('keeps directory scopes on the admin token and delegates only the declared Drive scope', async () => {
    const token = await resolve()
    expect(mockResolveTokenBundle).toHaveBeenCalledWith(
      'service-credential',
      'actor',
      'request',
      delegationAuth.adminServiceAccountScopes,
      'admin@example.com'
    )
    await expect(token?.getDelegatedAccessToken?.(' Employee@Example.com ')).resolves.toBe(
      'user-drive-token'
    )
    expect(mockGetServiceAccountToken).toHaveBeenCalledWith(
      'service-credential',
      [driveScope],
      'employee@example.com'
    )
    expect(mockResolveTokenBundle).toHaveBeenCalledTimes(1)
    expect(syncContextForToken(token!)).toEqual({
      getDelegatedAccessToken: token?.getDelegatedAccessToken,
    })
    expect(JSON.stringify(syncContextForToken(token!))).toBe('{}')
  })

  it.each([
    null,
    { credentialType: 'oauth', credentialId: 'service-credential', providerId: 'google-drive' },
    {
      credentialType: 'service_account',
      credentialId: 'service-credential',
      providerId: 'atlassian-service-account',
    },
    {
      credentialType: 'managed_oauth',
      credentialId: 'service-credential',
      providerId: 'google-service-account',
    },
  ])('does not give other credential identities a delegated capability: %j', async (identity) => {
    mockResolveOAuthAccountId.mockResolvedValue(identity)
    expect(await resolve()).toEqual({ accessToken: 'directory-token' })
    expect(mockGetServiceAccountToken).not.toHaveBeenCalled()
  })

  it.each(['', '   ', 'not-an-email', 'user@example.com\nother@example.com'])(
    'rejects an invalid delegated subject: %j',
    async (subject) => {
      const token = await resolve()
      await expect(token?.getDelegatedAccessToken?.(subject)).rejects.toThrow(
        'valid Workspace user email'
      )
      expect(mockGetServiceAccountToken).not.toHaveBeenCalled()
    }
  )

  it('captures its scope grant and propagates later credential revocation without OAuth fallback', async () => {
    const scopes = [driveScope]
    const token = await resolve({ ...delegationAuth, serviceAccountDelegationScopes: scopes })
    scopes.push('https://www.googleapis.com/auth/drive')
    await token?.getDelegatedAccessToken?.('employee@example.com')
    expect(mockGetServiceAccountToken).toHaveBeenLastCalledWith(
      'service-credential',
      [driveScope],
      'employee@example.com'
    )
    mockGetServiceAccountToken.mockRejectedValueOnce(new Error('Service account is unavailable'))
    await expect(token?.getDelegatedAccessToken?.('employee@example.com')).rejects.toThrow(
      'Service account is unavailable'
    )
    expect(mockResolveTokenBundle).toHaveBeenCalledTimes(1)
  })
})

describe.each([
  {
    name: 'Gmail',
    auth: gmailConnectorMeta.auth,
    contentScope: 'https://www.googleapis.com/auth/gmail.readonly',
    delegatedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },
  {
    name: 'Google Calendar',
    auth: googleCalendarConnectorMeta.auth,
    contentScope: 'https://www.googleapis.com/auth/calendar.events.readonly',
    delegatedScopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
  },
])('$name declared company authentication', ({ auth, contentScope, delegatedScopes }) => {
  const directoryScope = 'https://www.googleapis.com/auth/admin.directory.user.readonly'
  const resolve = (accessMode: ConnectorAccessMode) =>
    resolveConnectorAccessToken({
      auth,
      accessMode,
      connector: credentialConnector('google-service'),
      userId: 'actor',
      requestId: 'request',
      sourceConfig: {
        adminEmail: ' Directory.Admin@Example.com ',
        scopes: ['untrusted.write'],
        userEmail: 'unverified@example.com',
      },
    })

  beforeEach(() => {
    mockResolveTokenBundle.mockResolvedValue({ accessToken: 'directory-token' })
    mockResolveOAuthAccountId.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'google-service-account',
      credentialId: 'google-service',
    })
    mockGetServiceAccountToken.mockResolvedValue('delegated-read-token')
  })

  it('mints Directory and per-user tokens from actual connector metadata with separate fixed scope sets', async () => {
    const token = await resolve('admin')
    expect(mockResolveTokenBundle).toHaveBeenCalledExactlyOnceWith(
      'google-service',
      'actor',
      'request',
      [directoryScope],
      'directory.admin@example.com'
    )
    expect(token?.getDelegatedAccessToken).toBeTypeOf('function')
    await expect(token?.getDelegatedAccessToken?.(' Employee@Example.com ')).resolves.toBe(
      'delegated-read-token'
    )
    expect(mockGetServiceAccountToken).toHaveBeenCalledExactlyOnceWith(
      'google-service',
      delegatedScopes,
      'employee@example.com'
    )
    expect(syncContextForToken(token!)).toEqual({
      getDelegatedAccessToken: token?.getDelegatedAccessToken,
    })
    expect(JSON.stringify(syncContextForToken(token!))).toBe('{}')
    expect(isConnectorCredentialTypeAllowed(auth, 'admin', 'oauth')).toBe(false)
    expect(isConnectorCredentialTypeAllowed(auth, 'admin', 'service_account')).toBe(true)
  })

  it('propagates service-account revocation without using an OAuth or Directory token fallback', async () => {
    const token = await resolve('admin')
    mockGetServiceAccountToken.mockRejectedValueOnce(new Error('Service account is unavailable'))
    await expect(token?.getDelegatedAccessToken?.('employee@example.com')).rejects.toThrow(
      'Service account is unavailable'
    )
    expect(mockResolveTokenBundle).toHaveBeenCalledOnce()
    expect(mockGetServiceAccountToken).toHaveBeenCalledExactlyOnceWith(
      'google-service',
      delegatedScopes,
      'employee@example.com'
    )
  })
})

describe('impersonation on the connector path', () => {
  const withSubject: ConnectorAuthConfig = {
    ...OAUTH_AUTH,
    serviceAccountSubjectFieldId: 'adminEmail',
  }

  beforeEach(() => {
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
})
