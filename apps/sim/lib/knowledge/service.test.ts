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
