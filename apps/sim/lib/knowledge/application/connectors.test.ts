/**
 * @vitest-environment node
 */

import { document, member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveKnowledgeBase: vi.fn(),
  resolveConnector: vi.fn(),
  resolvePermission: vi.fn(),
  createConnector: vi.fn(),
  updateConnector: vi.fn(),
  deleteConnector: vi.fn(),
  syncConnector: vi.fn(),
  resolveBilling: vi.fn(),
  getCredentialActorContext: vi.fn(),
  canUseCredential: vi.fn(),
  resolveTokenIdentity: vi.fn(),
  resolveTokenBundle: vi.fn(),
  validateConnectorConfig: vi.fn(),
  recordAudit: vi.fn(),
  getUserPermissionConfig: vi.fn(),
  resolveMembersBinding: vi.fn(),
  provision: vi.fn(),
  decryptApiKey: vi.fn(),
  requireApproval: vi.fn(),
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
  resolveActiveKnowledgeBaseContext: mocks.resolveKnowledgeBase,
  resolveActiveKnowledgeResourceContext: mocks.resolveKnowledgeBase,
  resolveActiveKnowledgeConnectorContext: mocks.resolveConnector,
}))

vi.mock('@/lib/knowledge/orchestration/connector-access', () => ({
  resolveKnowledgeConnectorMembersBinding: mocks.resolveMembersBinding,
}))
vi.mock('@/lib/knowledge/connectors/member-provisioning', () => ({
  provisionKnowledgeConnectorMembersBinding: mocks.provision,
  resolveViewerConnectorMemberships: async () => new Map(),
}))
vi.mock('@/lib/knowledge/connectors/mirrored-access', () => ({
  assertConnectorMirrorsSourceAcls: async () => undefined,
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

vi.mock('@/lib/oauth/credential-service', () => ({
  resolveCredentialTokenBundle: mocks.resolveTokenBundle,
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
        serviceAccountSubjectFieldId: 'adminEmail',
      },
      validateConfig: mocks.validateConnectorConfig,
    },
  },
}))

import {
  createApprovedSearchSource,
  createKnowledgeConnector,
  deleteKnowledgeConnector,
  listKnowledgeConnectorDocuments,
  resolveConnectorCredentialAccessToken,
  syncKnowledgeConnector,
  updateKnowledgeConnector,
  updateKnowledgeConnectorDocuments,
  validateConnectorSourceConfig,
} from '@/lib/knowledge/application/connectors'
import { capabilityRefusal } from '@/lib/permission-groups/capability-assertions'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
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
  it('refuses workspace-wide or unreviewed source ingestion into the canonical search index', async () => {
    mocks.resolveKnowledgeBase.mockResolvedValue({
      ...crossWorkspaceContext,
      knowledgeBase: { ...crossWorkspaceContext.knowledgeBase, isSearchIndex: true },
    })
    mocks.resolvePermission.mockResolvedValue('admin')
    for (const [connectorType, accessMode] of [
      ['confluence', 'workspace'],
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
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolvePermission.mockResolvedValue('write')
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

  it.each(['workspace', 'members'] as const)(
    'keeps ordinary Drive OAuth usable in %s mode',
    async (accessMode) => {
      await expect(
        resolveConnectorCredentialAccessToken({
          credentialId: 'credential-1',
          workspaceId: 'workspace-a',
          actingUserId: 'admin',
          requestId: 'request',
          auth: googleDriveConnectorMeta.auth,
          accessMode,
          sourceConfig: {},
        })
      ).resolves.toEqual({ accessToken: 'access-token' })
      expect(mocks.resolveTokenBundle).toHaveBeenCalledOnce()
    }
  )

  it('mints delegated Drive tokens for an eligible canonical service account', async () => {
    mocks.resolveTokenIdentity.mockResolvedValueOnce({ kind: 'service_account' })
    await expect(
      resolveConnectorCredentialAccessToken({
        credentialId: 'credential-1',
        workspaceId: 'workspace-a',
        actingUserId: 'admin',
        requestId: 'request',
        auth: googleDriveConnectorMeta.auth,
        accessMode: 'admin',
        sourceConfig: { adminEmail: 'Admin@corp.com' },
      })
    ).resolves.toEqual({ accessToken: 'access-token' })
    expect(mocks.resolveTokenBundle).toHaveBeenCalledWith(
      'credential-1',
      'admin',
      'request',
      [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/admin.directory.group.readonly',
        'https://www.googleapis.com/auth/admin.directory.domain.readonly',
      ],
      'admin@corp.com'
    )
  })

  it('rejects an old central Drive OAuth source during settings validation before provider access', async () => {
    const connector = {
      connectorType: 'google_drive',
      credentialId: 'credential-1',
      encryptedApiKey: null,
      accessMode: 'admin',
    } as Parameters<typeof validateConnectorSourceConfig>[0]['connector']
    await expect(
      validateConnectorSourceConfig({
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

  it('validates an existing GitHub PAT while updating source settings without inventing an OAuth owner', async () => {
    const persisted = {
      ...connectorContext.connector,
      connectorType: 'github',
      credentialId: null,
      encryptedApiKey: 'persisted-cipher',
      accessMode: 'workspace' as const,
    }
    const sourceConfig = { owner: 'acme', repo: 'handbook' }
    mocks.resolveConnector.mockResolvedValueOnce({ ...connectorContext, connector: persisted })
    mocks.updateConnector.mockImplementationOnce(
      async (input: {
        validateSourceConfig: (
          connector: typeof persisted,
          sourceConfig: Record<string, unknown>
        ) => Promise<unknown>
      }) => {
        expect(await input.validateSourceConfig(persisted, sourceConfig)).toBeNull()
        return { success: true, connector: { ...persisted, sourceConfig } }
      }
    )

    await updateKnowledgeConnector.execute({
      principal: { kind: 'session', userId: 'writer', sessionId: 'session' },
      input: { connectorId: 'connector-b', updates: { sourceConfig } },
    })

    expect(mocks.decryptApiKey).toHaveBeenCalledWith('persisted-cipher')
    expect(mocks.validateConnectorConfig).toHaveBeenCalledWith('existing-pat', sourceConfig, {
      mirrorsSourceAcls: false,
    })
    expect(mocks.getCredentialActorContext).not.toHaveBeenCalled()
    expect(mocks.resolveTokenIdentity).not.toHaveBeenCalled()
    expect(mocks.resolveTokenBundle).not.toHaveBeenCalled()
    expect(mocks.resolvePermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.decryptApiKey.mock.invocationCallOrder[0]!
    )
  })

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

  it('owns source-config credential resolution and validation after authorization', async () => {
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
        resolveBillingAttribution: mocks.resolveBilling,
        source: 'agent',
      },
    })

    const orchestrationInput = mocks.updateConnector.mock.calls[0]?.[0] as {
      resolveBillingAttribution?: () => Promise<unknown>
      validateSourceConfig?: (
        connector: {
          connectorType: string
          credentialId: string
          encryptedApiKey: null
        },
        sourceConfig: Record<string, unknown>
      ) => Promise<unknown>
    }
    if (!orchestrationInput.validateSourceConfig) {
      throw new Error('Application command did not provide source-config validation')
    }
    if (!orchestrationInput.resolveBillingAttribution) {
      throw new Error('Application command did not provide sync billing attribution')
    }
    await expect(orchestrationInput.resolveBillingAttribution()).resolves.toBe(BILLING)
    await expect(
      orchestrationInput.validateSourceConfig(
        {
          connectorType: 'confluence',
          credentialId: 'credential-1',
          encryptedApiKey: null,
        },
        { space: 'ENG' }
      )
    ).resolves.toBeNull()
    expect(mocks.resolvePermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateConnector.mock.invocationCallOrder[0]
    )
    expect(mocks.getCredentialActorContext).toHaveBeenCalledWith('credential-1', 'shared-user')
    expect(mocks.resolveTokenIdentity).toHaveBeenCalledWith('credential-1', {
      kind: 'workspace',
      workspaceId: 'workspace-a',
    })
    expect(mocks.resolveTokenBundle).toHaveBeenCalledWith(
      'credential-1',
      'credential-owner',
      expect.any(String),
      ['read:confluence-content.all'],
      undefined
    )
    expect(mocks.validateConnectorConfig).toHaveBeenCalledWith(
      'access-token',
      { space: 'ENG' },
      { mirrorsSourceAcls: false }
    )
    expect(mocks.resolveBilling).toHaveBeenCalledWith('workspace-a')
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

  it.each([
    [
      'create',
      createKnowledgeConnector,
      mocks.createConnector,
      {
        knowledgeBaseId: 'knowledge-a',
        assertedWorkspaceId: 'workspace-a',
        connectorType: 'confluence',
        credentialId: 'credential-1',
        sourceConfig: {},
        syncIntervalMinutes: 1440,
        resolveBillingAttribution: mocks.resolveBilling,
      },
      {
        success: true,
        connector: { ...connectorContext.connector, knowledgeBaseId: 'knowledge-a' },
      },
    ],
    [
      'delete',
      deleteKnowledgeConnector,
      mocks.deleteConnector,
      { connectorId: 'connector-b', assertedWorkspaceId: 'workspace-a' },
      { success: true, documentsDeleted: 0, documentsKept: 1 },
    ],
    [
      'sync',
      syncKnowledgeConnector,
      mocks.syncConnector,
      {
        connectorId: 'connector-b',
        assertedWorkspaceId: 'workspace-a',
        resolveBillingAttribution: mocks.resolveBilling,
      },
      { success: true },
    ],
  ])(
    'disables legacy semantic audit and product analytics for %s',
    async (_name, useCase, orchestration, input, outcome) => {
      const sameWorkspaceContext = {
        ...connectorContext,
        workspaceId: 'workspace-a',
        knowledgeBaseId: 'knowledge-a',
        knowledgeBase: { id: 'knowledge-a', name: 'Workspace A docs' },
        connector: { ...connectorContext.connector, knowledgeBaseId: 'knowledge-a' },
      }
      mocks.resolveKnowledgeBase.mockResolvedValueOnce(sameWorkspaceContext)
      mocks.resolveConnector.mockResolvedValueOnce(sameWorkspaceContext)
      orchestration.mockResolvedValueOnce(outcome)

      await useCase.execute({ principal: delegatedPrincipal, input })

      expect(orchestration).toHaveBeenCalledWith(
        expect.objectContaining({
          recordSemanticAudit: false,
          recordProductAnalytics: false,
        })
      )
      expect(mocks.recordAudit).toHaveBeenCalledOnce()
    }
  )

  it('paginates connector documents while returning authoritative total counts', async () => {
    const sameWorkspaceContext = {
      ...connectorContext,
      workspaceId: 'workspace-a',
      knowledgeBaseId: 'knowledge-a',
      knowledgeBase: { id: 'knowledge-a', name: 'Workspace A docs' },
      connector: { ...connectorContext.connector, knowledgeBaseId: 'knowledge-a' },
    }
    mocks.resolveConnector.mockResolvedValueOnce(sameWorkspaceContext)
    queueTableRows(document, [{ value: 5 }])
    queueTableRows(document, [{ value: 2 }])
    queueTableRows(document, [
      { id: 'document-3', filename: 'c.txt', userExcluded: false },
      { id: 'document-4', filename: 'd.txt', userExcluded: true },
    ])

    const result = await listKnowledgeConnectorDocuments.execute({
      principal: delegatedPrincipal,
      input: {
        knowledgeBaseId: 'knowledge-a',
        connectorId: 'connector-b',
        assertedWorkspaceId: 'workspace-a',
        includeExcluded: true,
        limit: 2,
        offset: 2,
      },
    })

    expect(result).toEqual({
      documents: [
        { id: 'document-3', filename: 'c.txt', userExcluded: false },
        { id: 'document-4', filename: 'd.txt', userExcluded: true },
      ],
      counts: { active: 5, excluded: 2 },
      hasMore: false,
      offset: 2,
      limit: 2,
    })
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(3)
    expect(dbChainMockFns.offset).toHaveBeenCalledWith(2)
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

  it('deduplicates connector document IDs before mutation and audit', async () => {
    const sameWorkspaceContext = {
      ...connectorContext,
      workspaceId: 'workspace-a',
      knowledgeBaseId: 'knowledge-a',
      knowledgeBase: { id: 'knowledge-a', name: 'Workspace A docs' },
      connector: { ...connectorContext.connector, knowledgeBaseId: 'knowledge-a' },
    }
    mocks.resolveConnector.mockResolvedValueOnce(sameWorkspaceContext)
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'document-1' }, { id: 'document-2' }])

    const result = await updateKnowledgeConnectorDocuments.execute({
      principal: delegatedPrincipal,
      input: {
        knowledgeBaseId: 'knowledge-a',
        connectorId: 'connector-b',
        assertedWorkspaceId: 'workspace-a',
        operation: 'exclude',
        documentIds: ['document-1', 'document-1', 'document-2'],
      },
    })

    expect(result.documentIds).toEqual(['document-1', 'document-2'])
    const where = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(where).toEqual(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          expect.objectContaining({
            type: 'inArray',
            values: ['document-1', 'document-2'],
          }),
        ]),
      })
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ documentIds: ['document-1', 'document-2'] }),
      })
    )
  })

  it.each([
    { operation: 'exclude' as const, matchesUserExcluded: false, setsUserExcluded: true },
    { operation: 'restore' as const, matchesUserExcluded: true, setsUserExcluded: false },
  ])(
    'targets rows in the opposite state for $operation',
    async ({ operation, matchesUserExcluded, setsUserExcluded }) => {
      const sameWorkspaceContext = {
        ...connectorContext,
        workspaceId: 'workspace-a',
        knowledgeBaseId: 'knowledge-a',
        knowledgeBase: { id: 'knowledge-a', name: 'Workspace A docs' },
        connector: { ...connectorContext.connector, knowledgeBaseId: 'knowledge-a' },
      }
      mocks.resolveConnector.mockResolvedValueOnce(sameWorkspaceContext)
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'document-1' }])

      await updateKnowledgeConnectorDocuments.execute({
        principal: delegatedPrincipal,
        input: {
          knowledgeBaseId: 'knowledge-a',
          connectorId: 'connector-b',
          assertedWorkspaceId: 'workspace-a',
          operation,
          documentIds: ['document-1'],
        },
      })

      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        userExcluded: setsUserExcluded,
        enabled: !setsUserExcluded,
      })
      const where = dbChainMockFns.where.mock.calls.at(-1)?.[0]
      expect(where).toEqual(
        expect.objectContaining({
          conditions: expect.arrayContaining([
            { type: 'eq', left: document.userExcluded, right: matchesUserExcluded },
          ]),
        })
      )
    }
  )

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

    it.each([
      ['the group names it', ['confluence', 'google_drive']],
      ['the group restricts nothing', null],
    ])('permits a connector when %s', async (_case, allowed) => {
      allowOnly(allowed as string[] | null)
      mocks.createConnector.mockResolvedValueOnce({
        success: true,
        connector: { id: 'connector-a', connectorType: 'confluence', syncIntervalMinutes: 1440 },
      })

      const result = await createKnowledgeConnector.execute({
        principal: delegatedPrincipal,
        input: createInput,
      })

      expect(result.connector.id).toBe('connector-a')
      expect(mocks.createConnector).toHaveBeenCalledTimes(1)
    })

    it('leaves an ungoverned caller unaffected', async () => {
      mocks.getUserPermissionConfig.mockResolvedValue(null)
      mocks.createConnector.mockResolvedValueOnce({
        success: true,
        connector: { id: 'connector-a', connectorType: 'confluence', syncIntervalMinutes: 1440 },
      })

      await createKnowledgeConnector.execute({
        principal: delegatedPrincipal,
        input: createInput,
      })

      expect(mocks.createConnector).toHaveBeenCalledTimes(1)
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

      it('permits the sync while the group still names the persisted type', async () => {
        allowOnly(['confluence'])
        mocks.syncConnector.mockResolvedValueOnce({ success: true })

        await syncKnowledgeConnector.execute({
          principal: delegatedPrincipal,
          input: syncInput,
        })

        expect(mocks.syncConnector).toHaveBeenCalledTimes(1)
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
    vi.clearAllMocks()
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

  it('validates the binding and passes it through for an admin', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')

    await createKnowledgeConnector.execute({ principal: sessionPrincipal, input: membersInput })

    expect(mocks.resolveMembersBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-b',
        actingUserId: 'user-1',
        sourceConfig: membersInput.sourceConfig,
      })
    )
    expect(mocks.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        membersBinding: expect.objectContaining({
          credentialGroupId: 'group-1',
          credentialGroupOptionId: 'option-1',
        }),
        credentialId: undefined,
      })
    )
  })

  it('prepares Confluence sign-in during admin setup without granting member crawler access', async () => {
    mocks.resolvePermission.mockResolvedValue('admin')
    await createKnowledgeConnector.execute({
      principal: sessionPrincipal,
      input: { ...membersInput, connectorType: 'confluence', accessMode: 'admin' },
    })
    expect(mocks.provision).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'workspace-b',
      userId: 'user-1',
      connectorMeta: expect.objectContaining({ requiresMemberIdentity: true }),
    })
    expect(mocks.resolveMembersBinding).not.toHaveBeenCalled()
    expect(mocks.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({ membersBinding: undefined, accessMode: 'admin' })
    )
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
    vi.clearAllMocks()
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
