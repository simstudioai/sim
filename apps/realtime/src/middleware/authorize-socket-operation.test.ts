/**
 * @vitest-environment node
 *
 * Tests for `authorizeSocketOperation` — the per-event role re-validation that
 * bounds how long a revoked or downgraded collaborator can keep mutating a
 * workflow on an already-connected socket.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLimit, mockAuthorize } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockAuthorize: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockLimit,
        }),
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

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorize,
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { authorizeSocketOperation } from '@/middleware/permissions'
import type { UserPresence } from '@/rooms/types'

const WRITE_OP = 'add' // a write/admin operation (not in READ_OPERATIONS)
const READ_OP = 'update-position' // allowed for read role too

function createManager() {
  return {
    updateUserRole: vi.fn().mockResolvedValue(undefined),
  }
}

function createPresence(overrides?: Partial<UserPresence>): UserPresence {
  return {
    userId: 'user-1',
    workflowId: 'workflow-1',
    userName: 'Test User',
    socketId: 'socket-1',
    joinedAt: 1,
    lastActivity: 1,
    role: 'write',
    roleCheckedAt: Date.now(),
    ...overrides,
  }
}

/** Configures the live-permission lookup to grant `role`, or deny when null. */
function grant(role: string | null) {
  mockLimit.mockResolvedValue([{ workspaceId: 'ws-1', name: 'WF' }])
  if (role === null) {
    mockAuthorize.mockResolvedValue({ allowed: false, message: 'denied' })
  } else {
    mockAuthorize.mockResolvedValue({ allowed: true, workspacePermission: role })
  }
}

describe('authorizeSocketOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the cached role without a DB read while the role is fresh', async () => {
    const manager = createManager()
    const presence = createPresence({ role: 'write', roleCheckedAt: Date.now() })

    const result = await authorizeSocketOperation({
      roomManager: manager as never,
      workflowId: 'workflow-1',
      socketId: 'socket-1',
      userId: 'user-1',
      presence,
      operation: WRITE_OP,
    })

    expect(result).toEqual({
      allowed: true,
      role: 'write',
      reason: undefined,
      accessRevoked: false,
    })
    expect(mockAuthorize).not.toHaveBeenCalled()
    expect(mockLimit).not.toHaveBeenCalled()
    expect(manager.updateUserRole).not.toHaveBeenCalled()
  })

  it('re-validates against the DB once the cached role is stale', async () => {
    grant('write')
    const manager = createManager()
    const presence = createPresence({ role: 'write', roleCheckedAt: Date.now() - 60_000 })

    const result = await authorizeSocketOperation({
      roomManager: manager as never,
      workflowId: 'workflow-1',
      socketId: 'socket-1',
      userId: 'user-1',
      presence,
      operation: WRITE_OP,
    })

    expect(result.allowed).toBe(true)
    expect(result.accessRevoked).toBe(false)
    expect(mockAuthorize).toHaveBeenCalledTimes(1)
    expect(manager.updateUserRole).toHaveBeenCalledWith('workflow-1', 'socket-1', 'write')
  })

  it('treats missing roleCheckedAt (pre-upgrade presence) as stale and re-validates', async () => {
    grant('write')
    const manager = createManager()
    const presence = createPresence({ role: 'write' })
    presence.roleCheckedAt = undefined

    const result = await authorizeSocketOperation({
      roomManager: manager as never,
      workflowId: 'workflow-1',
      socketId: 'socket-1',
      userId: 'user-1',
      presence,
      operation: WRITE_OP,
    })

    expect(result.allowed).toBe(true)
    expect(mockAuthorize).toHaveBeenCalledTimes(1)
  })

  it('denies a write after a downgrade to read and refreshes the cached role', async () => {
    grant('read')
    const manager = createManager()
    const presence = createPresence({ role: 'write', roleCheckedAt: Date.now() - 60_000 })

    const result = await authorizeSocketOperation({
      roomManager: manager as never,
      workflowId: 'workflow-1',
      socketId: 'socket-1',
      userId: 'user-1',
      presence,
      operation: WRITE_OP,
    })

    expect(result.allowed).toBe(false)
    expect(result.accessRevoked).toBe(false)
    expect(result.role).toBe('read')
    expect(manager.updateUserRole).toHaveBeenCalledWith('workflow-1', 'socket-1', 'read')
  })

  it('still allows a read-tier op after a downgrade to read', async () => {
    grant('read')
    const manager = createManager()
    const presence = createPresence({ role: 'write', roleCheckedAt: Date.now() - 60_000 })

    const result = await authorizeSocketOperation({
      roomManager: manager as never,
      workflowId: 'workflow-1',
      socketId: 'socket-1',
      userId: 'user-1',
      presence,
      operation: READ_OP,
    })

    expect(result.allowed).toBe(true)
    expect(result.role).toBe('read')
  })

  it('reports accessRevoked when workspace permission has been removed', async () => {
    grant(null)
    const manager = createManager()
    const presence = createPresence({ role: 'write', roleCheckedAt: Date.now() - 60_000 })

    const result = await authorizeSocketOperation({
      roomManager: manager as never,
      workflowId: 'workflow-1',
      socketId: 'socket-1',
      userId: 'user-1',
      presence,
      operation: WRITE_OP,
    })

    expect(result.accessRevoked).toBe(true)
    expect(result.allowed).toBe(false)
    expect(manager.updateUserRole).not.toHaveBeenCalled()
  })

  it('reports accessRevoked when the workflow no longer exists', async () => {
    mockLimit.mockResolvedValue([])
    const manager = createManager()
    const presence = createPresence({ role: 'write', roleCheckedAt: Date.now() - 60_000 })

    const result = await authorizeSocketOperation({
      roomManager: manager as never,
      workflowId: 'workflow-1',
      socketId: 'socket-1',
      userId: 'user-1',
      presence,
      operation: WRITE_OP,
    })

    expect(result.accessRevoked).toBe(true)
    expect(mockAuthorize).not.toHaveBeenCalled()
  })

  it('falls back to the cached role on a transient DB error (no lockout)', async () => {
    mockLimit.mockRejectedValue(new Error('connection reset'))
    const manager = createManager()
    const presence = createPresence({ role: 'write', roleCheckedAt: Date.now() - 60_000 })

    const result = await authorizeSocketOperation({
      roomManager: manager as never,
      workflowId: 'workflow-1',
      socketId: 'socket-1',
      userId: 'user-1',
      presence,
      operation: WRITE_OP,
    })

    expect(result.allowed).toBe(true)
    expect(result.accessRevoked).toBe(false)
    expect(result.role).toBe('write')
    expect(manager.updateUserRole).not.toHaveBeenCalled()
  })
})
