/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  permissionsMock,
  permissionsMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { KnowledgeBasePermissionError, updateKnowledgeBase } from '@/lib/knowledge/service'

/**
 * These tests guard the workspace mass-assignment fix:
 * a user with write/admin on the *source* workspace must not be able to move a
 * knowledge base into a workspace where they have no permission, and must not
 * be able to clear `workspaceId` (which would orphan the KB to its original
 * `userId`, who may not be the caller).
 */
describe('updateKnowledgeBase — workspace transfer authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
  })

  it('rejects workspaceId change without actorUserId', async () => {
    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1')
    ).rejects.toBeInstanceOf(KnowledgeBasePermissionError)
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('rejects clearing workspaceId to null when actor is not the KB owner', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'owner' }])

    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: null }, 'req-1', { actorUserId: 'attacker' })
    ).rejects.toMatchObject({
      code: 'KNOWLEDGE_BASE_FORBIDDEN',
      message: 'Only the knowledge base owner can remove it from a workspace',
    })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('allows the KB owner to clear workspaceId to null (gate passes; target permission not checked)', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'owner' }])

    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: null }, 'req-1', { actorUserId: 'owner' })
    ).rejects.not.toBeInstanceOf(KnowledgeBasePermissionError)
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('rejects transfer when actor has no permission on target workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce(null)

    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', {
        actorUserId: 'attacker',
      })
    ).rejects.toMatchObject({
      code: 'KNOWLEDGE_BASE_FORBIDDEN',
      message: 'User does not have permission on the target workspace',
    })
    expect(permissionsMockFns.mockGetUserEntityPermissions).toHaveBeenCalledWith(
      'attacker',
      'workspace',
      'ws-target'
    )
  })

  it('rejects transfer when actor only has read permission on target workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')

    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', {
        actorUserId: 'reader',
      })
    ).rejects.toBeInstanceOf(KnowledgeBasePermissionError)
  })

  it('throws when knowledge base does not exist during transfer', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(
      updateKnowledgeBase('kb-missing', { workspaceId: 'ws-target' }, 'req-1', {
        actorUserId: 'u-1',
      })
    ).rejects.toThrow('Knowledge base kb-missing not found')
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('locks the knowledge base row (SELECT … FOR UPDATE) before the permission check', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce(null)

    await expect(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', {
        actorUserId: 'attacker',
      })
    ).rejects.toBeInstanceOf(KnowledgeBasePermissionError)

    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
  })
})

/**
 * These tests guard the file-authorization follow-through: KB file ownership is
 * resolved from the trusted `workspace_files` binding, so when a KB moves to a
 * new workspace the bindings for its stored files must move with it. Otherwise
 * the bindings stay frozen at the upload-time workspace and the KB's files
 * become unreadable after a move.
 */
describe('updateKnowledgeBase — file ownership binding re-point on workspace change', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
  })

  // The mocked `@sim/db` cannot satisfy the post-transaction read-back select, so
  // the call rejects after the transaction body commits. These tests assert the
  // in-transaction binding statements, then swallow that read-back rejection.
  const runIgnoringReadBack = (promise: Promise<unknown>) => promise.catch(() => undefined)

  it('re-points file ownership bindings to the new workspace on a move', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('admin')

    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', { actorUserId: 'u-1' })
    )

    // Two updates inside the txn: the KB row, then the file bindings.
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ workspaceId: 'ws-target' })
  })

  it('clears file ownership bindings when the KB is removed from its workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'owner' }])

    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: null }, 'req-1', { actorUserId: 'owner' })
    )

    expect(dbChainMockFns.update).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ workspaceId: null })
  })

  it('does not re-point bindings when promoting a personal (null-workspace) KB into a workspace', async () => {
    // A null current workspace owns no bindings, so the move must not rewrite
    // any binding — this prevents a key planted in a personal KB from being
    // laundered into the destination workspace on move.
    dbChainMockFns.limit.mockResolvedValueOnce([{ workspaceId: null, userId: 'owner' }])
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('admin')

    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-target' }, 'req-1', { actorUserId: 'owner' })
    )

    // Only the KB row is updated; the binding re-point is skipped entirely.
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith({ workspaceId: 'ws-target' })
  })

  it('does not touch bindings when the workspace is unchanged', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }])

    await runIgnoringReadBack(
      updateKnowledgeBase('kb-1', { workspaceId: 'ws-current' }, 'req-1', { actorUserId: 'u-1' })
    )

    // Only the KB row is updated; no binding re-point statement runs.
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith({ workspaceId: 'ws-current' })
  })

  it('does not touch bindings when no workspace change is requested', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }]) // currentKb lock
      .mockResolvedValueOnce([]) // duplicate-name check: none

    await runIgnoringReadBack(updateKnowledgeBase('kb-1', { name: 'Renamed' }, 'req-1'))

    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
  })
})
