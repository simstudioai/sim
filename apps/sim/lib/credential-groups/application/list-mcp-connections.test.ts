/**
 * @vitest-environment node
 */
import type { SessionPrincipal, WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'

const mocks = vi.hoisted(() => ({
  getWorkspaceOwnerSubscriptionAccess: vi.fn(),
  requirePolicy: vi.fn(),
  listMcpConnections: vi.fn(),
  loadGroup: vi.fn(),
  loadWorkspace: vi.fn(),
  resolveCredentialGroupsAvailability: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@/lib/billing/core/workspace-access', () => ({
  getWorkspaceOwnerSubscriptionAccess: mocks.getWorkspaceOwnerSubscriptionAccess,
}))

vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: async () =>
    (await mocks.resolveCredentialGroupsAvailability()).available,
}))
vi.mock('@/lib/resource-policies/repository', () => ({
  requireResourcePolicy: mocks.requirePolicy,
}))

vi.mock('@/lib/credential-groups/credentials', () => ({
  loadScopedAccountsCredentialListContext: mocks.loadGroup,
}))

vi.mock('@/lib/credential-groups/mcp-connections', () => ({
  CredentialGroupMcpConnectionCursorNotFoundError: class extends Error {
    constructor() {
      super('Credential group MCP connection cursor not found')
      this.name = 'CredentialGroupMcpConnectionCursorNotFoundError'
    }
  },
  listCredentialGroupMcpConnectionReferences: mocks.listMcpConnections,
  MAX_CREDENTIAL_GROUP_MCP_CONNECTION_PAGE_SIZE: 100,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import { listCredentialGroupMcpConnections } from '@/lib/credential-groups/application/list-mcp-connections'
import { CredentialGroupMcpConnectionCursorNotFoundError } from '@/lib/credential-groups/mcp-connections'

const groupContext = {
  credentialGroupId: 'group-1',
  workspaceId: 'workspace-1',
  name: 'Credential Group',
  status: 'active' as const,
  options: [],
}
const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'org-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const input = { workspaceId: 'workspace-1', limit: 50 }

function executorPrincipal(workspaceId = 'workspace-1'): WorkflowExecutionDelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: 'user-1',
    workspaceId,
    delegationId: 'delegation-1',
    audience: 'sim:credential-groups',
    issuedAt: new Date(Date.now() - 1_000),
    expiresAt: new Date(Date.now() + 60_000),
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'workflow-1',
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'deployment-version-1',
      },
    },
  }
}

describe('listCredentialGroupMcpConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', ['workspace-1']),
    })
    mocks.loadGroup.mockResolvedValue(groupContext)
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getWorkspaceOwnerSubscriptionAccess.mockResolvedValue({ isEnterprise: true })
    mocks.resolveCredentialGroupsAvailability.mockResolvedValue({ available: true })
    mocks.listMcpConnections.mockResolvedValue({
      mcpConnections: [
        {
          credentialId: 'mcp-cg-connection-1',
          email: 'person@example.com',
          displayName: 'Fireflies',
          mcpServerId: 'mcp-server-1',
          mcpServerName: 'Fireflies',
          toolNames: ['list_transcripts'],
        },
      ],
      nextCursor: null,
    })
  })

  it('rejects unsupported principals before loading the group', async () => {
    const principal: SessionPrincipal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }

    await expect(
      listCredentialGroupMcpConnections.execute({ principal, input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadGroup).not.toHaveBeenCalled()
  })

  it('rejects executor delegation scoped to another workspace', async () => {
    await expect(
      listCredentialGroupMcpConnections.execute({
        principal: executorPrincipal('workspace-2'),
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.listMcpConnections).not.toHaveBeenCalled()
  })

  it('lists bounded MCP connection references after authorization and entitlement checks', async () => {
    const result = await listCredentialGroupMcpConnections.execute({
      principal: executorPrincipal(),
      input: {
        ...input,
        email: ' Person@Example.COM ',
        mcpServerId: ' mcp-server-1 ',
      },
    })

    expect(mocks.listMcpConnections).toHaveBeenCalledWith({
      organizationId: 'org-1',
      credentialGroupId: 'group-1',
      limit: 50,
      cursor: undefined,
      email: 'person@example.com',
      mcpServerId: 'mcp-server-1',
      connectorId: undefined,
    })
    expect(result).toEqual({
      mcpConnections: [
        {
          credentialId: 'mcp-cg-connection-1',
          email: 'person@example.com',
          displayName: 'Fireflies',
          mcpServerId: 'mcp-server-1',
          mcpServerName: 'Fireflies',
          toolNames: ['list_transcripts'],
        },
      ],
      count: 1,
      hasMore: false,
      nextCursor: null,
    })
  })

  it('rejects invalid filters before querying MCP connections', async () => {
    await expect(
      listCredentialGroupMcpConnections.execute({
        principal: executorPrincipal(),
        input: { ...input, email: 'not-an-email' },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'Email must be a valid address' })
    expect(mocks.listMcpConnections).not.toHaveBeenCalled()
  })

  it('fails before listing when the group is disabled', async () => {
    mocks.loadGroup.mockResolvedValue({ ...groupContext, status: 'disabled' })

    await expect(
      listCredentialGroupMcpConnections.execute({ principal: executorPrincipal(), input })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.listMcpConnections).not.toHaveBeenCalled()
  })

  it('classifies a stale or cross-group cursor as invalid input', async () => {
    mocks.listMcpConnections.mockRejectedValueOnce(
      new CredentialGroupMcpConnectionCursorNotFoundError()
    )

    await expect(
      listCredentialGroupMcpConnections.execute({
        principal: executorPrincipal(),
        input: { ...input, cursor: 'mcp-cg-other' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })
})
