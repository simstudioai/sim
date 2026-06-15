/**
 * @vitest-environment node
 *
 * Tests for `reconcileWorkspaceAccessChange` — the push-driven reconciliation
 * that evicts users whose workspace access was revoked and refreshes the cached
 * role of users who were merely downgraded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWhere, mockVerifyWorkflowAccess } = vi.hoisted(() => ({
  mockWhere: vi.fn(),
  mockVerifyWorkflowAccess: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockWhere,
      }),
    }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflow: {},
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/middleware/permissions', () => ({
  verifyWorkflowAccess: mockVerifyWorkflowAccess,
}))

import { reconcileWorkspaceAccessChange } from '@/rooms/access'
import type { UserPresence } from '@/rooms/types'

function presence(socketId: string, userId: string, role = 'write'): UserPresence {
  return {
    userId,
    workflowId: 'workflow-1',
    userName: userId,
    socketId,
    joinedAt: 1,
    lastActivity: 1,
    role,
  }
}

function createManager(users: UserPresence[]) {
  const socketsLeave = vi.fn().mockResolvedValue(undefined)
  const emit = vi.fn()
  return {
    socketsLeave,
    emit,
    hasWorkflowRoom: vi.fn().mockResolvedValue(true),
    getWorkflowUsers: vi.fn().mockResolvedValue(users),
    updateUserRole: vi.fn().mockResolvedValue(undefined),
    removeUserFromRoom: vi.fn().mockResolvedValue('workflow-1'),
    broadcastPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    io: {
      to: vi.fn(() => ({ emit })),
      in: vi.fn(() => ({ socketsLeave })),
    },
  }
}

describe('reconcileWorkspaceAccessChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWhere.mockResolvedValue([{ id: 'workflow-1' }])
  })

  it('evicts every socket of a user whose access was revoked', async () => {
    mockVerifyWorkflowAccess.mockResolvedValue({ hasAccess: false })
    const manager = createManager([presence('socket-1', 'user-1'), presence('socket-2', 'user-1')])

    await reconcileWorkspaceAccessChange(manager as never, 'ws-1', 'user-1')

    expect(manager.io.to).toHaveBeenCalledWith('socket-1')
    expect(manager.io.to).toHaveBeenCalledWith('socket-2')
    expect(manager.emit).toHaveBeenCalledWith(
      'workflow-permissions-revoked',
      expect.objectContaining({ workflowId: 'workflow-1' })
    )
    expect(manager.removeUserFromRoom).toHaveBeenCalledWith('socket-1', 'workflow-1')
    expect(manager.removeUserFromRoom).toHaveBeenCalledWith('socket-2', 'workflow-1')
    expect(manager.socketsLeave).toHaveBeenCalledTimes(2)
    expect(manager.updateUserRole).not.toHaveBeenCalled()
    expect(manager.broadcastPresenceUpdate).toHaveBeenCalledWith('workflow-1')
  })

  it('refreshes the cached role without eviction on a downgrade', async () => {
    mockVerifyWorkflowAccess.mockResolvedValue({ hasAccess: true, role: 'read' })
    const manager = createManager([presence('socket-1', 'user-1', 'write')])

    await reconcileWorkspaceAccessChange(manager as never, 'ws-1', 'user-1')

    expect(manager.updateUserRole).toHaveBeenCalledWith('workflow-1', 'socket-1', 'read')
    expect(manager.removeUserFromRoom).not.toHaveBeenCalled()
    expect(manager.socketsLeave).not.toHaveBeenCalled()
    expect(manager.emit).not.toHaveBeenCalled()
    expect(manager.broadcastPresenceUpdate).toHaveBeenCalledWith('workflow-1')
  })

  it('does nothing for rooms where the user is not present', async () => {
    const manager = createManager([presence('socket-9', 'someone-else')])

    await reconcileWorkspaceAccessChange(manager as never, 'ws-1', 'user-1')

    expect(mockVerifyWorkflowAccess).not.toHaveBeenCalled()
    expect(manager.updateUserRole).not.toHaveBeenCalled()
    expect(manager.removeUserFromRoom).not.toHaveBeenCalled()
  })

  it('skips workflows that have no active room', async () => {
    const manager = createManager([presence('socket-1', 'user-1')])
    manager.hasWorkflowRoom.mockResolvedValue(false)

    await reconcileWorkspaceAccessChange(manager as never, 'ws-1', 'user-1')

    expect(manager.getWorkflowUsers).not.toHaveBeenCalled()
    expect(mockVerifyWorkflowAccess).not.toHaveBeenCalled()
  })

  it('continues to other workflows when one room fails', async () => {
    mockWhere.mockResolvedValue([{ id: 'workflow-1' }, { id: 'workflow-2' }])
    mockVerifyWorkflowAccess.mockResolvedValue({ hasAccess: false })
    const manager = createManager([presence('socket-1', 'user-1')])
    manager.getWorkflowUsers
      .mockRejectedValueOnce(new Error('redis blip'))
      .mockResolvedValueOnce([presence('socket-1', 'user-1')])

    await reconcileWorkspaceAccessChange(manager as never, 'ws-1', 'user-1')

    // First workflow threw; second still evicted.
    expect(manager.removeUserFromRoom).toHaveBeenCalledWith('socket-1', 'workflow-2')
  })

  it('returns without throwing when the workspace workflow lookup fails', async () => {
    mockWhere.mockRejectedValue(new Error('db down'))
    const manager = createManager([presence('socket-1', 'user-1')])

    await expect(
      reconcileWorkspaceAccessChange(manager as never, 'ws-1', 'user-1')
    ).resolves.toBeUndefined()
    expect(manager.hasWorkflowRoom).not.toHaveBeenCalled()
  })
})
