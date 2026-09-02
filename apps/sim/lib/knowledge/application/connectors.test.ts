/**
 * @vitest-environment node
 */

import { document } from '@sim/db/schema'
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
  refreshToken: vi.fn(),
  validateConnectorConfig: vi.fn(),
  recordAudit: vi.fn(),
  getUserPermissionConfig: vi.fn(),
  resolveMembersBinding: vi.fn(),
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

vi.mock('@sim/platform-authz/workspace', () => ({
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
  refreshAccessTokenIfNeeded: mocks.refreshToken,
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mocks.getUserPermissionConfig,
}))

vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    confluence: {
      auth: { mode: 'oauth' },
      validateConfig: mocks.validateConnectorConfig,
    },
  },
}))

import {
  createKnowledgeConnector,
  deleteKnowledgeConnector,
  listKnowledgeConnectorDocuments,
  syncKnowledgeConnector,
  updateKnowledgeConnector,
  updateKnowledgeConnectorDocuments,
} from '@/lib/knowledge/application/connectors'
import { capabilityRefusal } from '@/lib/permission-groups/capability-assertions'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

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
    mocks.refreshToken.mockResolvedValue('access-token')
    mocks.validateConnectorConfig.mockResolvedValue({ valid: true })
    mocks.resolveBilling.mockResolvedValue(BILLING)
    mocks.getUserPermissionConfig.mockResolvedValue(null)
  })

  afterAll(resetDbChainMock)

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
    expect(mocks.resolveTokenIdentity).toHaveBeenCalledWith('credential-1', 'workspace-a')
    expect(mocks.refreshToken).toHaveBeenCalledWith(
      'credential-1',
      'credential-owner',
      expect.any(String)
    )
    expect(mocks.validateConnectorConfig).toHaveBeenCalledWith('access-token', { space: 'ENG' })
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
      async (input: { resolveAccessToken: (credentialId: string) => Promise<string | null> }) => {
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
    expect(mocks.refreshToken).not.toHaveBeenCalled()
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
    expect(mocks.refreshToken).not.toHaveBeenCalled()
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
    credentialGroupId: 'group-1',
    credentialGroupOptionId: 'option-1',
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
        binding: { credentialGroupId: 'group-1', credentialGroupOptionId: 'option-1' },
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
})
