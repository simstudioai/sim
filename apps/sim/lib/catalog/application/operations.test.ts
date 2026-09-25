import { permissionGroupScopeMock, permissionGroupScopeMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePermission: vi.fn(),
}))

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { catalogOperations } from '@/lib/catalog/application/operations'
import type { WorkspaceOperation } from '@/lib/core/application'
import { authorizeWorkspaceOperation, PermissionGroupCapabilityError } from '@/lib/core/application'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const sessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const
const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
}

/**
 * The connector-type catalog is the one entry with a capability, so the split
 * is pinned from both sides: hiding knowledge bases must close it, and must not
 * close the block and tool catalogs the editor needs to render at all.
 */
describe('catalog operations under a group that hides knowledge bases', () => {
  beforeEach(() => {
    mocks.resolvePermission.mockResolvedValue('admin')
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideKnowledgeBaseTab: true,
    })
  })

  it('refuses the connector-type catalog', async () => {
    await expect(
      authorizeWorkspaceOperation(
        sessionPrincipal,
        catalogOperations.listConnectorTypes as WorkspaceOperation,
        context
      )
    ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
  })

  it('still answers the block and tool catalogs', async () => {
    for (const operation of [
      catalogOperations.listBlocks,
      catalogOperations.readBlock,
      catalogOperations.listTools,
      catalogOperations.readTool,
    ]) {
      await expect(
        authorizeWorkspaceOperation(sessionPrincipal, operation as WorkspaceOperation, context),
        operation.id
      ).resolves.toBeUndefined()
    }
  })
})
