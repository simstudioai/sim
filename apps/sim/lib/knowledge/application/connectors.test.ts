import { document, knowledgeConnector, member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveKnowledgeBase: vi.fn(),
  resolveEnvironment: vi.fn(),
  resolveConnector: vi.fn(),
  resolvePermission: vi.fn(),
  createConnector: vi.fn(),
  updateConnector: vi.fn(),
  deleteConnector: vi.fn(),
  syncConnector: vi.fn(),
  resolveBilling: vi.fn(),
  getCredentialActorContext: vi.fn(),
  canUseCredential: vi.fn(),
  authorizeOrganizationCredentialUse: vi.fn(),
  resolveTokenIdentity: vi.fn(),
  resolveTokenBundle: vi.fn(),
  validateConnectorConfig: vi.fn(),
  recordAudit: vi.fn(),
  getUserPermissionConfig: vi.fn(),
  resolveMembersBinding: vi.fn(),
  provision: vi.fn(),
  decryptApiKey: vi.fn(),
  requireApproval: vi.fn(),
  resolveWorkspace: vi.fn(),
  viewerMemberships: vi.fn(),
  getAccess: vi.fn(),
  getForConnectors: vi.fn(),
}))

vi.mock('@/lib/environment/utils', () => ({
  resolveEffectiveEnvironmentVariables: mocks.resolveEnvironment,
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    CONNECTOR_CREATED: 'connector.created',
    CONNECTOR_UPDATED: 'connector.updated',
    CONNECTOR_DELETED: 'connector.deleted',
    CONNECTOR_SYNCED: 'connector.synced',
  },
  AuditResourceType: { CONNECTOR: 'connector' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@/lib/knowledge/search/integration-policy', () => ({
  requireOrganizationSearchApproval: mocks.requireApproval,
  searchIntegrationAccessCondition: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string) => ['owner', 'admin'].includes(role),
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeWorkspaceContext: mocks.resolveWorkspace,
  resolveActiveKnowledgeBaseContext: mocks.resolveKnowledgeBase,
  resolveActiveKnowledgeResourceContext: mocks.resolveKnowledgeBase,
  resolveActiveKnowledgeConnectorContext: mocks.resolveConnector,
}))

vi.mock('@/lib/knowledge/orchestration/connector-access', () => ({
  resolveKnowledgeConnectorMembersBinding: mocks.resolveMembersBinding,
}))
vi.mock('@/lib/knowledge/connectors/member-provisioning', () => ({
  provisionKnowledgeConnectorMembersBinding: mocks.provision,
  resolveViewerConnectorMemberships: mocks.viewerMemberships,
}))
vi.mock('@/lib/knowledge/connectors/mirrored-access', () => ({
  assertConnectorMirrorsSourceAcls: async () => undefined,
}))
vi.mock('@/lib/knowledge/access/scope', () => ({
  WORKSPACE_ACCESS_SCOPE: { kind: 'workspace', tokens: ['pub', 'ws'] },
  createKnowledgeAccessProvider: () => ({
    get: mocks.getAccess,
    getForConnectors: mocks.getForConnectors,
    liveSourceConnectorCondition: async () => ({ type: 'live-sources' }),
  }),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireKnowledgeMemberAccessAvailable: async () => undefined,
}))

vi.mock('@/lib/knowledge/orchestration/connectors', () => ({
  performCreateKnowledgeConnector: mocks.createConnector,
  performUpdateKnowledgeConnector: mocks.updateConnector,
  performDeleteKnowledgeConnector: mocks.deleteConnector,
  performSyncKnowledgeConnector: mocks.syncConnector,
}))

vi.mock('@/lib/credentials/access', () => ({
  getCredentialActorContext: mocks.getCredentialActorContext,
  canUseCredential: mocks.canUseCredential,
  resolveCredentialTokenIdentity: mocks.resolveTokenIdentity,
}))

vi.mock('@/lib/credentials/application/organization-credentials', () => ({
  authorizeOrganizationCredentialUse: mocks.authorizeOrganizationCredentialUse,
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  ServiceAccountTokenError: class extends Error {
    constructor(
      readonly statusCode: number,
      readonly errorDescription: string,
      readonly errorCode?: string
    ) {
      super(errorDescription)
    }
  },
  resolveCredentialTokenBundle: mocks.resolveTokenBundle,
  resolveOAuthAccountId: vi.fn(async () => null),
  getServiceAccountToken: vi.fn(),
}))
vi.mock('@/lib/api-key/crypto', () => ({ decryptApiKey: mocks.decryptApiKey }))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mocks.getUserPermissionConfig,
  getUserPermissionConfigForOrganization: mocks.getUserPermissionConfig,
}))

vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    github: {
      auth: {
        mode: 'oauth',
        provider: 'github-repositories',
        apiKey: { label: 'Personal access token' },
      },
      validateConfig: mocks.validateConnectorConfig,
    },
    confluence: {
      auth: { mode: 'oauth', requiredScopes: ['read:confluence-content.all'] },
      validateConfig: mocks.validateConnectorConfig,
    },
    google_drive: {
      name: 'Google Drive',
      auth: {
        mode: 'oauth',
        provider: 'google-drive',
        adminCredentialType: 'service_account',
        serviceAccountScopes: ['https://www.googleapis.com/auth/drive.readonly'],
        adminServiceAccountScopes: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/admin.directory.user.readonly',
          'https://www.googleapis.com/auth/admin.directory.group.readonly',
          'https://www.googleapis.com/auth/admin.directory.domain.readonly',
        ],
        serviceAccountDelegationScopes: ['https://www.googleapis.com/auth/drive.readonly'],
        serviceAccountSubjectFieldId: 'adminEmail',
      },
      validateConfig: mocks.validateConnectorConfig,
    },
  },
}))

import { internalOrchestrationErrorPolicy } from '@/lib/api/server/routes/internal-json-route'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import * as encryption from '@/lib/core/security/encryption'
import {
  createApprovedSearchSource,
  createKnowledgeConnector,
  deleteKnowledgeConnector,
  listWorkspaceMemberConnectors,
  resolveConnectorCredentialAccessToken,
  syncKnowledgeConnector,
  updateKnowledgeConnector,
  updateKnowledgeConnectorDocuments,
  validateConnectorSourceConfig,
} from '@/lib/knowledge/application/connectors'
import { ServiceAccountTokenError } from '@/lib/oauth/credential-service'
import * as githubInstallation from '@/lib/oauth/github-installation'
import { capabilityRefusal } from '@/lib/permission-groups/capability-assertions'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { confluenceConnectorMeta } from '@/connectors/confluence/meta'
import { gmailConnectorMeta } from '@/connectors/gmail/meta'
import { googleCalendarConnectorMeta } from '@/connectors/google-calendar/meta'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'

const crossWorkspaceContext = {
  workspaceId: 'workspace-b',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-b',
  knowledgeBaseId: 'knowledge-b',
  knowledgeBase: { id: 'knowledge-b', name: 'Workspace B docs' },
}

const connectorContext = {
  ...crossWorkspaceContext,
  access: { get: async () => ({ kind: 'workspace' as const, tokens: ['ws', 'pub'] as const }) },
  connectorId: 'connector-b',
  connector: {
    id: 'connector-b',
    knowledgeBaseId: 'knowledge-b',
    connectorType: 'confluence',
    status: 'active',
  },
}

const delegatedPrincipal = {
  kind: 'delegated' as const,
  serviceId: 'copilot',
  subjectUserId: 'shared-user',
  workspaceId: 'workspace-a',
  delegationId: 'tool-call-1',
  audience: 'sim:knowledge',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: {},
}

const BILLING = { actorUserId: 'shared-user', workspaceId: 'workspace-a' } as never

describe('knowledge connector application use cases', () => {
  const patInput = {
    knowledgeBaseId: 'knowledge-b',
    connectorType: 'gitlab',
    apiKey: '{{GITLAB_PAT}}',
    sourceConfig: { project: 'group/project' },
    syncIntervalMinutes: 1440,
  }
  const patPrincipal = { kind: 'session' as const, userId: 'writer', sessionId: 'session' }

  it('resolves an API-key reference using the caller and canonical workspace before persistence', async () => {
    mocks.resolveEnvironment.mockResolvedValue({ GITLAB_PAT: { value: 'resolved-pat' } })
    mocks.createConnector.mockResolvedValueOnce({
      success: true,
      connector: { id: 'new-connector', connectorType: 'gitlab', accessMode: 'workspace' },
    })
    await createKnowledgeConnector.execute({ principal: patPrincipal, input: patInput })
    expect(mocks.resolveEnvironment).toHaveBeenCalledWith('writer', 'workspace-b', ['GITLAB_PAT'])
    expect(mocks.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'resolved-pat' })
    )
  })

  it('checks workspace write permission before resolving a secret', async () => {
    mocks.resolvePermission.mockResolvedValue('read')
    await expect(
      createKnowledgeConnector.execute({ principal: patPrincipal, input: patInput })
    ).rejects.toMatchObject({ name: 'InsufficientWorkspacePermissionsError' })
    expect(mocks.resolveEnvironment).not.toHaveBeenCalled()
    expect(mocks.createConnector).not.toHaveBeenCalled()
  })

  it.each([{ GITLAB_PAT: { value: 'resolved-pat' } }, { GITLAB_PAT: { value: '' } }])(
    'rejects a shell-style reference to an existing secret instead of storing it as the key',
    async (variables) => {
      mocks.resolveEnvironment.mockResolvedValue(variables)
      await expect(
        createKnowledgeConnector.execute({
          principal: patPrincipal,
          input: { ...patInput, apiKey: ' $GITLAB_PAT ' },
        })
      ).rejects.toMatchObject({
        code: 'validation',
        message:
          'Secret references use {{GITLAB_PAT}}, not $GITLAB_PAT. Pass apiKey as "{{GITLAB_PAT}}" to use the secret.',
      })
      expect(mocks.resolveEnvironment).toHaveBeenCalledWith('writer', 'workspace-b', ['GITLAB_PAT'])
      expect(mocks.createConnector).not.toHaveBeenCalled()
    }
  )

  it('refuses workspace-wide or unreviewed source ingestion into the canonical search index', async () => {
    mocks.resolveKnowledgeBase.mockResolvedValue({
      ...crossWorkspaceContext,
      knowledgeBase: { ...crossWorkspaceContext.knowledgeBase, isSearchIndex: true },
    })
    mocks.resolvePermission.mockResolvedValue('admin')
    for (const [connectorType, accessMode] of [
      ['confluence', 'workspace'],
      ['gitlab', 'workspace'],
      ['notion', 'members'],
    ] as const) {
      await expect(
        createKnowledgeConnector.execute({
          principal: { kind: 'session', userId: 'admin', sessionId: 'session' },
          input: {
            knowledgeBaseId: 'knowledge-b',
            connectorType,
            sourceConfig: {},
            syncIntervalMinutes: 60,
            accessMode,
          },
        })
      ).rejects.toThrow('Search sources must support')
    }
    expect(mocks.createConnector).not.toHaveBeenCalled()
  })

  beforeEach(() => {
    resetDbChainMock()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveWorkspace.mockResolvedValue(crossWorkspaceContext)
    mocks.viewerMemberships.mockResolvedValue(new Map())
    mocks.resolveKnowledgeBase.mockResolvedValue(crossWorkspaceContext)
    mocks.resolveConnector.mockResolvedValue(connectorContext)
    mocks.getCredentialActorContext.mockResolvedValue({
      credential: { id: 'credential-1', workspaceId: 'workspace-a' },
      member: { role: 'member' },
      hasWorkspaceAccess: true,
      canWriteWorkspace: true,
      isAdmin: false,
    })
    mocks.canUseCredential.mockImplementation(
      (access: { hasWorkspaceAccess: boolean; member: unknown; isAdmin: boolean }) =>
        access.hasWorkspaceAccess && (Boolean(access.member) || access.isAdmin)
    )
    mocks.resolveTokenIdentity.mockResolvedValue({ kind: 'oauth', userId: 'credential-owner' })
    mocks.resolveTokenBundle.mockResolvedValue({ accessToken: 'access-token' })
    mocks.decryptApiKey.mockResolvedValue({ decrypted: 'existing-pat' })
    mocks.validateConnectorConfig.mockResolvedValue({ valid: true })
    mocks.resolveBilling.mockResolvedValue(BILLING)
    mocks.getUserPermissionConfig.mockResolvedValue(null)
  })

  afterAll(resetDbChainMock)

  it('counts workspace central Confluence documents only after candidate site admission', async () => {
    const identity = {
      kind: 'user' as const,
      userId: 'reader',
      tokens: ['ws', 's:confluence:-:alice'],
    }
    mocks.getAccess.mockResolvedValue(identity)
    mocks.getForConnectors.mockResolvedValue({
      ...identity,
      confluenceSiteGrants: [
        {
          connectorId: 'cf-source',
          contentCredentialId: 'crawler',
          readerCredentialId: 'personal',
          readerSubjectToken: 's:confluence:-:alice',
          domain: 'company.atlassian.net',
          cloudId: 'cloud-1',
        },
      ],
    })
    mocks.viewerMemberships.mockResolvedValue(new Map([['cf-source', 'connected']]))
    queueTableRows(knowledgeConnector, [
      {
        id: 'cf-source',
        knowledgeBaseId: 'knowledge-b',
        knowledgeBaseName: 'Search',
        knowledgeBaseIsSearchIndex: true,
        connectorType: 'confluence',
        accessMode: 'admin',
        sourceConfig: { domain: 'company.atlassian.net', spaceKey: ['DEMO'] },
        memberSyncStatus: 'idle',
      },
    ])
    queueTableRows(document, [])
    queueTableRows(knowledgeConnector, [{ connectorId: 'cf-source' }])
    queueTableRows(document, [{ connectorId: 'cf-source', count: 2 }])
    const result = await listWorkspaceMemberConnectors.execute({
      principal: { kind: 'session', userId: 'reader', sessionId: 'test' },
      input: { workspaceId: 'workspace-b' },
    })
    expect(mocks.getForConnectors).toHaveBeenCalledWith(['cf-source'], undefined)
    expect(result.connectors).toEqual([
      expect.objectContaining({ connectorId: 'cf-source', viewerDocumentCount: 2 }),
    ])
    expect(JSON.stringify(dbChainMockFns.where.mock.calls.at(-1)?.[0])).toContain(
      'confluence_read_grant'
    )
  })

  it('rejects a forged OAuth credential for central Drive creation before using its token', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.resolveKnowledgeBase.mockResolvedValue({
      ...crossWorkspaceContext,
      workspaceId: 'workspace-a',
    })
    mocks.createConnector.mockImplementationOnce(
      async (input: { resolveAccessToken: (credentialId: string) => Promise<unknown> }) => {
        await input.resolveAccessToken('credential-1')
        throw new Error('An ineligible credential reached connector persistence')
      }
    )
    await expect(
      createKnowledgeConnector.execute({
        principal: { kind: 'session', userId: 'admin', sessionId: 'session' },
        input: {
          knowledgeBaseId: 'knowledge-b',
          connectorType: 'google_drive',
          credentialId: 'credential-1',
          accessMode: 'admin',
          sourceConfig: { adminEmail: 'admin@corp.com' },
          syncIntervalMinutes: 60,
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('requires a service account'),
    })
    expect(mocks.resolveTokenBundle).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('rejects a personal Confluence OAuth credential before central token use', async () => {
    await expect(
      resolveConnectorCredentialAccessToken({
        principal: { kind: 'session', userId: 'admin', sessionId: 'session' },
        credentialId: 'credential-1',
        workspaceId: 'workspace-a',
        actingUserId: 'admin',
        requestId: 'request',
        auth: confluenceConnectorMeta.auth,
        accessMode: 'admin',
        sourceConfig: { domain: 'team.atlassian.net', spaceKey: ['ENG'] },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('requires a service account'),
    })
    expect(mocks.resolveTokenBundle).not.toHaveBeenCalled()
  })

  it.each(['workspace', 'members', 'admin'] as const)(
    'mints only the Drive scopes needed by an eligible service account in %s mode',
    async (accessMode) => {
      mocks.resolveTokenIdentity.mockResolvedValueOnce({ kind: 'service_account' })
      await expect(
        resolveConnectorCredentialAccessToken({
          principal: { kind: 'session', userId: 'admin', sessionId: 'session' },
          credentialId: 'credential-1',
          workspaceId: 'workspace-a',
          actingUserId: 'admin',
          requestId: 'request',
          auth: googleDriveConnectorMeta.auth,
          accessMode,
          sourceConfig: { adminEmail: 'Admin@corp.com' },
        })
      ).resolves.toEqual({ accessToken: 'access-token' })
      expect(mocks.resolveTokenBundle).toHaveBeenCalledWith(
        'credential-1',
        'admin',
        'request',
        accessMode === 'admin'
          ? [
              'https://www.googleapis.com/auth/drive.readonly',
              'https://www.googleapis.com/auth/admin.directory.user.readonly',
              'https://www.googleapis.com/auth/admin.directory.group.readonly',
              'https://www.googleapis.com/auth/admin.directory.domain.readonly',
            ]
          : ['https://www.googleapis.com/auth/drive.readonly'],
        'admin@corp.com'
      )
    }
  )

  it('rejects an old central Drive OAuth source during settings validation before provider access', async () => {
    const connector = {
      connectorType: 'google_drive',
      credentialId: 'credential-1',
      encryptedApiKey: null,
      accessMode: 'admin',
    } as Parameters<typeof validateConnectorSourceConfig>[0]['connector']
    await expect(
      validateConnectorSourceConfig({
        principal: { kind: 'session', userId: 'admin', sessionId: 'session' },
        connector,
        sourceConfig: { adminEmail: 'admin@corp.com' },
        workspaceId: 'workspace-a',
        actingUserId: 'admin',
        requestId: 'request',
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('requires a service account'),
    })
    expect(mocks.validateConnectorConfig).not.toHaveBeenCalled()
    expect(mocks.resolveTokenBundle).not.toHaveBeenCalled()
  })

  it.each([
    { connectorType: 'confluence', apiKey: 'token', error: 'requires an OAuth account' },
    {
      connectorType: 'github',
      apiKey: 'token',
      credentialId: 'credential-1',
      error: 'Choose either an OAuth account or an API key',
    },
    {
      connectorType: 'github',
      apiKey: 'token',
      accessMode: 'members' as const,
      error: 'requires an OAuth account',
    },
  ])(
    'rejects unsupported, mixed, or member API keys before credential use: $connectorType $accessMode',
    async ({ error, ...input }) => {
      mocks.resolvePermission.mockResolvedValue('admin')
      await expect(
        createKnowledgeConnector.execute({
          principal: { kind: 'session', userId: 'admin', sessionId: 'session' },
          input: {
            knowledgeBaseId: 'knowledge-b',
            sourceConfig: {},
            syncIntervalMinutes: 60,
            ...input,
          },
        })
      ).rejects.toThrow(error)
      expect(mocks.createConnector).not.toHaveBeenCalled()
      expect(mocks.getCredentialActorContext).not.toHaveBeenCalled()
      expect(mocks.resolveMembersBinding).not.toHaveBeenCalled()
      expect(mocks.decryptApiKey).not.toHaveBeenCalled()
    }
  )

  it.each(['result', 'exception'] as const)(
    'redacts stored tokens from provider validation %s when editing a connector',
    async (failure) => {
      const message = 'Provider rejected existing-pat'
      if (failure === 'exception') {
        mocks.validateConnectorConfig.mockRejectedValueOnce(
          new OrchestrationError('validation', message)
        )
      } else {
        mocks.validateConnectorConfig.mockResolvedValueOnce({ valid: false, error: message })
      }
      const result = validateConnectorSourceConfig({
        principal: patPrincipal,
        requestId: 'request',
        workspaceId: 'workspace-b',
        actingUserId: 'writer',
        sourceConfig: { owner: 'acme', repo: 'handbook' },
        connector: {
          ...connectorContext.connector,
          connectorType: 'github',
          credentialId: null,
          encryptedApiKey: 'persisted-cipher',
          accessMode: 'workspace',
        } as Parameters<typeof validateConnectorSourceConfig>[0]['connector'],
      })
      if (failure === 'exception') {
        await expect(result).rejects.toMatchObject({
          code: 'validation',
          message: 'Provider rejected [REDACTED]',
        })
      } else {
        await expect(result).resolves.toEqual({
          errorCode: 'validation',
          message: 'Provider rejected [REDACTED]',
        })
      }
    }
  )

  it.each([
    [
      'create',
      createKnowledgeConnector,
      {
        knowledgeBaseId: 'knowledge-b',
        assertedWorkspaceId: 'workspace-a',
        connectorType: 'confluence',
        credentialId: 'credential-1',
        sourceConfig: {},
        syncIntervalMinutes: 1440,
        resolveBillingAttribution: mocks.resolveBilling,
      },
    ],
    [
      'update',
      updateKnowledgeConnector,
      {
        connectorId: 'connector-b',
        assertedWorkspaceId: 'workspace-a',
        updates: { status: 'paused' as const },
      },
    ],
    [
      'delete',
      deleteKnowledgeConnector,
      { connectorId: 'connector-b', assertedWorkspaceId: 'workspace-a' },
    ],
    [
      'sync',
      syncKnowledgeConnector,
      {
        connectorId: 'connector-b',
        assertedWorkspaceId: 'workspace-a',
        resolveBillingAttribution: mocks.resolveBilling,
      },
    ],
  ])(
    'rejects cross-workspace %s before membership, billing, or orchestration',
    async (_name, useCase, input) => {
      await expect(useCase.execute({ principal: delegatedPrincipal, input })).rejects.toMatchObject(
        {
          name: 'DelegatedWorkspaceAuthorizationError',
          code: 'forbidden',
        }
      )

      expect(mocks.resolvePermission).not.toHaveBeenCalled()
      expect(mocks.resolveBilling).not.toHaveBeenCalled()
      expect(mocks.resolveTokenIdentity).not.toHaveBeenCalled()
      expect(mocks.createConnector).not.toHaveBeenCalled()
      expect(mocks.updateConnector).not.toHaveBeenCalled()
      expect(mocks.deleteConnector).not.toHaveBeenCalled()
      expect(mocks.syncConnector).not.toHaveBeenCalled()
      expect(mocks.recordAudit).not.toHaveBeenCalled()
    }
  )

  it('authorizes current delegated membership before orchestration and owns semantic audit', async () => {
    const sameWorkspaceContext = {
      ...connectorContext,
      workspaceId: 'workspace-a',
      knowledgeBaseId: 'knowledge-a',
      knowledgeBase: { id: 'knowledge-a', name: 'Workspace A docs' },
      connector: { ...connectorContext.connector, knowledgeBaseId: 'knowledge-a' },
    }
    const updatedConnector = {
      ...sameWorkspaceContext.connector,
      credentialId: 'credential-1',
      sourceConfig: {},
      syncIntervalMinutes: 1440,
    }
    mocks.resolveConnector.mockResolvedValueOnce(sameWorkspaceContext)
    mocks.updateConnector.mockResolvedValueOnce({
      success: true,
      connector: updatedConnector,
    })

    const result = await updateKnowledgeConnector.execute({
      principal: delegatedPrincipal,
      input: {
        connectorId: 'connector-b',
        assertedWorkspaceId: 'workspace-a',
        updates: { status: 'paused' },
        source: 'agent',
      },
    })

    expect(result.connector).toEqual(updatedConnector)
    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'shared-user',
      'workspace-a',
      null,
      undefined,
      { forUpdate: undefined }
    )
    expect(mocks.resolvePermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateConnector.mock.invocationCallOrder[0]
    )
    expect(mocks.updateConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: 'connector-b',
        userId: 'shared-user',
        source: 'agent',
        recordSemanticAudit: false,
      })
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-a',
        action: 'connector.updated',
        metadata: expect.objectContaining({
          operation: 'knowledge.connectors.update',
          actor: expect.objectContaining({ kind: 'delegated', serviceId: 'copilot' }),
        }),
      })
    )
  })

  it('rejects connector creation when the writer cannot use the workspace credential', async () => {
    const sameWorkspaceContext = {
      ...connectorContext,
      workspaceId: 'workspace-a',
      knowledgeBaseId: 'knowledge-a',
      knowledgeBase: { id: 'knowledge-a', name: 'Workspace A docs' },
      connector: { ...connectorContext.connector, knowledgeBaseId: 'knowledge-a' },
    }
    mocks.resolveKnowledgeBase.mockResolvedValueOnce(sameWorkspaceContext)
    mocks.getCredentialActorContext.mockResolvedValueOnce({
      credential: { id: 'credential-1', workspaceId: 'workspace-a' },
      member: null,
      hasWorkspaceAccess: true,
      canWriteWorkspace: true,
      isAdmin: false,
    })
    mocks.createConnector.mockImplementationOnce(
      async (input: {
        resolveAccessToken: (credentialId: string) => Promise<{ accessToken: string } | null>
      }) => {
        const accessToken = await input.resolveAccessToken('credential-1')
        return accessToken
          ? { success: true, connector: sameWorkspaceContext.connector }
          : {
              success: false,
              error: 'Credential has no access token. Please reconnect your account.',
              errorCode: 'validation',
            }
      }
    )

    await expect(
      createKnowledgeConnector.execute({
        principal: delegatedPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-a',
          assertedWorkspaceId: 'workspace-a',
          connectorType: 'confluence',
          credentialId: 'credential-1',
          sourceConfig: {},
          syncIntervalMinutes: 1440,
          resolveBillingAttribution: mocks.resolveBilling,
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message:
        'Credential is not available to you in this workspace. Ask a credential administrator to grant access or select another credential.',
    })

    expect(mocks.getCredentialActorContext).toHaveBeenCalledWith('credential-1', 'shared-user')
    expect(mocks.resolveTokenIdentity).not.toHaveBeenCalled()
    expect(mocks.resolveTokenBundle).not.toHaveBeenCalled()
  })

  it('rejects source-config revalidation after credential membership is removed', async () => {
    const sameWorkspaceContext = {
      ...connectorContext,
      workspaceId: 'workspace-a',
      knowledgeBaseId: 'knowledge-a',
      knowledgeBase: { id: 'knowledge-a', name: 'Workspace A docs' },
      connector: { ...connectorContext.connector, knowledgeBaseId: 'knowledge-a' },
    }
    mocks.resolveConnector.mockResolvedValueOnce(sameWorkspaceContext)
    mocks.updateConnector.mockResolvedValueOnce({
      success: true,
      connector: { ...sameWorkspaceContext.connector, sourceConfig: { space: 'ENG' } },
    })

    await updateKnowledgeConnector.execute({
      principal: delegatedPrincipal,
      input: {
        connectorId: 'connector-b',
        assertedWorkspaceId: 'workspace-a',
        updates: { sourceConfig: { space: 'ENG' } },
      },
    })

    const orchestrationInput = mocks.updateConnector.mock.calls[0]?.[0] as {
      validateSourceConfig?: (
        connector: {
          connectorType: string
          credentialId: string
          encryptedApiKey: null
          accessMode: 'workspace'
        },
        sourceConfig: Record<string, unknown>
      ) => Promise<unknown>
    }
    if (!orchestrationInput.validateSourceConfig) {
      throw new Error('Application command did not provide source-config validation')
    }
    mocks.getCredentialActorContext.mockResolvedValueOnce({
      credential: { id: 'credential-1', workspaceId: 'workspace-a' },
      member: null,
      hasWorkspaceAccess: true,
      canWriteWorkspace: true,
      isAdmin: false,
    })

    await expect(
      orchestrationInput.validateSourceConfig(
        {
          connectorType: 'confluence',
          credentialId: 'credential-1',
          encryptedApiKey: null,
          accessMode: 'workspace',
        },
        { space: 'ENG' }
      )
    ).rejects.toMatchObject({
      code: 'validation',
      message:
        'Credential is not available to you in this workspace. Ask a credential administrator to grant access or select another credential.',
    })
    expect(mocks.resolveTokenIdentity).not.toHaveBeenCalled()
    expect(mocks.resolveTokenBundle).not.toHaveBeenCalled()
    expect(mocks.validateConnectorConfig).not.toHaveBeenCalled()
  })

  it('caps connector document mutations before persistence', async () => {
    const sameWorkspaceContext = {
      ...connectorContext,
      workspaceId: 'workspace-a',
      knowledgeBaseId: 'knowledge-a',
      knowledgeBase: { id: 'knowledge-a', name: 'Workspace A docs' },
      connector: { ...connectorContext.connector, knowledgeBaseId: 'knowledge-a' },
    }
    mocks.resolveConnector.mockResolvedValueOnce(sameWorkspaceContext)

    await expect(
      updateKnowledgeConnectorDocuments.execute({
        principal: delegatedPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-a',
          connectorId: 'connector-b',
          assertedWorkspaceId: 'workspace-a',
          operation: 'exclude',
          documentIds: Array.from({ length: 101 }, (_, index) => `document-${index}`),
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  describe('connector allow-list', () => {
    const sameWorkspaceContext = {
      ...crossWorkspaceContext,
      workspaceId: 'workspace-a',
      knowledgeBaseId: 'knowledge-a',
      knowledgeBase: { id: 'knowledge-a', name: 'Workspace A docs' },
    }

    const createInput = {
      knowledgeBaseId: 'knowledge-a',
      assertedWorkspaceId: 'workspace-a',
      connectorType: 'confluence',
      credentialId: 'credential-1',
      sourceConfig: {},
      syncIntervalMinutes: 1440,
      resolveBillingAttribution: mocks.resolveBilling,
    }

    beforeEach(() => {
      mocks.resolveKnowledgeBase.mockResolvedValue(sameWorkspaceContext)
    })

    function allowOnly(connectorTypes: string[] | null) {
      mocks.getUserPermissionConfig.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        allowedKnowledgeConnectors: connectorTypes,
      })
    }

    it('refuses a connector the group withholds, before the connector is created', async () => {
      allowOnly(['google_drive'])

      await expect(
        createKnowledgeConnector.execute({ principal: delegatedPrincipal, input: createInput })
      ).rejects.toMatchObject({
        code: 'forbidden',
        message: capabilityRefusal('knowledge.connectors'),
      })

      expect(mocks.createConnector).not.toHaveBeenCalled()
      expect(mocks.recordAudit).not.toHaveBeenCalled()
    })

    /**
     * A manual sync re-runs the pull, so an admin who has since removed the
     * source from the allowlist has withdrawn it. The type comes off the
     * persisted connector, which is the only place the request names it.
     */
    describe('manual sync', () => {
      const syncInput = {
        knowledgeBaseId: 'knowledge-a',
        connectorId: 'connector-b',
        assertedWorkspaceId: 'workspace-a',
        resolveBillingAttribution: mocks.resolveBilling,
      }

      beforeEach(() => {
        mocks.resolveConnector.mockResolvedValue({
          ...connectorContext,
          workspaceId: 'workspace-a',
          knowledgeBaseId: 'knowledge-a',
          knowledgeBase: { id: 'knowledge-a', name: 'Workspace A docs' },
          connector: { ...connectorContext.connector, knowledgeBaseId: 'knowledge-a' },
        })
      })

      it('refuses a sync of a connector whose type the group no longer names', async () => {
        allowOnly(['google_drive'])

        await expect(
          syncKnowledgeConnector.execute({ principal: delegatedPrincipal, input: syncInput })
        ).rejects.toMatchObject({
          code: 'forbidden',
          message: capabilityRefusal('knowledge.connectors'),
        })

        expect(mocks.syncConnector).not.toHaveBeenCalled()
        expect(mocks.recordAudit).not.toHaveBeenCalled()
      })

      /**
       * Pausing and deleting stay reachable: the point is to stop the member
       * re-running the pull, never to strand the connector.
       */
      it('still lets the same caller pause and delete the withheld connector', async () => {
        allowOnly(['google_drive'])
        mocks.updateConnector.mockResolvedValueOnce({
          success: true,
          connector: { ...connectorContext.connector, knowledgeBaseId: 'knowledge-a' },
        })
        mocks.deleteConnector.mockResolvedValueOnce({
          success: true,
          documentsDeleted: 0,
          documentsKept: 1,
        })

        await updateKnowledgeConnector.execute({
          principal: delegatedPrincipal,
          input: {
            connectorId: 'connector-b',
            assertedWorkspaceId: 'workspace-a',
            updates: { status: 'paused' },
            resolveBillingAttribution: mocks.resolveBilling,
          },
        })
        await deleteKnowledgeConnector.execute({
          principal: delegatedPrincipal,
          input: { connectorId: 'connector-b', assertedWorkspaceId: 'workspace-a' },
        })

        expect(mocks.updateConnector).toHaveBeenCalledTimes(1)
        expect(mocks.deleteConnector).toHaveBeenCalledTimes(1)
      })
    })
  })
})

describe('members-mode connector creation', () => {
  const sessionPrincipal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
  const membersInput = {
    knowledgeBaseId: 'knowledge-b',
    connectorType: 'google_drive',
    sourceConfig: { folderId: ['f-1'] },
    syncIntervalMinutes: 1440,
    accessMode: 'members' as const,
  }

  beforeEach(() => {
    mocks.resolveKnowledgeBase.mockResolvedValue(crossWorkspaceContext)
    mocks.getUserPermissionConfig.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)
    mocks.resolveMembersBinding.mockResolvedValue({
      credentialGroupId: 'group-1',
      credentialGroupOptionId: 'option-1',
      workspaceId: 'workspace-b',
    })
    mocks.createConnector.mockResolvedValue({
      success: true,
      connector: {
        id: 'connector-1',
        connectorType: 'google_drive',
        syncIntervalMinutes: 1440,
        accessMode: 'members',
        credentialId: null,
      },
    })
  })

  it('refuses members mode to a member below admin', async () => {
    mocks.resolvePermission.mockResolvedValue('write')

    await expect(
      createKnowledgeConnector.execute({ principal: sessionPrincipal, input: membersInput })
    ).rejects.toMatchObject({ name: 'InsufficientWorkspacePermissionsError' })
    expect(mocks.createConnector).not.toHaveBeenCalled()
  })
})

describe('approved organization member source creation', () => {
  const principal = { kind: 'session', userId: 'actor', sessionId: 'session' } as const
  const input = {
    knowledgeBaseId: 'org-index',
    assertedOrganizationId: 'org',
    connectorType: 'google_drive',
    sourceConfig: {},
  }
  beforeEach(() => {
    resetDbChainMock()
    queueTableRows(member, [{ role: 'member' }])
    mocks.getUserPermissionConfig.mockResolvedValue(null)
    mocks.requireApproval.mockResolvedValue(undefined)
    mocks.resolveKnowledgeBase.mockResolvedValue({
      organizationId: 'org',
      knowledgeBaseId: 'org-index',
      knowledgeBase: { id: 'org-index', name: 'Search', isSearchIndex: true },
    })
    mocks.resolveMembersBinding.mockResolvedValue({
      organizationId: 'org',
      credentialGroupId: 'group',
      credentialGroupOptionId: 'option',
    })
    mocks.createConnector.mockResolvedValue({
      success: true,
      connector: { id: 'connector', connectorType: 'google_drive', accessMode: 'members' },
    })
  })

  it('uses the member actor and ignores attempts to supply credentials or broader access', async () => {
    const maliciousInput = {
      ...input,
      credentialId: 'other-person',
      apiKey: 'injected',
      accessMode: 'admin',
    }
    await createApprovedSearchSource.execute({ principal, input: maliciousInput })
    expect(mocks.requireApproval).toHaveBeenCalledWith('org', 'google_drive')
    expect(mocks.resolveMembersBinding).toHaveBeenCalledWith(
      expect.objectContaining({ actingUserId: 'actor', organizationId: 'org' })
    )
    expect(mocks.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor',
        accessMode: 'members',
        credentialId: undefined,
        apiKey: undefined,
      })
    )
  })

  it('refuses deactivated integrations before provisioning a credential group', async () => {
    mocks.requireApproval.mockRejectedValue(new Error('Integration is deactivated'))
    await expect(createApprovedSearchSource.execute({ principal, input })).rejects.toThrow(
      'deactivated'
    )
    expect(mocks.resolveMembersBinding).not.toHaveBeenCalled()
    expect(mocks.createConnector).not.toHaveBeenCalled()
  })

  it('refuses custom configuration outside the personal setup fields', async () => {
    await expect(
      createApprovedSearchSource.execute({
        principal,
        input: { ...input, sourceConfig: { adminEmail: 'other-person@fixture.test' } },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.createConnector).not.toHaveBeenCalled()
  })

  it('refuses a knowledge base that is not the organization Search index', async () => {
    mocks.resolveKnowledgeBase.mockResolvedValue({
      organizationId: 'org',
      knowledgeBaseId: 'org-index',
      knowledgeBase: { isSearchIndex: false },
    })
    await expect(createApprovedSearchSource.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.createConnector).not.toHaveBeenCalled()
  })
})

describe('organization connector credential authorization', () => {
  const principal = { kind: 'session', userId: 'org-admin', sessionId: 'session' } as const
  const credential = {
    id: 'org-service-account',
    organizationId: 'org',
    workspaceId: null,
    type: 'service_account',
    providerId: 'google-service-account',
    createdBy: 'org-admin',
  }
  const input = {
    principal,
    credentialId: credential.id,
    organizationId: 'org',
    actingUserId: principal.userId,
    requestId: 'request',
    auth: googleDriveConnectorMeta.auth,
    accessMode: 'admin' as const,
    sourceConfig: { adminEmail: 'admin@corp.com' },
  }

  beforeEach(() => {
    resetDbChainMock()
    mocks.getCredentialActorContext.mockResolvedValue({
      credential: null,
      member: null,
      hasWorkspaceAccess: false,
      canWriteWorkspace: false,
      isAdmin: false,
    })
    mocks.authorizeOrganizationCredentialUse.mockResolvedValue({
      credential,
      userId: principal.userId,
    })
    mocks.resolveTokenIdentity.mockResolvedValue({ kind: 'service_account' })
    mocks.resolveTokenBundle.mockResolvedValue({ accessToken: 'organization-token' })
    mocks.validateConnectorConfig.mockResolvedValue({ valid: true })
    mocks.getUserPermissionConfig.mockResolvedValue(null)
  })

  it('uses organization credential policy without requiring a workspace membership', async () => {
    await expect(resolveConnectorCredentialAccessToken(input)).resolves.toEqual({
      accessToken: 'organization-token',
    })
    expect(mocks.authorizeOrganizationCredentialUse).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        organizationId: 'org',
        credentialId: credential.id,
        requestId: 'request',
      })
    )
    expect(mocks.getCredentialActorContext).not.toHaveBeenCalled()
    expect(mocks.resolveTokenIdentity).toHaveBeenCalledWith(credential.id, {
      kind: 'organization',
      organizationId: 'org',
    })
    expect(mocks.resolveTokenBundle).toHaveBeenCalledWith(
      credential.id,
      principal.userId,
      'request',
      googleDriveConnectorMeta.auth.mode === 'oauth'
        ? googleDriveConnectorMeta.auth.adminServiceAccountScopes
        : undefined,
      'admin@corp.com'
    )
  })

  it.each([googleDriveConnectorMeta, gmailConnectorMeta, googleCalendarConnectorMeta])(
    'projects $name token rejections as safe setup errors',
    async ({ auth }) => {
      mocks.resolveTokenBundle.mockRejectedValueOnce(
        new ServiceAccountTokenError(401, 'private provider payload', 'unauthorized_client')
      )
      const error = await resolveConnectorCredentialAccessToken({ ...input, auth }).catch(
        (error: unknown) => error
      )
      expect(error).toBeInstanceOf(OrchestrationError)
      expect(internalOrchestrationErrorPolicy.project(error)).toMatchObject({
        status: 400,
        body: { error: expect.stringContaining('(unauthorized_client)') },
      })
      expect((error as Error).message).toContain('numeric client ID')
      expect((error as Error).message).toContain(
        "exact domain-wide delegation scopes in this connector's service-account setup section"
      )
      expect((error as Error).message).not.toContain('private provider payload')
      expect(mocks.authorizeOrganizationCredentialUse).toHaveBeenCalledOnce()
    }
  )

  it('does not mint a token after the credential creator leaves the organization', async () => {
    mocks.resolveTokenIdentity.mockResolvedValueOnce(null)
    await expect(resolveConnectorCredentialAccessToken(input)).resolves.toBeNull()
    expect(mocks.resolveTokenBundle).not.toHaveBeenCalled()
  })
})

describe('GitHub installation source rejection at the application boundary', () => {
  const principal = { kind: 'session', userId: 'org-admin', sessionId: 'session' } as const
  const sourceConfig = { repository: 'example/private', githubRepositoryId: '123' }
  const credential = {
    id: 'installation-credential',
    organizationId: 'org',
    workspaceId: null,
    providerId: 'github-app-installation',
    type: 'service_account',
    encryptedServiceAccountKey: 'encrypted-binding',
    providerSubjectId: '42',
    providerTenantId: '7',
    revokedAt: null,
  }
  const connector = {
    id: 'source',
    connectorType: 'github',
    credentialId: credential.id,
    accessMode: 'members' as const,
    sourceConfig,
    encryptedApiKey: null,
  }
  const createInput = {
    knowledgeBaseId: 'org-index',
    assertedOrganizationId: 'org',
    connectorType: 'github',
    credentialId: credential.id,
    accessMode: 'members' as const,
    sourceConfig,
    syncIntervalMinutes: 60,
  }
  const validationMessage =
    'Check that the repository is included in the selected GitHub App installation, then retry.'

  beforeEach(() => {
    resetDbChainMock()
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(member, [{ role: 'admin' }])
    const context = {
      organizationId: 'org',
      knowledgeBaseId: 'org-index',
      knowledgeBase: { id: 'org-index', name: 'Search', isSearchIndex: true },
    }
    mocks.resolveKnowledgeBase.mockResolvedValue(context)
    mocks.resolveConnector.mockResolvedValue({ ...context, connectorId: connector.id, connector })
    mocks.getUserPermissionConfig.mockResolvedValue(null)
    mocks.authorizeOrganizationCredentialUse.mockResolvedValue({ credential })
    mocks.resolveTokenIdentity.mockResolvedValue({ kind: 'service_account' })
    mocks.resolveTokenBundle.mockResolvedValue({ accessToken: 'repository-token' })
    mocks.resolveMembersBinding.mockResolvedValue({
      credentialGroupId: 'group',
      credentialGroupOptionId: 'option',
      organizationId: 'org',
      sourceConfig,
    })
    vi.spyOn(encryption, 'decryptSecret').mockResolvedValue({
      decrypted: JSON.stringify({
        type: 'github_app_installation',
        version: 1,
        appId: '1',
        appClientId: 'app-client',
        installationId: '42',
        accountId: '7',
        accountType: 'Organization',
        accountLogin: 'example',
        repositorySelection: 'selected',
      }),
    })
    vi.spyOn(githubInstallation, 'resolveGitHubInstallationRepository').mockResolvedValue({
      id: '123',
      fullName: sourceConfig.repository,
      defaultBranch: 'main',
    })
    mocks.createConnector.mockImplementation(
      async (input: { resolveAccessToken(id: string): Promise<unknown> }) => {
        await input.resolveAccessToken(credential.id)
        throw new Error('Unexpected connector persistence')
      }
    )
    mocks.updateConnector.mockImplementation(
      async (input: {
        prepareSourceConfig(
          currentConnector: typeof connector,
          config: typeof sourceConfig
        ): Promise<typeof sourceConfig>
        validateSourceConfig(
          currentConnector: typeof connector,
          config: typeof sourceConfig
        ): Promise<unknown>
      }) => {
        const prepared = await input.prepareSourceConfig(connector, sourceConfig)
        await input.validateSourceConfig(connector, prepared)
        throw new Error('Unexpected connector persistence')
      }
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetDbChainMock()
  })

  it.each([
    [422, 'repository-token'],
    [404, 'repository'],
  ] as const)(
    'returns a safe validation response for GitHub %s during %s',
    async (status, operation) => {
      vi.mocked(githubInstallation.resolveGitHubInstallationRepository).mockRejectedValueOnce(
        new githubInstallation.GitHubInstallationError(
          'private provider payload',
          status,
          operation
        )
      )
      const error = await createKnowledgeConnector
        .execute({ principal, input: createInput })
        .catch((error: unknown) => error)
      expect(error).toBeInstanceOf(OrchestrationError)
      expect(internalOrchestrationErrorPolicy.project(error)).toMatchObject({
        status: 400,
        body: { error: validationMessage },
      })
      expect(mocks.authorizeOrganizationCredentialUse).toHaveBeenCalledWith(
        expect.objectContaining({ principal, organizationId: 'org', credentialId: credential.id })
      )
      expect(mocks.createConnector).not.toHaveBeenCalled()
      expect(mocks.recordAudit).not.toHaveBeenCalled()
    }
  )
})
