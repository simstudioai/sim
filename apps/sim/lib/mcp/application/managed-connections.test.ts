import type { SessionPrincipal } from '@sim/auth/principal'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  billing: vi.fn(),
  available: vi.fn(),
  group: vi.fn(),
  workspace: vi.fn(),
  permission: vi.fn(),
  scopedAvailable: vi.fn(),
  policy: vi.fn(),
}))
vi.mock('@/lib/billing/core/workspace-access', () => ({
  getWorkspaceOwnerSubscriptionAccess: mocks.billing,
}))
vi.mock('@/lib/credential-groups/availability', () => ({
  isCredentialGroupsAvailable: mocks.available,
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  loadScopedAccountsCredentialListContext: mocks.group,
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.scopedAvailable,
}))
vi.mock('@/lib/resource-policies/repository', () => ({
  requireResourcePolicy: mocks.policy,
}))
vi.mock('@/lib/mcp/application/context', () => ({ resolveMcpWorkspaceContext: mocks.workspace }))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null) => permission !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))

import {
  buildOrganizationAccountAccessPolicy,
  organizationAccountAccessPolicyCodec,
} from '@/lib/credential-groups/application/workspace-access-policy'
import { listManagedMcpConnectionsUseCase } from '@/lib/mcp/application/managed-connections'

const principal: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }
const input = { workspaceId: 'workspace-1' }
const metadata = {
  id: 'mcp-cg-connection-1',
  serverId: 'canonical-1',
  serverName: 'Fireflies',
  serverDescription: 'Meetings',
  managedConnectorId: 'fireflies',
  email: 'person@example.com',
  toolSnapshotBytes: 1024,
  createdAt: new Date('2026-09-01'),
  updatedAt: new Date('2026-09-01'),
}

describe('managed MCP connection catalog', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.billing.mockResolvedValue({ organizationId: 'org-1' })
    mocks.available.mockResolvedValue(true)
    mocks.scopedAvailable.mockResolvedValue(true)
    mocks.group.mockResolvedValue({ credentialGroupId: 'group-1' })
    mocks.workspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: 'org-1',
      allowPersonalApiKeys: true,
      billedAccountUserId: 'owner-1',
    })
    mocks.permission.mockResolvedValue('read')
    mocks.policy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', [
        { workspaceId: 'workspace-1', access: { mode: 'all' } },
      ]),
    })
  })

  it('uses organization ownership and workspace access before exposing credential operations', async () => {
    queueTableRows(schemaMock.credential, [metadata])
    queueTableRows(schemaMock.credential, [
      {
        id: metadata.id,
        tools: ['read', 'write', 'new'].map((name) => ({ name, inputSchema: { type: 'object' } })),
      },
    ])
    const result = await listManagedMcpConnectionsUseCase.execute({ principal, input })
    expect(mocks.group).toHaveBeenCalledWith({ kind: 'organization', organizationId: 'org-1' })
    expect(mocks.policy).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        resourceType: 'credential_group',
        resourceId: 'group-1',
        codec: organizationAccountAccessPolicyCodec,
      })
    )
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.organizationId, 'org-1')
    expect(eq).toHaveBeenCalledWith(schemaMock.mcpServers.organizationId, 'org-1')
    expect(result.tools.map((tool) => tool.name)).toEqual(['read', 'write', 'new'])
    expect(result.servers[0]).toMatchObject({
      id: metadata.id,
      canonicalServerId: 'canonical-1',
      toolCount: 3,
    })
  })

  it.each(['workspace', 'organization'])(
    'returns an empty catalog when %s availability is disabled',
    async (scope) => {
      const available = scope === 'workspace' ? mocks.available : mocks.scopedAvailable
      available.mockResolvedValue(false)
      await expect(listManagedMcpConnectionsUseCase.execute({ principal, input })).resolves.toEqual(
        {
          servers: [],
          tools: [],
        }
      )
      expect(mocks.policy).not.toHaveBeenCalled()
      expect(dbChainMockFns.from).not.toHaveBeenCalled()
    }
  )

  it.each([
    { name: 'no grants', grants: [] },
    {
      name: 'another workspace only',
      grants: [{ workspaceId: 'other-workspace', access: { mode: 'all' as const } }],
    },
    {
      name: 'OAuth only',
      grants: [
        {
          workspaceId: input.workspaceId,
          access: { mode: 'selected' as const, credentialTypes: ['oauth:gmail' as const] },
        },
      ],
    },
  ])('returns an empty catalog without an MCP workspace grant: $name', async ({ grants }) => {
    mocks.policy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', grants),
    })
    await expect(listManagedMcpConnectionsUseCase.execute({ principal, input })).resolves.toEqual({
      servers: [],
      tools: [],
    })
    expect(dbChainMockFns.from).not.toHaveBeenCalled()
  })

  it('only queries connectors granted to this workspace', async () => {
    mocks.policy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', [
        {
          workspaceId: input.workspaceId,
          access: { mode: 'selected', credentialTypes: ['mcp:fireflies'] },
        },
      ]),
    })
    await listManagedMcpConnectionsUseCase.execute({ principal, input })
    expect(inArray).toHaveBeenCalledWith(schemaMock.mcpServers.managedConnectorId, ['fireflies'])
  })

  it('rejects callers without workspace access before checking catalog availability', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(listManagedMcpConnectionsUseCase.execute({ principal, input })).rejects.toThrow(
      'Insufficient workspace permissions'
    )
    expect(mocks.billing).not.toHaveBeenCalled()
    expect(mocks.policy).not.toHaveBeenCalled()
    expect(dbChainMockFns.from).not.toHaveBeenCalled()
  })

  it.each([
    [Array.from({ length: 501 }, () => metadata), 'connection limit'],
    [[{ ...metadata, toolSnapshotBytes: 6 * 1024 * 1024 }], 'metadata limit'],
  ])('bounds discovery before loading snapshots', async (rows, message) => {
    queueTableRows(schemaMock.credential, rows)
    await expect(listManagedMcpConnectionsUseCase.execute({ principal, input })).rejects.toThrow(
      message
    )
    expect(dbChainMockFns.from).toHaveBeenCalledTimes(1)
  })

  it('rejects a snapshot that disappeared or grew beyond the admitted size', async () => {
    queueTableRows(schemaMock.credential, [metadata])
    queueTableRows(schemaMock.credential, [])
    await expect(listManagedMcpConnectionsUseCase.execute({ principal, input })).rejects.toThrow(
      'changed while loading'
    )
  })
})
