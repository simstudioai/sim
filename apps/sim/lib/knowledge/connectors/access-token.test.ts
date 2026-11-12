import { authOAuthUtilsMock, authOAuthUtilsMockFns } from '@sim/testing/mocks/auth-oauth-utils.mock'
import {
  internalAwsCredentialsMock,
  internalAwsCredentialsMockFns,
} from '@sim/testing/mocks/internal-aws-credentials.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptApiKey } = vi.hoisted(() => ({ mockDecryptApiKey: vi.fn() }))

vi.mock('@/lib/api-key/crypto', () => ({ decryptApiKey: mockDecryptApiKey }))
vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)
vi.mock('@/lib/internal/aws/credentials', () => internalAwsCredentialsMock)

import type { ConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import {
  ConnectorAwsCredentialError,
  connectorServiceAccountScopes,
  connectorServiceAccountSubject,
  createConnectorRunToken,
  resolveConnectorAccessToken,
  syncContextForToken,
} from '@/lib/knowledge/connectors/access-token'
import { isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import { readAwsSession } from '@/connectors/aws-session'
import { gmailConnectorMeta } from '@/connectors/gmail/meta'
import { googleCalendarConnectorMeta } from '@/connectors/google-calendar/meta'
import { s3ConnectorMeta } from '@/connectors/s3/meta'
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

const WORKSPACE_SCOPE = { kind: 'workspace', workspaceId: 'workspace-1' } as const

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

  it("seeds a minted credential's bound account into the sync context, and nothing for OAuth", async () => {
    const bound =
      'https://na3.docusign.net/restapi/v2.1/accounts/99999999-0000-0000-0000-000000000002'
    const resolveDocuSign = () =>
      resolveConnectorAccessToken({
        auth: { mode: 'oauth', provider: 'docusign', requiredScopes: ['signature'] },
        connector: credentialConnector('docusign-credential'),
        userId: 'user-1',
        requestId: 'req-1',
        scope: WORKSPACE_SCOPE,
        sourceConfig: {},
      })

    mockResolveTokenBundle.mockResolvedValueOnce({ accessToken: 'jwt-token', instanceUrl: bound })
    const jwtToken = await resolveDocuSign()
    if (!jwtToken) throw new Error('Expected a JWT Grant connector token')
    expect(syncContextForToken(jwtToken)).toEqual({ credentialInstanceUrl: bound })

    mockResolveTokenBundle.mockResolvedValueOnce({ accessToken: 'oauth-token' })
    const oauthToken = await resolveDocuSign()
    if (!oauthToken) throw new Error('Expected an OAuth connector token')
    expect(syncContextForToken(oauthToken)).toEqual({})
  })

  it('does not accept an undeclared key alternative on other OAuth connectors', async () => {
    await expect(
      resolveConnectorAccessToken({
        auth: OAUTH_AUTH,
        connector: { credentialId: null, encryptedApiKey: 'cipher' },
        userId: 'user-1',
        requestId: 'req-1',
        scope: WORKSPACE_SCOPE,
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
        scope: WORKSPACE_SCOPE,
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
        scope: WORKSPACE_SCOPE,
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
        scope: WORKSPACE_SCOPE,
        sourceConfig: {},
      })
    ).resolves.toBeNull()
  })
})

describe('saved AWS credential on a key connector', () => {
  const session = {
    accessKeyId: 'ASIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'session-secret',
    sessionToken: 'session-token',
    expiration: new Date('2026-11-06T13:00:00Z'),
  }

  beforeEach(() => {
    mockDecryptApiKey.mockResolvedValue({ decrypted: 'inline-secret-key' })
    internalAwsCredentialsMockFns.mockResolveAuthorizedAwsCredential.mockReset()
  })

  it('asks for the credential in the knowledge base scope and seeds its session, not a bearer token', async () => {
    internalAwsCredentialsMockFns.mockResolveAuthorizedAwsCredential.mockResolvedValueOnce(session)
    const organizationScope = { kind: 'organization', organizationId: 'org-1' } as const

    const token = await resolveConnectorAccessToken({
      auth: s3ConnectorMeta.auth,
      connector: credentialConnector('aws-credential'),
      userId: 'user-1',
      requestId: 'sync-run',
      scope: organizationScope,
      sourceConfig: {},
    })
    if (!token) throw new Error('Expected an AWS connector token')

    const [credentialId, context] =
      internalAwsCredentialsMockFns.mockResolveAuthorizedAwsCredential.mock.calls[0]
    expect(credentialId).toBe('aws-credential')
    expect(context).toMatchObject({ organizationId: 'org-1' })
    expect(context.workspaceId).toBeUndefined()
    expect(token.expiresAt).toEqual(session.expiration)
    expect(token.accessToken).toBe('')
    expect(readAwsSession(syncContextForToken(token))).toEqual({
      accessKeyId: session.accessKeyId,
      secretAccessKey: session.secretAccessKey,
      sessionToken: session.sessionToken,
    })
    expect(mockResolveTokenBundle).not.toHaveBeenCalled()
  })

  it('keeps a stored-key S3 connector on its key without touching AWS', async () => {
    const token = await resolveConnectorAccessToken({
      auth: s3ConnectorMeta.auth,
      connector: { credentialId: null, encryptedApiKey: 'encrypted' },
      userId: 'user-1',
      requestId: 'sync-run',
      scope: WORKSPACE_SCOPE,
      sourceConfig: {},
    })

    expect(token).toEqual({ accessToken: 'inline-secret-key' })
    expect(internalAwsCredentialsMockFns.mockResolveAuthorizedAwsCredential).not.toHaveBeenCalled()
  })

  it('reports an unusable AWS credential without leaking its keys', async () => {
    internalAwsCredentialsMockFns.mockResolveAuthorizedAwsCredential.mockRejectedValueOnce(
      Object.assign(new Error('Not authorized to perform sts:AssumeRoleWithWebIdentity'), {
        name: 'AccessDenied',
      })
    )

    await expect(
      resolveConnectorAccessToken({
        auth: s3ConnectorMeta.auth,
        connector: credentialConnector('aws-credential'),
        userId: 'user-1',
        requestId: 'sync-run',
        scope: WORKSPACE_SCOPE,
        sourceConfig: {},
      })
    ).rejects.toMatchObject({ name: 'ConnectorAwsCredentialError', transient: false })
  })

  it('marks an AWS outage as transient rather than a refused credential', async () => {
    internalAwsCredentialsMockFns.mockResolveAuthorizedAwsCredential.mockRejectedValueOnce(
      Object.assign(new Error('Rate exceeded'), {
        name: 'ThrottlingException',
        $metadata: { httpStatusCode: 400 },
      })
    )

    const failure = await resolveConnectorAccessToken({
      auth: s3ConnectorMeta.auth,
      connector: credentialConnector('aws-credential'),
      userId: 'user-1',
      requestId: 'sync-run',
      scope: WORKSPACE_SCOPE,
      sourceConfig: {},
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConnectorAwsCredentialError)
    expect(failure).toMatchObject({ transient: true })
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
      scope: WORKSPACE_SCOPE,
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
      'admin@example.com',
      { service: 'google-drive' }
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
    delegatedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },
  {
    name: 'Google Calendar',
    auth: googleCalendarConnectorMeta.auth,
    delegatedScopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
  },
])('$name declared company authentication', ({ auth, delegatedScopes }) => {
  const directoryScope = 'https://www.googleapis.com/auth/admin.directory.user.readonly'
  const resolve = (accessMode: ConnectorAccessMode) =>
    resolveConnectorAccessToken({
      auth,
      accessMode,
      connector: credentialConnector('google-service'),
      userId: 'actor',
      requestId: 'request',
      scope: WORKSPACE_SCOPE,
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
      'directory.admin@example.com',
      { service: auth.mode === 'oauth' ? auth.provider : undefined }
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
        scope: WORKSPACE_SCOPE,
        sourceConfig: { adminEmail: 'admin@corp.com' },
      })
    ).resolves.toEqual({ accessToken: 'access-token' })
    expect(mockResolveTokenBundle).toHaveBeenCalledWith(
      'credential-1',
      'credential-owner',
      'req-1',
      OAUTH_AUTH.requiredScopes,
      'admin@corp.com',
      { service: 'google-drive' }
    )
  })
})

describe('createConnectorRunToken', () => {
  const NOW = new Date('2026-11-06T12:00:00Z')
  const session = (accessKeyId: string, expiresAt: Date) => ({
    accessToken: 'aws-credential',
    awsSession: { accessKeyId, secretAccessKey: `${accessKeyId}-secret`, sessionToken: 'token' },
    expiresAt,
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  it('keeps an STS session that has time left instead of exchanging it on every page', async () => {
    const resolve = vi.fn()
    const syncContext: Record<string, unknown> = {}
    const runToken = createConnectorRunToken({
      token: session('ASIA1', new Date(NOW.getTime() + 30 * 60_000)),
      syncContext,
      resolve,
    })

    await runToken.refresh()

    expect(resolve).not.toHaveBeenCalled()
    expect(runToken.current().awsSession?.accessKeyId).toBe('ASIA1')
  })

  it('replaces a session close to expiry and signs later calls with the new one', async () => {
    const renewed = session('ASIA2', new Date(NOW.getTime() + 60 * 60_000))
    const syncContext: Record<string, unknown> = {}
    const runToken = createConnectorRunToken({
      token: session('ASIA1', new Date(NOW.getTime() + 60_000)),
      syncContext,
      resolve: async () => renewed,
    })

    await runToken.refresh()

    expect(runToken.current()).toBe(renewed)
    expect(readAwsSession(syncContext)?.accessKeyId).toBe('ASIA2')
  })

  it('re-resolves a token that states no expiry on every refresh', async () => {
    const resolve = vi.fn(async () => ({ accessToken: 'fresh-oauth-token' }))
    const runToken = createConnectorRunToken({
      token: { accessToken: 'oauth-token' },
      syncContext: {},
      resolve,
    })

    await runToken.refresh()

    expect(resolve).toHaveBeenCalledTimes(1)
    expect(runToken.current().accessToken).toBe('fresh-oauth-token')
  })

  it('keeps long-lived saved AWS keys for the whole run instead of reloading them on every page', async () => {
    const resolve = vi.fn()
    const runToken = createConnectorRunToken({
      token: {
        accessToken: '',
        awsSession: { accessKeyId: 'AKIA1', secretAccessKey: 'AKIA1-secret' },
      },
      syncContext: {},
      resolve,
    })

    await runToken.refresh()

    expect(resolve).not.toHaveBeenCalled()
    expect(runToken.current().awsSession?.accessKeyId).toBe('AKIA1')
  })

  it('never re-resolves a stored key', async () => {
    const resolve = vi.fn()
    const runToken = createConnectorRunToken({
      token: { accessToken: 'inline-key' },
      syncContext: {},
      resolve: undefined,
    })

    await runToken.refresh()

    expect(resolve).not.toHaveBeenCalled()
    expect(runToken.current().accessToken).toBe('inline-key')
  })
})
