import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import {
  createExecutorPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  billingWorkspaceAccessMock,
  billingWorkspaceAccessMockFns,
} from '@sim/testing/mocks/billing-workspace-access.mock'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  credentialGroupsCredentialsMock,
  credentialGroupsCredentialsMockFns,
} from '@sim/testing/mocks/credential-groups-credentials.mock'
import {
  resourcePolicyRepositoryMock,
  resourcePolicyRepositoryMockFns,
} from '@sim/testing/mocks/resource-policy-repository.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'

const mocks = vi.hoisted(() => ({
  listMcpConnections: vi.fn(),
}))

vi.mock('@/lib/billing/core/workspace-access', () => billingWorkspaceAccessMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/resource-policies/repository', () => resourcePolicyRepositoryMock)
vi.mock('@/lib/credential-groups/credentials', () => credentialGroupsCredentialsMock)

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

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import { listCredentialGroupMcpConnections } from '@/lib/credential-groups/application/list-mcp-connections'
import { CredentialGroupMcpConnectionCursorNotFoundError } from '@/lib/credential-groups/mcp-connections'

const getWorkspaceOwnerSubscriptionAccess =
  billingWorkspaceAccessMockFns.mockGetWorkspaceOwnerSubscriptionAccess
const requirePolicy = resourcePolicyRepositoryMockFns.mockRequireResourcePolicy
const loadGroup = credentialGroupsCredentialsMockFns.mockLoadScopedAccountsCredentialListContext
const isAvailable = credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable
const loadWorkspace = workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext
const resolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission

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
  return createExecutorPrincipal({
    workspaceId,
    audience: 'sim:credential-groups',
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'workflow-1',
      principal: createSessionPrincipal(),
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'deployment-version-1',
      },
    },
  })
}

describe('listCredentialGroupMcpConnections', () => {
  beforeEach(() => {
    requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy(
        'group-1',
        ['workspace-1'].map((workspaceId) => ({ workspaceId, access: { mode: 'all' as const } }))
      ),
    })
    loadGroup.mockResolvedValue(groupContext)
    loadWorkspace.mockResolvedValue(workspaceContext)
    resolvePermission.mockResolvedValue('read')
    getWorkspaceOwnerSubscriptionAccess.mockResolvedValue({ isEnterprise: true })
    isAvailable.mockResolvedValue(true)
    mocks.listMcpConnections.mockResolvedValue({ mcpConnections: [], nextCursor: null })
  })

  it('rejects unsupported principals before loading the group', async () => {
    const principal = createSessionPrincipal()

    await expect(
      listCredentialGroupMcpConnections.execute({ principal, input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(loadGroup).not.toHaveBeenCalled()
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

  it('limits discovery to allowed MCP types and rejects an explicit restricted connector', async () => {
    requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', [
        {
          workspaceId: 'workspace-1',
          access: { mode: 'selected', credentialTypes: ['mcp:fireflies'] },
        },
      ]),
    })
    await listCredentialGroupMcpConnections.execute({ principal: executorPrincipal(), input })
    expect(mocks.listMcpConnections).toHaveBeenCalledWith(
      expect.objectContaining({ allowedConnectorIds: ['fireflies'] })
    )
    mocks.listMcpConnections.mockClear()
    await expect(
      listCredentialGroupMcpConnections.execute({
        principal: executorPrincipal(),
        input: { ...input, connectorId: 'granola' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.listMcpConnections).not.toHaveBeenCalled()
  })

  it('fails before listing when the group is disabled', async () => {
    loadGroup.mockResolvedValue({ ...groupContext, status: 'disabled' })

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
