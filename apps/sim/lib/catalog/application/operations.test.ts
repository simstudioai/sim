import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
} from '@sim/testing/mocks/permission-group-scope.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { catalogOperations } from '@/lib/catalog/application/operations'
import type { WorkspaceOperation } from '@/lib/core/application'
import { authorizeWorkspaceOperation, PermissionGroupCapabilityError } from '@/lib/core/application'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const resolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig
const sessionPrincipal = createSessionPrincipal()
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
    resolvePermission.mockResolvedValue('admin')
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
