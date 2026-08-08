/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveKnowledgeBase: vi.fn(),
  resolveConnector: vi.fn(),
  resolvePermission: vi.fn(),
  createConnector: vi.fn(),
  updateConnector: vi.fn(),
  deleteConnector: vi.fn(),
  syncConnector: vi.fn(),
  resolveBilling: vi.fn(),
  resolveToken: vi.fn(),
  recordAudit: vi.fn(),
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
  resolveActiveKnowledgeConnectorContext: mocks.resolveConnector,
}))

vi.mock('@/lib/knowledge/orchestration/connectors', () => ({
  performCreateKnowledgeConnector: mocks.createConnector,
  performUpdateKnowledgeConnector: mocks.updateConnector,
  performDeleteKnowledgeConnector: mocks.deleteConnector,
  performSyncKnowledgeConnector: mocks.syncConnector,
}))

import {
  createKnowledgeConnector,
  deleteKnowledgeConnector,
  syncKnowledgeConnector,
  updateKnowledgeConnector,
} from '@/lib/knowledge/application/connectors'

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

describe('knowledge connector application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveKnowledgeBase.mockResolvedValue(crossWorkspaceContext)
    mocks.resolveConnector.mockResolvedValue(connectorContext)
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
        resolveAccessToken: mocks.resolveToken,
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
      expect(mocks.resolveToken).not.toHaveBeenCalled()
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
})
