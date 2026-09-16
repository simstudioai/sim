/** @vitest-environment node */
import type { SessionPrincipal } from '@sim/auth/principal'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  billing: vi.fn(),
  available: vi.fn(),
  group: vi.fn(),
  workspace: vi.fn(),
  permission: vi.fn(),
  requireAccess: vi.fn(),
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
vi.mock('@/lib/credential-groups/application/organization-workspace-access', () => ({
  requireOrganizationAccountsWorkspaceAccess: mocks.requireAccess,
}))
vi.mock('@/lib/mcp/application/context', () => ({ resolveMcpWorkspaceContext: mocks.workspace }))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null) => permission !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))

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
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.billing.mockResolvedValue({ organizationId: 'org-1' })
    mocks.available.mockResolvedValue(true)
    mocks.group.mockResolvedValue({ credentialGroupId: 'group-1' })
    mocks.workspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: 'org-1',
      allowPersonalApiKeys: true,
      billedAccountUserId: 'owner-1',
    })
    mocks.permission.mockResolvedValue('read')
    mocks.requireAccess.mockResolvedValue(undefined)
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
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        credentialGroupId: 'group-1',
        workspaceId: 'workspace-1',
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

  it('denies revoked workspace access before reading credentials', async () => {
    mocks.requireAccess.mockRejectedValue(new Error('Workspace access revoked'))
    await expect(listManagedMcpConnectionsUseCase.execute({ principal, input })).rejects.toThrow(
      'revoked'
    )
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
