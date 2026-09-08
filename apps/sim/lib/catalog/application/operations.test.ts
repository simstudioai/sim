/**
 * @vitest-environment node
 */
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

/**
 * Operation metadata is executable policy, not documentation: it decides which
 * principals reach the use case and at what role. Pinning it here makes
 * widening any of the six a deliberate edit rather than a side effect.
 */
const EXPECTED_OPERATION_IDS = {
  listBlocks: 'catalog.blocks.list',
  readBlock: 'catalog.blocks.read',
  listTools: 'catalog.tools.list',
  readTool: 'catalog.tools.read',
  listConnectorTypes: 'catalog.connector_types.list',
} as const

describe('catalogOperations', () => {
  it('declares exactly the five catalog reads under their published ids', () => {
    expect(Object.keys(catalogOperations).sort()).toEqual(
      Object.keys(EXPECTED_OPERATION_IDS).sort()
    )
    for (const [key, id] of Object.entries(EXPECTED_OPERATION_IDS)) {
      expect(catalogOperations[key as keyof typeof catalogOperations].id).toBe(id)
    }
  })

  it('keeps every catalog read at the read role with workspace keys allowed', () => {
    for (const operation of Object.values(catalogOperations)) {
      expect(operation.minimumRole, operation.id).toBe('read')
      expect(operation.workspaceApiKey, operation.id).toBe('allow')
      expect([...operation.principalKinds].sort(), operation.id).toEqual([
        'oauth_access_token',
        'personal_api_key',
        'session',
        'workspace_api_key',
      ])
    }
  })

  it('admits no delegated principal, because no delegated caller exists yet', () => {
    for (const operation of Object.values(catalogOperations)) {
      expect(operation.principalKinds, operation.id).not.toContain('delegated')
      expect(operation.delegatedServices, operation.id).toBeUndefined()
    }
  })

  it('freezes each operation so a caller cannot widen it at runtime', () => {
    for (const operation of Object.values(catalogOperations)) {
      expect(Object.isFrozen(operation), operation.id).toBe(true)
      expect(Object.isFrozen(operation.principalKinds), operation.id).toBe(true)
    }
  })
})

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
    vi.clearAllMocks()
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
