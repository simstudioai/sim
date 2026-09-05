/**
 * @vitest-environment node
 */
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
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

import type { WorkspaceOperation } from '@/lib/core/application'
import { authorizeWorkspaceOperation, PermissionGroupCapabilityError } from '@/lib/core/application'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { sandboxOperations } from '@/lib/sandboxes/application/operations'

describe('sandbox operation registry', () => {
  it('lets any member, and a workspace key, read what the workspace built', () => {
    for (const operation of [sandboxOperations.list, sandboxOperations.read]) {
      expect(operation).toMatchObject({
        minimumRole: 'read',
        workspaceApiKey: 'allow',
        capability: 'sandboxes.use',
        principalKinds: [
          'session',
          'personal_api_key',
          'oauth_access_token',
          'workspace_api_key',
          'delegated',
        ],
        delegatedServices: ['copilot'],
      })
    }
  })

  /**
   * Builds cost provider compute, so every write is an admin decision. The
   * admin ceiling is also what denies workspace keys: each write resolves the
   * acting person as the sandbox's creator, which a workspace key cannot
   * supply, so allowing one would replace a `403` with an unclassified throw.
   */
  it('reserves every write for a workspace admin acting as a person', () => {
    for (const operation of [
      sandboxOperations.create,
      sandboxOperations.update,
      sandboxOperations.delete,
    ]) {
      expect(operation).toMatchObject({
        minimumRole: 'admin',
        workspaceApiKey: 'deny',
        capability: 'sandboxes.use',
        principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
        delegatedServices: ['copilot'],
      })
    }
  })

  it('cannot resolve an acting subject for a workspace key', () => {
    expect(() =>
      requirePrincipalSubjectUserId({
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'workspace-key-1',
      })
    ).toThrow(/does not represent a human subject/)
  })

  it('uses unique stable operation IDs', () => {
    const ids = Object.values(sandboxOperations).map((operation) => operation.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'sandboxes.list',
      'sandboxes.read',
      'sandboxes.create',
      'sandboxes.update',
      'sandboxes.delete',
    ])
  })
})

const sessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const
const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
}

/**
 * The declaration is only half the gate. These call the funnel so the
 * capability cannot be declared on the operations and then read by nothing.
 */
describe('sandbox operations under a group that withholds the module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('admin')
  })

  it('refuses every operation, reads included', async () => {
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideSandboxesTab: true,
    })

    for (const operation of Object.values(sandboxOperations)) {
      await expect(
        authorizeWorkspaceOperation(sessionPrincipal, operation as WorkspaceOperation, context),
        operation.id
      ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
    }
  })

  it('allows them all when the group withholds nothing', async () => {
    resolveGroupConfigMock.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)

    for (const operation of Object.values(sandboxOperations)) {
      await expect(
        authorizeWorkspaceOperation(sessionPrincipal, operation as WorkspaceOperation, context),
        operation.id
      ).resolves.toBeUndefined()
    }
  })
})
