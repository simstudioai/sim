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

/** Minimal stand-in for `@sim/platform-authz/resource-lock`'s `ResourceLockedError`
 *  (423, carries `resourceType`/`inherited`) — avoids `vi.importActual`. */
const {
  mockAssertResourceMutable,
  mockAssertFolderMutable,
  mockAssertResourceMutableUnlessUnlocking,
  MockResourceLockedError,
} = vi.hoisted(() => {
  class ResourceLockedErrorStub extends Error {
    readonly status = 423
    readonly resourceType: string
    readonly inherited: boolean
    constructor(resourceType: string, inherited: boolean, message?: string) {
      super(message ?? `${resourceType} is locked`)
      this.name = 'ResourceLockedError'
      this.resourceType = resourceType
      this.inherited = inherited
    }
  }
  const assertResourceMutable = vi.fn()
  // Real wrapper logic (not a bare passthrough) so tests that configure
  // assertResourceMutable to reject with a direct vs. inherited error see the
  // same "unless unlocking" behavior the production wrapper implements.
  const assertResourceMutableUnlessUnlocking = vi.fn(
    async (resourceType: string, resourceId: string, unlocking: boolean, tx?: unknown) => {
      try {
        const args = [resourceType, resourceId, tx].filter((a) => a !== undefined)
        await assertResourceMutable(...args)
      } catch (error) {
        if (unlocking && error instanceof ResourceLockedErrorStub && !error.inherited) return
        throw error
      }
    }
  )
  return {
    mockAssertResourceMutable: assertResourceMutable,
    mockAssertFolderMutable: vi.fn(),
    mockAssertResourceMutableUnlessUnlocking: assertResourceMutableUnlessUnlocking,
    MockResourceLockedError: ResourceLockedErrorStub,
  }
})

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@sim/platform-authz/resource-lock', () => ({
  assertResourceMutable: mockAssertResourceMutable,
  assertFolderMutable: mockAssertFolderMutable,
  assertResourceMutableUnlessUnlocking: mockAssertResourceMutableUnlessUnlocking,
  ResourceLockedError: MockResourceLockedError,
}))

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
    // The target-workspace permission is resolved before the transaction
    // opens (pool safety), so the lookup runs even when the KB is missing.
    expect(permissionsMockFns.mockGetUserEntityPermissions).toHaveBeenCalledWith(
      'u-1',
      'workspace',
      'ws-target'
    )
  })

  it('locks the knowledge base row (SELECT … FOR UPDATE) and enforces the pre-resolved permission', async () => {
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

describe('updateKnowledgeBase — resource-lock enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbChainMockFns.limit.mockReset()
    resetDbChainMock()
    mockAssertResourceMutable.mockReset()
    mockAssertFolderMutable.mockReset()
  })

  it('rejects a non-lock update on a directly-locked knowledge base with a 423', async () => {
    mockAssertResourceMutable.mockRejectedValueOnce(
      new MockResourceLockedError('knowledge_base', false, 'Knowledge base is locked')
    )

    await expect(updateKnowledgeBase('kb-1', { name: 'Renamed' }, 'req-1')).rejects.toMatchObject({
      status: 423,
      inherited: false,
    })

    expect(mockAssertResourceMutable).toHaveBeenCalledWith('knowledge_base', 'kb-1')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('rejects a non-lock update when the knowledge base is inside a locked folder with a 423', async () => {
    mockAssertResourceMutable.mockRejectedValueOnce(
      new MockResourceLockedError(
        'knowledge_base',
        true,
        'Knowledge base is locked by its containing folder'
      )
    )

    await expect(
      updateKnowledgeBase('kb-1', { description: 'updated' }, 'req-1')
    ).rejects.toMatchObject({
      status: 423,
      inherited: true,
    })

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('skips the lock check for a lock-only update (unlocking a directly-locked KB)', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }])

    await updateKnowledgeBase('kb-1', { locked: false }, 'req-1').catch(() => undefined)

    expect(mockAssertResourceMutable).not.toHaveBeenCalled()
  })

  it('skips the lock check when unlocking via the route-shaped object (all keys present, unset ones undefined)', async () => {
    // Regression test: apps/sim/app/api/knowledge/[id]/route.ts always builds a full
    // literal object (`{ name: validatedData.name, ..., locked: validatedData.locked }`)
    // rather than spreading only the fields the client actually sent. `Object.keys()`
    // includes keys whose value is `undefined`, so a naive `Object.keys(updates).some(...)`
    // check always sees every field as "provided" and can never detect a lock-only
    // update — permanently blocking unlock, since the mutability check reads the
    // still-locked current row. This calls updateKnowledgeBase with that exact shape.
    dbChainMockFns.limit.mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }])

    await updateKnowledgeBase(
      'kb-1',
      {
        name: undefined,
        description: undefined,
        workspaceId: undefined,
        folderId: undefined,
        chunkingConfig: undefined,
        locked: false,
      },
      'req-1'
    ).catch(() => undefined)

    expect(mockAssertResourceMutable).not.toHaveBeenCalled()
  })

  it('allows unlocking a directly-locked knowledge base combined with a move in the same request', async () => {
    // Regression test: hasNonLockUpdate is true whenever folderId also changes, so a
    // combined "unlock + move" request previously still ran assertResourceMutable
    // against the KB's current (still-locked) state and was incorrectly rejected,
    // even though the request unlocks it as part of this same atomic write. The
    // fixed behavior still runs the check (so an inherited lock is caught below),
    // but treats a DIRECT lock as satisfied since this request clears it.
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }]) // currentKb (FOR UPDATE)
      .mockResolvedValueOnce([
        { workspaceId: 'ws-current', resourceType: 'knowledge_base', deletedAt: null },
      ]) // assertFolderParentValid's parent lookup
    mockAssertResourceMutable.mockRejectedValueOnce(
      new MockResourceLockedError('knowledge_base', false, 'Knowledge base is locked')
    )

    await updateKnowledgeBase('kb-1', { folderId: 'folder-1', locked: false }, 'req-1').catch(
      () => undefined
    )

    expect(mockAssertResourceMutable).toHaveBeenCalledWith('knowledge_base', 'kb-1')
    expect(mockAssertFolderMutable).toHaveBeenCalledWith(
      'folder-1',
      'knowledge_base',
      expect.anything()
    )
  })

  it('still rejects unlocking a knowledge base combined with a move when the lock is inherited from its folder', async () => {
    // Clearing the KB's own `locked` flag doesn't affect a lock inherited from its
    // containing folder -- that must still block the combined request.
    mockAssertResourceMutable.mockRejectedValueOnce(
      new MockResourceLockedError(
        'knowledge_base',
        true,
        'Knowledge base is locked by its containing folder'
      )
    )

    await expect(
      updateKnowledgeBase('kb-1', { folderId: 'folder-1', locked: false }, 'req-1')
    ).rejects.toMatchObject({ status: 423, inherited: true })
  })

  it('rejects moving the knowledge base into a locked destination folder with a 423', async () => {
    // Regression test: assertResourceMutable only checks the KB's *current* folder
    // chain -- without a separate assertFolderMutable(updates.folderId, ...) check,
    // a KB in an unlocked folder could be moved into a locked one.
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ workspaceId: 'ws-current', userId: 'u-1' }]) // currentKb (FOR UPDATE)
      .mockResolvedValueOnce([
        { workspaceId: 'ws-current', resourceType: 'knowledge_base', deletedAt: null },
      ]) // assertFolderParentValid's parent lookup
    mockAssertFolderMutable.mockRejectedValueOnce(
      new MockResourceLockedError('knowledge_base', false, 'Folder is locked')
    )

    await expect(
      updateKnowledgeBase('kb-1', { folderId: 'folder-locked' }, 'req-1')
    ).rejects.toMatchObject({ status: 423, inherited: false })

    // Called with a 3rd arg (the `tx` client) so the recheck runs inside the same
    // transaction as the write, closing the TOCTOU window between the check and write.
    expect(mockAssertFolderMutable).toHaveBeenCalledWith(
      'folder-locked',
      'knowledge_base',
      expect.anything()
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
