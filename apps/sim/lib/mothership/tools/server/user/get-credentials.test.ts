/**
 * @vitest-environment node
 *
 * Regression test: the credentials response must expose only display metadata,
 * never the connected account's OAuth access/refresh token.
 */

import { account, user } from '@sim/db/schema'
import {
  dbChainMockFns,
  environmentUtilsMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvironmentUtilsMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const SECRET_ACCESS_TOKEN = 'ya29.a0SECRET_GOOGLE_BEARER_TOKEN_DO_NOT_LEAK'

const {
  getAllOAuthServicesMock,
  decodeJwtMock,
  isOAuthServiceDeploymentAvailableMock,
  createIntegrationCredentialVisibilityMock,
  getUserPermissionConfigMock,
  getAccessibleOAuthCredentialsMock,
  checkWorkspaceAccessMock,
  verifyWorkflowAccessMock,
} = vi.hoisted(() => ({
  getAllOAuthServicesMock: vi.fn(),
  decodeJwtMock: vi.fn(),
  isOAuthServiceDeploymentAvailableMock: vi.fn(() => true),
  createIntegrationCredentialVisibilityMock: vi.fn(),
  getUserPermissionConfigMock: vi.fn(),
  getAccessibleOAuthCredentialsMock: vi.fn(),
  checkWorkspaceAccessMock: vi.fn(),
  verifyWorkflowAccessMock: vi.fn(),
}))

const getPersonalAndWorkspaceEnvMock = environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv

afterAll(resetEnvironmentUtilsMock)

vi.mock('@/lib/oauth', () => ({
  getAllOAuthServices: getAllOAuthServicesMock,
  // Real implementation: folds only an alternate authorization server's id onto
  // its service, never a family-wide service-account id.
  canonicalizeServiceProviderId: (
    credentialProviderId: string,
    service?: { providerId: string; additionalProviderIds?: readonly string[] }
  ) =>
    service?.additionalProviderIds?.includes(credentialProviderId)
      ? service.providerId
      : credentialProviderId,
  // Real implementation: the tool resolves a credential's provider id to its
  // service through this, including alternate authorization servers.
  credentialProviderMatchesService: (
    credentialProviderId: string,
    service: {
      providerId: string
      serviceAccountProviderId?: string
      additionalProviderIds?: readonly string[]
    }
  ) =>
    service.providerId === credentialProviderId ||
    service.serviceAccountProviderId === credentialProviderId ||
    (service.additionalProviderIds?.includes(credentialProviderId) ?? false),
}))

vi.mock('@/lib/integrations/availability.server', () => ({
  isOAuthServiceDeploymentAvailable: isOAuthServiceDeploymentAvailableMock,
}))

vi.mock('@/lib/integrations/credential-visibility.server', () => ({
  createIntegrationCredentialVisibility: createIntegrationCredentialVisibilityMock,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  getAllowedIntegrationsFromEnv: vi.fn(() => null),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: getUserPermissionConfigMock,
}))

vi.mock('@/lib/credentials/environment', () => ({
  getAccessibleOAuthCredentials: getAccessibleOAuthCredentialsMock,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: checkWorkspaceAccessMock,
}))

vi.mock('jose', () => ({
  decodeJwt: decodeJwtMock,
}))

vi.mock('@/lib/mothership/auth/permissions', () => ({
  verifyWorkflowAccess: verifyWorkflowAccessMock,
  createPermissionError: (action: string) => `Permission denied: ${action}`,
}))

import { getCredentialsServerTool } from './get-credentials'

/**
 * Wires the two sequential `db.select()` reads the tool performs:
 * 1. `select().from(account).where()` → account rows (awaited directly)
 * 2. `select({...}).from(user).where().limit(1)` → user row
 */
function wireDb(accountRows: unknown[], userRows: Array<{ email: string }>) {
  queueTableRows(account, accountRows)
  queueTableRows(user, userRows)
}

describe('getCredentialsServerTool', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()

    wireDb(
      [
        {
          id: 'acct-google-1',
          providerId: 'google-default',
          accountId: '1234567890',
          idToken: 'jwt-token',
          accessToken: SECRET_ACCESS_TOKEN,
          refreshToken: 'refresh-secret',
          updatedAt: new Date('2026-04-17T02:26:05.546Z'),
        },
      ],
      [{ email: 'brent@cellular.so' }]
    )

    getAllOAuthServicesMock.mockReturnValue([
      {
        serviceId: 'gmail',
        providerId: 'google-default',
        name: 'Google',
        description: 'Google account',
        baseProvider: 'google',
        authType: 'oauth',
      },
      {
        serviceId: 'slack',
        providerId: 'slack',
        serviceAccountProviderId: 'slack-custom-bot',
        name: 'Slack',
        description: 'Slack workspace',
        baseProvider: 'slack',
        authType: 'oauth',
      },
      {
        serviceId: 'notion',
        providerId: 'notion',
        serviceAccountProviderId: 'notion-service-account',
        name: 'Notion',
        description: 'Notion workspace',
        baseProvider: 'notion',
        authType: 'oauth',
      },
      {
        serviceId: 'claude-platform',
        providerId: 'claude-platform',
        name: 'Claude Platform',
        description: 'Claude managed agents',
        baseProvider: 'claude-platform',
        authType: 'service_account',
      },
    ])

    getPersonalAndWorkspaceEnvMock.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
      conflicts: [],
    })

    decodeJwtMock.mockReturnValue({ email: 'brent@cellular.so' })
    isOAuthServiceDeploymentAvailableMock.mockReturnValue(true)
    getUserPermissionConfigMock.mockResolvedValue(null)
    getAccessibleOAuthCredentialsMock.mockResolvedValue([])
    checkWorkspaceAccessMock.mockResolvedValue({ canAdmin: false })
    createIntegrationCredentialVisibilityMock.mockImplementation(
      ({ allowedIntegrationTypes, oauthServices }) => {
        const isAllowed = (service: { serviceId: string }) =>
          allowedIntegrationTypes === null || allowedIntegrationTypes.has(service.serviceId)
        const isOAuthServiceVisible = (service: { serviceId: string; providerId: string }) =>
          isAllowed(service) && isOAuthServiceDeploymentAvailableMock(service.providerId)
        return {
          isOAuthServiceVisible,
          isCredentialVisible: ({ providerId, type }: { providerId: string; type?: string }) => {
            const service = oauthServices.find(
              (candidate: { providerId: string; serviceAccountProviderId?: string }) =>
                candidate.providerId === providerId ||
                candidate.serviceAccountProviderId === providerId
            )
            if (!service || !isAllowed(service)) return !service
            return type === 'service_account' || isOAuthServiceVisible(service)
          },
        }
      }
    )
  })

  it('never returns access tokens for connected OAuth credentials', async () => {
    const result = await getCredentialsServerTool.execute({}, { userId: 'user-1' })

    const credentials = result.oauth.connected.credentials
    expect(credentials).toHaveLength(1)

    for (const credential of credentials) {
      expect(credential).not.toHaveProperty('accessToken')
      expect(credential).not.toHaveProperty('refreshToken')
      expect(credential).not.toHaveProperty('idToken')
    }
  })

  it('returns only masked display metadata for each credential', async () => {
    const result = await getCredentialsServerTool.execute({}, { userId: 'user-1' })

    expect(result.oauth.connected.credentials[0]).toEqual({
      id: 'acct-google-1',
      name: 'brent@cellular.so',
      provider: 'google-default',
      serviceName: 'Google',
      lastUsed: '2026-04-17T02:26:05.546Z',
      isDefault: true,
    })
  })

  it('does not leak the token value anywhere in the serialized response', async () => {
    const result = await getCredentialsServerTool.execute({}, { userId: 'user-1' })

    expect(JSON.stringify(result)).not.toContain(SECRET_ACCESS_TOKEN)
    expect(JSON.stringify(result)).not.toContain('refresh-secret')
  })

  it('does not advertise OAuth providers unavailable in this deployment', async () => {
    isOAuthServiceDeploymentAvailableMock.mockImplementation(
      (providerId: string) => providerId !== 'slack'
    )

    const result = await getCredentialsServerTool.execute({}, { userId: 'user-1' })

    expect(
      result.oauth.notConnected.services.map(
        (service: { providerId: string }) => service.providerId
      )
    ).not.toContain('slack')
  })

  it('uses context.workspaceId and hides integrations disallowed for the viewer', async () => {
    getUserPermissionConfigMock.mockResolvedValue({ allowedIntegrations: ['slack'] })

    const result = await getCredentialsServerTool.execute(
      {},
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(getUserPermissionConfigMock).toHaveBeenCalledWith('user-1', 'workspace-1')
    expect(result.oauth.connected.credentials).toEqual([])
    expect(
      result.oauth.notConnected.services.map(
        (service: { providerId: string }) => service.providerId
      )
    ).toEqual(['slack'])
  })

  it('does not advertise service-account-only entries as OAuth connections', async () => {
    const result = await getCredentialsServerTool.execute({}, { userId: 'user-1' })

    expect(
      result.oauth.notConnected.services.map(
        (service: { providerId: string }) => service.providerId
      )
    ).not.toContain('claude-platform')
  })

  it('does not list a service as not-connected when only an alternate provider is connected', async () => {
    // A credential stored under an alternate authorization server
    // (`salesforce-sandbox`) still connects the canonical service. Recording the
    // raw id would list Salesforce as connected AND not connected at once.
    getAllOAuthServicesMock.mockReturnValue([
      {
        serviceId: 'salesforce',
        providerId: 'salesforce',
        additionalProviderIds: ['salesforce-sandbox'],
        serviceAccountProviderId: 'salesforce-service-account',
        name: 'Salesforce',
        description: 'Salesforce CRM',
        baseProvider: 'salesforce',
        authType: 'oauth',
      },
    ])
    // beforeEach already queued the default Google row; replace the queue so
    // the sandbox account is the only credential this case sees.
    resetDbChainMock()
    wireDb(
      [
        {
          id: 'acct-sf-sandbox',
          providerId: 'salesforce-sandbox',
          accountId: 'sf-1',
          idToken: null,
          updatedAt: new Date('2026-04-17T02:26:05.546Z'),
        },
      ],
      [{ email: 'brent@cellular.so' }]
    )

    const result = await getCredentialsServerTool.execute({}, { userId: 'user-1' })

    expect(
      result.oauth.connected.credentials.map((c: { provider: string }) => c.provider)
    ).toContain('salesforce-sandbox')
    expect(
      result.oauth.notConnected.services.map(
        (service: { providerId: string }) => service.providerId
      )
    ).not.toContain('salesforce')
  })

  it('does not drop a sibling service when a family-wide service account is connected', async () => {
    // One `google-service-account` credential matches EVERY Google service via
    // `serviceAccountProviderId`. Folding it onto the first match would remove
    // exactly one arbitrary product from not-connected and leave the rest.
    getAllOAuthServicesMock.mockReturnValue([
      {
        serviceId: 'gmail',
        providerId: 'google-email',
        serviceAccountProviderId: 'google-service-account',
        name: 'Gmail',
        description: 'Gmail',
        baseProvider: 'google',
        authType: 'oauth',
      },
      {
        serviceId: 'google-drive',
        providerId: 'google-drive',
        serviceAccountProviderId: 'google-service-account',
        name: 'Google Drive',
        description: 'Drive',
        baseProvider: 'google',
        authType: 'oauth',
      },
    ])
    resetDbChainMock()
    wireDb([], [{ email: 'brent@cellular.so' }])
    getAccessibleOAuthCredentialsMock.mockResolvedValue([
      {
        id: 'google-sa-1',
        providerId: 'google-service-account',
        type: 'service_account',
        displayName: 'Google SA',
        updatedAt: new Date('2026-04-17T02:26:05.546Z'),
      },
    ])

    const result = await getCredentialsServerTool.execute(
      {},
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    // Either both stay listed or neither does — never one arbitrary sibling.
    const notConnected = result.oauth.notConnected.services.map(
      (service: { providerId: string }) => service.providerId
    )
    expect(notConnected).toEqual(expect.arrayContaining(['google-email', 'google-drive']))
  })

  it('hides shared service-account credentials disallowed for the viewer', async () => {
    getUserPermissionConfigMock.mockResolvedValue({ allowedIntegrations: ['slack'] })
    getAccessibleOAuthCredentialsMock.mockResolvedValue([
      {
        id: 'notion-service-account-1',
        providerId: 'notion-service-account',
        type: 'service_account',
        displayName: 'Notion token',
        updatedAt: new Date('2026-04-17T02:26:05.546Z'),
      },
    ])

    const result = await getCredentialsServerTool.execute(
      {},
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.oauth.connected.credentials).toEqual([])
  })

  it('resolves the workspace from a workflow in the execution workspace', async () => {
    verifyWorkflowAccessMock.mockResolvedValue({ hasAccess: true, workspaceId: 'workspace-1' })
    getUserPermissionConfigMock.mockResolvedValue({ allowedIntegrations: null })

    await getCredentialsServerTool.execute(
      { workflowId: 'wf-1' },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(verifyWorkflowAccessMock).toHaveBeenCalledWith('user-1', 'wf-1')
    expect(getUserPermissionConfigMock).toHaveBeenCalledWith('user-1', 'workspace-1')
  })

  it('rejects a workflowId whose workspace differs from the execution workspace', async () => {
    verifyWorkflowAccessMock.mockResolvedValue({ hasAccess: true, workspaceId: 'workspace-other' })

    await expect(
      getCredentialsServerTool.execute(
        { workflowId: 'wf-other' },
        { userId: 'user-1', workspaceId: 'workspace-1' }
      )
    ).rejects.toThrow('Workspace ID does not match the Copilot execution workspace')
  })

  it('rejects unauthenticated callers without touching the database', async () => {
    await expect(getCredentialsServerTool.execute({}, undefined)).rejects.toThrow(
      'Authentication required'
    )
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
