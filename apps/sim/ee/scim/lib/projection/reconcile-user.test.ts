/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import {
  member,
  permissionGroupMember,
  permissions,
  scimGroupMember,
  scimProjectionGrant,
  scimUser,
  workspace,
} from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquireLocks: vi.fn(),
  changeMemberRole: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  grantWorkspace: vi.fn(),
  lowerWorkspace: vi.fn(),
  readPermission: vi.fn(),
  revokeWorkspace: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationUserMutationLocks: mocks.acquireLocks,
}))
vi.mock('@/lib/organizations/members/lifecycle', () => ({
  changeMemberRoleTx: mocks.changeMemberRole,
}))
vi.mock('@/lib/permission-groups/application/group-membership', () => ({
  addPermissionGroupMemberTx: mocks.addMember,
  removePermissionGroupMemberTx: mocks.removeMember,
  PermissionGroupNotFoundError: class PermissionGroupNotFoundError extends Error {},
  PermissionGroupScopeConflictError: class PermissionGroupScopeConflictError extends Error {
    conflicts: unknown[] = []
  },
}))
vi.mock('@/lib/workspaces/access/workspace-access', () => ({
  grantWorkspaceAccessTx: mocks.grantWorkspace,
  lowerWorkspaceAccessTx: mocks.lowerWorkspace,
  readWorkspacePermission: mocks.readPermission,
  revokeWorkspaceAccessTx: mocks.revokeWorkspace,
  permissionRank: (permission: string) => ({ read: 1, write: 2, admin: 3 })[permission] ?? 0,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { reconcileUserProjection } from '@/ee/scim/lib/projection/reconcile-user'

const params = {
  connectionId: 'conn-1',
  organizationId: 'org-1',
  scimUserId: 'su-1',
  settings: {},
}

interface Scenario {
  current?: Array<Record<string, unknown>>
  mappings?: Array<Record<string, unknown>>
  ownedWorkspaces?: string[]
  actualWorkspaces?: Array<{ id: string; permissionType: 'read' | 'write' | 'admin' }>
  actualGroups?: string[]
  actualRole?: string
}

function stage({
  current = [],
  mappings = [],
  ownedWorkspaces = ['ws-1'],
  actualWorkspaces,
  actualGroups = [],
  actualRole = 'member',
}: Scenario) {
  queueTableRows(scimUser, [{ userId: 'u-1' }])
  queueTableRows(scimProjectionGrant, current)
  queueTableRows(scimGroupMember, mappings)
  queueTableRows(
    workspace,
    ownedWorkspaces.map((id) => ({ id }))
  )
  queueTableRows(
    permissions,
    actualWorkspaces ??
      current
        .filter((grant) => grant.targetKind === 'workspace')
        .map((grant) => ({ id: grant.targetId, permissionType: grant.permissionType }))
  )
  queueTableRows(
    permissionGroupMember,
    actualGroups.map((id) => ({ id }))
  )
  queueTableRows(member, [{ role: actualRole }])
}

const workspaceMapping = (workspaceId: string, permissionType: string) => ({
  targetKind: 'workspace',
  workspaceId,
  permissionType,
  permissionGroupId: null,
  role: null,
})

const insertedValues = () =>
  dbChainMockFns.values.mock.calls.map((call) => call[0] as Record<string, unknown>)

afterAll(resetDbChainMock)

describe('reconcileUserProjection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.grantWorkspace.mockResolvedValue('granted')
    mocks.lowerWorkspace.mockResolvedValue('lowered')
    mocks.readPermission.mockResolvedValue('write')
    mocks.revokeWorkspace.mockResolvedValue({ revoked: true, ownershipTransferred: false })
    mocks.addMember.mockResolvedValue('added')
    mocks.removeMember.mockResolvedValue('removed')
    mocks.changeMemberRole.mockResolvedValue({ changed: true, from: 'member', to: 'admin' })
  })

  it('takes the organization and user locks before reading any grant', async () => {
    stage({ mappings: [workspaceMapping('ws-1', 'write')] })
    await reconcileUserProjection(db, params)
    expect(mocks.acquireLocks).toHaveBeenCalledWith(db, {
      userId: 'u-1',
      organizationIds: ['org-1'],
    })
    expect(mocks.acquireLocks.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.from.mock.invocationCallOrder[1]
    )
  })

  it('records access the directory created as its own', async () => {
    stage({ mappings: [workspaceMapping('ws-1', 'write')] })
    const delta = await reconcileUserProjection(db, params)
    expect(mocks.grantWorkspace).toHaveBeenCalledWith(db, {
      workspaceId: 'ws-1',
      userId: 'u-1',
      permission: 'write',
    })
    expect(insertedValues()[0]).toMatchObject({ targetId: 'ws-1', origin: 'directory' })
    expect(delta.added).toHaveLength(1)
  })

  it('records access the person already held by hand as adopted, and counts no change', async () => {
    mocks.grantWorkspace.mockResolvedValue('unchanged')
    stage({
      mappings: [workspaceMapping('ws-1', 'write')],
      actualWorkspaces: [{ id: 'ws-1', permissionType: 'write' }],
    })
    const delta = await reconcileUserProjection(db, params)
    expect(insertedValues()[0]).toMatchObject({
      targetId: 'ws-1',
      origin: 'adopted',
      baselinePermission: 'write',
    })
    expect(delta.added).toHaveLength(0)
  })

  it('plans nothing when the recorded grants already satisfy the mappings', async () => {
    stage({
      current: [
        { targetKind: 'workspace', targetId: 'ws-1', permissionType: 'write', origin: 'directory' },
      ],
      mappings: [workspaceMapping('ws-1', 'write')],
    })
    await reconcileUserProjection(db, params)
    expect(mocks.grantWorkspace).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it.each([null, 'read'] as const)(
    'repairs recorded workspace access that is actually %s',
    async (permissionType) => {
      stage({
        current: [
          {
            targetKind: 'workspace',
            targetId: 'ws-1',
            permissionType: 'admin',
            origin: 'directory',
          },
        ],
        mappings: [workspaceMapping('ws-1', 'admin')],
        actualWorkspaces: permissionType ? [{ id: 'ws-1', permissionType }] : [],
      })
      const delta = await reconcileUserProjection(db, params)
      expect(mocks.grantWorkspace).toHaveBeenCalledWith(db, {
        workspaceId: 'ws-1',
        userId: 'u-1',
        permission: 'admin',
      })
      expect(delta.raised).toHaveLength(1)
    }
  )

  it('repairs a missing permission-group membership and a manually lowered organization role', async () => {
    stage({
      current: [
        { targetKind: 'permission_group', targetId: 'pg-1', origin: 'directory' },
        { targetKind: 'org_role', targetId: 'admin', origin: 'directory' },
      ],
      mappings: [
        { targetKind: 'permission_group', permissionGroupId: 'pg-1' },
        { targetKind: 'org_role', role: 'admin' },
      ],
      actualGroups: [],
      actualRole: 'member',
    })
    await reconcileUserProjection(db, params)
    expect(mocks.addMember).toHaveBeenCalledWith(db, {
      organizationId: 'org-1',
      groupId: 'pg-1',
      userId: 'u-1',
    })
    expect(mocks.changeMemberRole).toHaveBeenCalledWith(db, {
      organizationId: 'org-1',
      userId: 'u-1',
      role: 'admin',
    })
  })

  it('restores manual Read after a directory Admin mapping is removed', async () => {
    stage({
      mappings: [workspaceMapping('ws-1', 'admin')],
      actualWorkspaces: [{ id: 'ws-1', permissionType: 'read' }],
    })
    await reconcileUserProjection(db, params)
    const saved = insertedValues()[0]
    expect(saved).toMatchObject({
      permissionType: 'admin',
      baselinePermission: 'read',
      origin: 'directory',
    })

    vi.clearAllMocks()
    resetDbChainMock()
    mocks.readPermission.mockResolvedValue('admin')
    stage({ current: [saved] })
    await reconcileUserProjection(db, params)
    expect(mocks.lowerWorkspace).toHaveBeenCalledWith(db, {
      workspaceId: 'ws-1',
      userId: 'u-1',
      from: 'admin',
      to: 'read',
    })
    expect(mocks.revokeWorkspace).not.toHaveBeenCalled()
  })

  it('preserves an adopted manual Admin when the mapping is lowered', async () => {
    stage({
      current: [
        { targetKind: 'workspace', targetId: 'ws-1', permissionType: 'admin', origin: 'adopted' },
      ],
      mappings: [workspaceMapping('ws-1', 'read')],
    })
    mocks.grantWorkspace.mockResolvedValue('unchanged')
    await reconcileUserProjection(db, params)
    expect(mocks.lowerWorkspace).not.toHaveBeenCalled()
    expect(mocks.grantWorkspace).toHaveBeenCalledWith(db, {
      workspaceId: 'ws-1',
      userId: 'u-1',
      permission: 'admin',
    })
    expect(insertedValues()[0]).toMatchObject({ baselinePermission: 'admin' })
  })

  it('never lowers below the manual baseline during a directory downgrade', async () => {
    stage({
      current: [
        {
          targetKind: 'workspace',
          targetId: 'ws-1',
          permissionType: 'admin',
          origin: 'directory',
          baselinePermission: 'write',
        },
      ],
      mappings: [workspaceMapping('ws-1', 'read')],
    })
    await reconcileUserProjection(db, params)
    expect(mocks.lowerWorkspace).toHaveBeenCalledWith(db, {
      workspaceId: 'ws-1',
      userId: 'u-1',
      from: 'admin',
      to: 'write',
    })
  })

  it('withdraws the entire covered access when managed membership is locked', async () => {
    stage({
      current: [
        {
          targetKind: 'workspace',
          targetId: 'ws-1',
          permissionType: 'admin',
          origin: 'directory',
          baselinePermission: 'read',
        },
      ],
    })
    mocks.readPermission.mockResolvedValue('admin')
    await reconcileUserProjection(db, { ...params, settings: { lockManualMembership: true } })
    expect(mocks.revokeWorkspace).toHaveBeenCalled()
    expect(mocks.lowerWorkspace).not.toHaveBeenCalled()
  })

  it('forgets an adopted grant without touching the access unless the directory is the source of truth', async () => {
    stage({
      current: [
        { targetKind: 'workspace', targetId: 'ws-1', permissionType: 'write', origin: 'adopted' },
      ],
    })
    const forgotten = await reconcileUserProjection(db, params)
    expect(mocks.revokeWorkspace).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(scimProjectionGrant)
    expect(forgotten.removed).toEqual([
      expect.objectContaining({ targetKind: 'workspace', targetId: 'ws-1' }),
    ])

    vi.clearAllMocks()
    resetDbChainMock()
    mocks.revokeWorkspace.mockResolvedValue({ revoked: true, ownershipTransferred: false })
    mocks.readPermission.mockResolvedValue('write')
    stage({
      current: [
        { targetKind: 'workspace', targetId: 'ws-1', permissionType: 'write', origin: 'adopted' },
      ],
    })
    const withdrawn = await reconcileUserProjection(db, {
      ...params,
      settings: { lockManualMembership: true },
    })
    expect(mocks.revokeWorkspace).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ workspaceId: 'ws-1', userId: 'u-1' })
    )
    expect(withdrawn.removed).toHaveLength(1)
  })

  it('leaves the provenance row in place when access could not be handed on', async () => {
    mocks.revokeWorkspace.mockResolvedValue({
      revoked: false,
      reason: 'unresolved-workflows',
      unresolvedWorkflows: ['wf-1'],
    })
    stage({
      current: [
        { targetKind: 'workspace', targetId: 'ws-1', permissionType: 'write', origin: 'directory' },
      ],
    })
    const delta = await reconcileUserProjection(db, params)
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(delta.removed).toHaveLength(0)
  })

  it('leaves a manual raise above the directory level alone when unlocked', async () => {
    mocks.readPermission.mockResolvedValue('admin')
    stage({
      current: [
        { targetKind: 'workspace', targetId: 'ws-1', permissionType: 'write', origin: 'directory' },
      ],
    })
    await reconcileUserProjection(db, params)
    expect(mocks.revokeWorkspace).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(scimProjectionGrant)
  })

  it('never reaches into a workspace that left the organization, in either direction', async () => {
    stage({
      current: [
        {
          targetKind: 'workspace',
          targetId: 'ws-gone',
          permissionType: 'write',
          origin: 'directory',
        },
      ],
      mappings: [workspaceMapping('ws-gone', 'write'), workspaceMapping('ws-1', 'read')],
      ownedWorkspaces: ['ws-1'],
    })
    await reconcileUserProjection(db, params)
    expect(mocks.grantWorkspace).toHaveBeenCalledTimes(1)
    expect(mocks.grantWorkspace.mock.calls[0][1]).toMatchObject({ workspaceId: 'ws-1' })
    expect(mocks.revokeWorkspace).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(scimProjectionGrant)
  })

  it('re-establishes the desired level when the row is no longer at the level the directory set', async () => {
    mocks.lowerWorkspace.mockResolvedValue('unchanged')
    stage({
      current: [
        { targetKind: 'workspace', targetId: 'ws-1', permissionType: 'admin', origin: 'directory' },
      ],
      mappings: [workspaceMapping('ws-1', 'read')],
    })
    await reconcileUserProjection(db, params)
    expect(mocks.lowerWorkspace).toHaveBeenCalledWith(db, {
      workspaceId: 'ws-1',
      userId: 'u-1',
      from: 'admin',
      to: 'read',
    })
    expect(mocks.grantWorkspace).toHaveBeenCalledWith(db, {
      workspaceId: 'ws-1',
      userId: 'u-1',
      permission: 'read',
    })
  })

  it('skips the owner on an organization-role mapping instead of failing the sync', async () => {
    mocks.changeMemberRole.mockRejectedValue(new OrchestrationError('conflict', 'owner'))
    stage({
      mappings: [
        {
          targetKind: 'org_role',
          role: 'admin',
          workspaceId: null,
          permissionType: null,
          permissionGroupId: null,
        },
      ],
    })
    const delta = await reconcileUserProjection(db, params)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(delta.added).toHaveLength(0)
  })

  it('does nothing for a directory row that no longer exists', async () => {
    queueTableRows(scimUser, [])
    const delta = await reconcileUserProjection(db, params)
    expect(delta).toEqual({ added: [], removed: [], raised: [] })
    expect(mocks.acquireLocks).not.toHaveBeenCalled()
  })
})
