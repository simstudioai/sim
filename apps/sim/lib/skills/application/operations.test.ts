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
import { skillOperations } from '@/lib/skills/application/operations'

/**
 * Pins the workspace-API-key split on skills.
 *
 * A workspace key can create a skill it can then never update or delete, which
 * no sibling resource does, so the asymmetry reads like an oversight. It is not:
 * a skill write is authorized by the per-skill editor row belonging to the
 * acting user, not by workspace role, and a workspace key has no user to check.
 * These tests exist so the next reader finds the reason instead of "fixing" it.
 */
describe('skill operation registry', () => {
  it('gates creation on a human subject, like every other write', () => {
    expect(skillOperations.create).toMatchObject({
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
    })
  })

  /**
   * The invariant the create/delete split violated. A principal kind that can
   * create a skill must be able to remove it, or its only possible interaction
   * with the resource is to accumulate rows it can never reach again.
   *
   * Symmetry alone is not the property. A lifecycle that uniformly ALLOWED a
   * workspace key is just as symmetric and reopens the hole, because the edit
   * paths cannot resolve an acting subject for one. So both halves are pinned:
   * the writes agree on a policy, and the policy they agree on is the one every
   * edit path can honour. The principal kinds are compared directly rather than
   * left to the test's own name.
   */
  it('admits the same principal kinds to every write in the lifecycle', () => {
    const writes = [
      skillOperations.create,
      skillOperations.update,
      skillOperations.upsert,
      skillOperations.delete,
    ]

    expect(new Set(writes.map((operation) => operation.workspaceApiKey))).toEqual(new Set(['deny']))
    for (const operation of writes) {
      expect(operation.principalKinds).toEqual(skillOperations.delete.principalKinds)
    }
  })

  it('gates every edit path on a human subject rather than workspace role', () => {
    for (const operation of [
      skillOperations.update,
      skillOperations.upsert,
      skillOperations.delete,
    ]) {
      expect(operation).toMatchObject({
        /** `read`, not `write` — the editor row is the authority, not the role. */
        minimumRole: 'read',
        workspaceApiKey: 'deny',
        principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
      })
    }
  })

  /**
   * Proves the deny is load-bearing rather than conservative: every edit use
   * case resolves the acting subject before writing, and a workspace key cannot
   * produce one. Allowing the key would replace a `403` with an unclassified
   * throw, which the v2 surface renders as a caller-reachable `500`.
   */
  it('cannot resolve an acting subject for a workspace key', () => {
    expect(() =>
      requirePrincipalSubjectUserId({
        kind: 'workspace_api_key',
        workspaceId: 'workspace-1',
        keyId: 'workspace-key-1',
      })
    ).toThrow(/does not represent a human subject/)
  })

  it('allows workspace keys to read editor rosters but keeps roster mutations personal', () => {
    expect(skillOperations.listEditors).toMatchObject({
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
    })
    for (const operation of [skillOperations.grantEditor, skillOperations.revokeEditor]) {
      expect(operation).toMatchObject({
        minimumRole: 'read',
        workspaceApiKey: 'deny',
        principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
      })
    }
  })

  it('uses unique stable operation IDs', () => {
    const ids = Object.values(skillOperations).map((operation) => operation.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

const sessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const
const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
}

/**
 * The declaration is only half the gate. These call the funnel so a capability
 * cannot be declared on the operations and then read by nothing.
 */
describe('skill operations under a group that blocks skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('admin')
  })

  it('refuses authoring and editor grants, not only loading', async () => {
    resolveGroupConfigMock.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableSkills: true,
    })

    for (const operation of Object.values(skillOperations)) {
      await expect(
        authorizeWorkspaceOperation(sessionPrincipal, operation as WorkspaceOperation, context),
        operation.id
      ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
    }
  })

  it('allows them all when the group withholds nothing', async () => {
    resolveGroupConfigMock.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)

    for (const operation of Object.values(skillOperations)) {
      await expect(
        authorizeWorkspaceOperation(sessionPrincipal, operation as WorkspaceOperation, context),
        operation.id
      ).resolves.toBeUndefined()
    }
  })
})
